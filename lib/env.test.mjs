import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (script, env = {}, shell = 'bash') =>
  spawnSync(shell, ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
const state = (cfg) => {
  const d = mkdtempSync(join(tmpdir(), 'of1env-'));
  if (cfg) writeFileSync(join(d, 'repo-config.json'), JSON.stringify(cfg));
  return d;
};
const cfg = { owner: 'acme', repo: 'site', branch: 'main', domain: 'www.acme.com' };
const dump = `source ${ROOT}/lib/env.sh; of1_load_env || exit 7; echo "$OWNER|$REPO|$BRANCH|$DOMAIN|$PREVIEW_BASE|$TENANT_ID|$WORKER_URL|$PREVIEW_HOST"`;

for (const shell of ['bash', 'zsh']) {
  test(`of1_load_env exports all vars (${shell})`, () => {
    const r = run(dump, { OF1_STATE_DIR: state(cfg) }, shell);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'acme|site|main|www.acme.com|https://main--site--acme.aem.page|main--site--acme|https://of1-gen-web-service.franklin-prod.workers.dev|main--site--acme.aem.page');
  });
}

test('OF1_GENWEB_URL override', () => {
  const r = run(dump, { OF1_STATE_DIR: state(cfg), OF1_GENWEB_URL: 'http://x.test' });
  assert.equal(r.stdout.trim().split('|')[6], 'http://x.test');
});

test('missing file fails', () => {
  const d = state(null);
  const r = run(dump, { OF1_STATE_DIR: d });
  assert.equal(r.status, 7);
  assert.equal(r.stderr.trim(), `FAIL: cannot read ${d}/repo-config.json`);
});

test('missing branch fails', () => {
  const d = state({ owner: 'a', repo: 'b' });
  const r = run(dump, { OF1_STATE_DIR: d });
  assert.equal(r.status, 7);
  assert.match(r.stderr, /FAIL: cannot read/);
});
