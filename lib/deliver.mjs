import { execFileSync } from 'node:child_process';

const defaultRun = (cmd, args, { cwd } = {}) => String(execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

export async function deliver({ repoDir, paths, message, mode, branch = 'of1-integrate', run = defaultRun }) {
  const git = (...args) => run('git', args, { cwd: repoDir });
  const ok = (ref, extra = {}) => ({ ok: true, ref, ...extra });
  const ref = mode === 'main' ? 'main' : branch;
  if (!['main', 'branch', 'pr'].includes(mode)) throw new Error(`Unknown delivery mode: ${mode}`);

  if (mode !== 'main') {
    let exists = true;
    try { git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`); } catch { exists = false; }
    git('checkout', ...(exists ? [] : ['-b']), branch);
  }

  git('add', '--', ...paths);
  let staged = false;
  try { git('diff', '--cached', '--quiet', '--', ...paths); } catch { staged = true; }
  if (!staged) return { ok: false, ref, reason: 'nothing' };
  git('commit', '-m', message, '--', ...paths);

  if (mode === 'main') {
    try { git('pull', '--rebase', '--autostash'); } catch {
      try { git('rebase', '--abort'); } catch { /* no rebase in progress */ }
      return { ok: false, ref, reason: 'conflict' };
    }
    try { git('push', 'origin', 'HEAD:main'); } catch { return { ok: false, ref, reason: 'push-rejected' }; }
    return ok(ref);
  }

  try { git('push', '-u', 'origin', branch); } catch { return { ok: false, ref, reason: 'push-rejected' }; }
  if (mode === 'branch') return ok(ref);

  const gh = (...args) => run('gh', args, { cwd: repoDir });
  try {
    let url = '';
    try { url = String(gh('pr', 'view', branch, '--json', 'url', '--jq', '.url')).trim(); } catch { /* none open */ }
    if (!url) url = String(gh('pr', 'create', '--fill', '--base', 'main')).trim().split('\n').pop();
    return ok(ref, { prUrl: url });
  } catch (e) {
    return { ok: false, ref, reason: e.code === 'ENOENT' ? 'gh-missing' : 'push-rejected' };
  }
}
