import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const defaultRun = (cmd, args, { cwd } = {}) => String(execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

export async function deliver({ repoDir, paths, message, mode, branch = 'of1-integrate', run = defaultRun }) {
  if (!['main', 'branch', 'pr'].includes(mode)) throw new Error(`Unknown delivery mode: ${mode}`);
  const git = (...args) => run('git', args, { cwd: repoDir });
  const ref = mode === 'main' ? 'main' : branch;
  const fail = (reason) => ({ ok: false, ref, reason });

  for (const p of paths) {
    if (!existsSync(resolve(repoDir, p)) && !String(git('ls-files', '--', p)).trim()) return fail('missing-path');
  }

  const origBranch = String(git('rev-parse', '--abbrev-ref', 'HEAD')).trim();
  const origHead = String(git('rev-parse', 'HEAD')).trim();
  if (mode === 'main' && origBranch !== 'main') return fail('not-on-main');

  if (mode !== 'main') {
    let exists = true;
    try { git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`); } catch { exists = false; }
    try { git('checkout', ...(exists ? [] : ['-b']), branch); } catch { return fail('checkout-failed'); }
  }
  try {
    return await deliverOn();
  } finally {
    if (mode !== 'main' && origBranch !== 'HEAD') {
      try { git('checkout', origBranch); } catch { /* leave on the delivery branch */ }
    }
  }

  async function deliverOn() {
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

    try { git('push', '-u', 'origin', branch); } catch { return fail('push-rejected'); }
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
