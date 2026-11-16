import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const defaultRun = (cmd, args, { cwd } = {}) => String(execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

export async function deliver({ repoDir, paths, message, mode, branch = 'of1-integrate', run = defaultRun }) {
  if (!['main', 'branch', 'pr'].includes(mode)) throw new Error(`Unknown delivery mode: ${mode}`);
  const git = (...args) => run('git', args, { cwd: repoDir });
  if (mode !== 'main') {
    let suffix = '';
    try {
      const m = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\s*$/.exec(String(git('remote', 'get-url', 'origin')));
      if (m) suffix = `--${m[2]}--${m[1]}`;
    } catch { /* no origin: the length check is skipped */ }
    if (!/^[a-z0-9-]+$/.test(branch) || branch.length + suffix.length > 63) return { ok: false, ref: branch, reason: 'bad-branch' };
  }
  const ref = mode === 'main' ? 'main' : branch;
  const fail = (reason) => ({ ok: false, ref, reason });

  for (const p of paths) {
    if (!existsSync(resolve(repoDir, p)) && !String(git('ls-files', '--', p)).trim()) return fail('missing-path');
  }

  const origBranch = String(git('rev-parse', '--abbrev-ref', 'HEAD')).trim();
  const origHead = String(git('rev-parse', 'HEAD')).trim();
  if (mode === 'main' && origBranch !== 'main') return fail('not-on-main');

  if (mode === 'main' || origBranch === branch) return deliverOn(git);

  // Commit in a temporary worktree so the user's branch, index and working tree stay untouched.
  const hasRef = (r) => { try { git('rev-parse', '--verify', '--quiet', r); return true; } catch { return false; } };
  const tmp = mkdtempSync(join(tmpdir(), 'of1-deliver-'));
  const dir = join(tmp, 'wt');
  let added = false;
  try {
    try {
      if (hasRef(`refs/heads/${branch}`)) git('worktree', 'add', '--quiet', dir, branch);
      else if (hasRef(`refs/remotes/origin/${branch}`)) git('worktree', 'add', '--quiet', '-b', branch, dir, `origin/${branch}`);
      else git('worktree', 'add', '--quiet', '-b', branch, dir, origHead);
      added = true;
    } catch { return fail('checkout-failed'); }
    const wgit = (...args) => run('git', args, { cwd: dir });
    try { wgit('rebase', '--quiet', origHead); } catch {
      try { wgit('rebase', '--abort'); } catch { /* not in a rebase */ }
      return fail('conflict');
    }
    for (const p of paths) {
      rmSync(resolve(dir, p), { recursive: true, force: true });
      // Only what `git add` would take in the user's repo: their untracked .gitignore files apply.
      const files = String(git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', p)).split('\0').filter(Boolean);
      for (const f of files) {
        const src = resolve(repoDir, f);
        if (existsSync(src)) cpSync(src, resolve(dir, f), { recursive: true });
      }
    }
    return await deliverOn(wgit);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    if (added) { try { git('worktree', 'prune'); } catch { /* stale entry is harmless */ } }
  }

  async function deliverOn(git) {
    git('add', '--', ...paths);
    let staged = false;
    try { git('diff', '--cached', '--quiet', '--', ...paths); } catch { staged = true; }
    if (!staged) return fail('nothing');
    git('commit', '-m', message, '--', ...paths);

    if (mode === 'main') {
      try { git('pull', '--rebase', '--autostash'); } catch {
        const inRebase = ['rebase-merge', 'rebase-apply'].some((d) => existsSync(resolve(repoDir, String(git('rev-parse', '--git-path', d)).trim())));
        if (inRebase) { try { git('rebase', '--abort'); } catch { /* already gone */ } }
        git('reset', '--mixed', origHead);
        return fail(inRebase ? 'conflict' : 'pull-failed');
      }
      try { git('push', 'origin', 'HEAD:main'); } catch { return fail('push-rejected'); }
      return { ok: true, ref };
    }

    try { git('push', '--force-with-lease', '-u', 'origin', branch); } catch { return fail('push-rejected'); }
    if (mode === 'branch') return { ok: true, ref };

    const gh = (...args) => run('gh', args, { cwd: repoDir });
    try {
      let url = '';
      try { url = String(gh('pr', 'view', branch, '--json', 'url', '--jq', '.url')).trim(); } catch (e) { if (e.code === 'ENOENT') throw e; }
      if (!url) url = String(gh('pr', 'create', '--fill', '--base', 'main')).trim().split('\n').pop();
      return { ok: true, ref, prUrl: url };
    } catch (e) {
      return fail(e.code === 'ENOENT' ? 'gh-missing' : 'gh-failed');
    }
  }
}
