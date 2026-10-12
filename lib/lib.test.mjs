import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sh = (script, env = {}, cwd = ROOT, shell = 'bash') =>
  spawnSync(shell, ['-c', script], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
const tmp = () => mkdtempSync(join(tmpdir(), 'of1lib-'));

test('da_resolve_token precedence', () => {
  const d = tmp();
  const f = join(d, 't.json');
  writeFileSync(f, '{"access_token":"filetok"}');
  const src = `source ${ROOT}/lib/da-token.sh; da_resolve_token`;
  assert.equal(sh(src, { ADOBE_IMS_TOKEN: 'envtok', OF1_TOKEN_FILE: f }, d).stdout.trim(), 'envtok');
  assert.equal(sh(src, { OF1_TOKEN_FILE: f }, d).stdout.trim(), 'filetok');
  mkdirSync(join(d, '.hlx'));
  writeFileSync(join(d, '.hlx/.da-token.json'), '{"access_token":"pwdtok"}');
  assert.equal(sh(src, {}, d).stdout.trim(), 'pwdtok');
  const e = tmp();
  assert.notEqual(sh(src, {}, e).status, 0);
});

for (const [code, rc, pat] of [[200, 0, null], [401, 1, /expired or invalid/], [500, 0, /WARN/]]) {
  test(`da_probe_token ${code}`, async () => {
    const srv = createServer((q, r) => { r.statusCode = code; r.end('x'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const out = await new Promise((res) => {
      const p = spawnSync; // sync would block server; use async spawn
      import('node:child_process').then(({ spawn }) => {
        const c = spawn('bash', ['-c', `source ${ROOT}/lib/da-token.sh; da_probe_token o r tok`], { env: { PATH: process.env.PATH, DA_BASE: base } });
        let err = ''; c.stderr.on('data', (d) => (err += d));
        c.on('close', (status) => res({ status, err }));
      });
    });
    srv.close();
    assert.equal(out.status, rc);
    if (pat) assert.match(out.err, pat);
  });
}

function gitSetup() {
  const d = tmp();
  const g = (cwd, a) => spawnSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=n', ...a], { cwd, encoding: 'utf8' });
  g(d, ['init', '-q', '--bare', '-b', 'main', 'remote.git']);
  g(d, ['clone', '-q', 'remote.git', 'a']);
  g(d, ['clone', '-q', 'remote.git', 'b']);
  const a = join(d, 'a'), b = join(d, 'b'), rem = join(d, 'remote.git');
  writeFileSync(join(a, 'f'), '1\n');
  g(a, ['add', '.']); g(a, ['commit', '-qm', 'init']); g(a, ['push', '-q', 'origin', 'HEAD:main']);
  g(b, ['pull', '-q', 'origin', 'main']);
  return { g, a, b, rem };
}
const gitEnv = { GIT_AUTHOR_NAME: 'n', GIT_AUTHOR_EMAIL: 'a@b', GIT_COMMITTER_NAME: 'n', GIT_COMMITTER_EMAIL: 'a@b' };

test('git_push_rebased clean pushes', () => {
  const { g, a, b, rem } = gitSetup();
  writeFileSync(join(a, 'g'), 'x\n'); g(a, ['add', '.']); g(a, ['commit', '-qm', 'a2']); g(a, ['push', '-q', 'origin', 'HEAD:main']);
  writeFileSync(join(b, 'h'), 'y\n'); g(b, ['add', '.']); g(b, ['commit', '-qm', 'b2']);
  const r = sh(`source ${ROOT}/lib/git-push.sh; git_push_rebased main`, gitEnv, b);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(g(rem, ['rev-parse', 'main']).stdout, g(b, ['rev-parse', 'HEAD']).stdout);
});

test('git_push_rebased conflict aborts', () => {
  const { g, a, b, rem } = gitSetup();
  writeFileSync(join(a, 'f'), 'A\n'); g(a, ['commit', '-qam', 'a2']); g(a, ['push', '-q', 'origin', 'HEAD:main']);
  writeFileSync(join(b, 'f'), 'B\n'); g(b, ['commit', '-qam', 'b2']);
  const before = g(rem, ['rev-parse', 'main']).stdout;
  const r = sh(`source ${ROOT}/lib/git-push.sh; git_push_rebased main`, gitEnv, b);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /rebase aborted/);
  assert.equal(g(rem, ['rev-parse', 'main']).stdout, before);
  assert.equal(existsSync(join(b, '.git/rebase-merge')), false);
});

test('pw_result filters Result section', () => {
  const rep = '### Page\nurl\n### Result\nline1\nline2\n### Snapshot\nzzz\n';
  for (const shell of ['bash', 'zsh']) {
    const r = sh(`source ${ROOT}/lib/pw.sh; printf '%s' "$REP" | pw_result`, { REP: rep }, ROOT, shell);
    assert.equal(r.stdout, 'line1\nline2\n');
  }
});
