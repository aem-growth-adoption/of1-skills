import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
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
const cfg = { owner: 'Acme', repo: 'Site', branch: 'main', domain: 'www.acme.com' };
const dump = `source ${ROOT}/lib/env.sh; of1_load_env || exit 7; echo "$OWNER|$REPO|$BRANCH|$DOMAIN|$PREVIEW_BASE|$TENANT_ID|$WORKER_URL|$PREVIEW_HOST|$PROXY_HOST|$PROXY_BASE"`;

for (const shell of ['bash', 'zsh']) {
  test(`of1_load_env exports all vars (${shell})`, () => {
    const r = run(dump, { OF1_STATE_DIR: state(cfg) }, shell);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'Acme|Site|main|www.acme.com|https://main--Site--Acme.aem.page|acme/site|https://of1-gen-web-service.franklin-prod.workers.dev|main--Site--Acme.aem.page|main--site--acme|https://main--site--acme.of1.live');
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

test('of1_sync posts org/repo path with stage and ref', () => {
  const d = mkdtempSync(join(tmpdir(), 'of1sync-'));
  mkdirSync(join(d, 'bin'));
  writeFileSync(join(d, 'bin', 'curl'), `#!/bin/bash\nprintf '%s\\n' "$*" > ${d}/argv\nprintf '{"ok":true}\\n200'\n`, { mode: 0o755 });
  const out = join(d, 'o.json');
  const r = spawnSync('bash', ['-c', `. ${ROOT}/lib/genweb.sh; BRANCH=feat DA_TOKEN=t of1_sync https://w acme/site ${out} publish`], { encoding: 'utf8', env: { PATH: `${join(d, 'bin')}:${process.env.PATH}` } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(d, 'argv'), 'utf8'), /https:\/\/w\/api\/tenants\/acme\/site\/sync\?stage=publish&ref=feat/);
});

test('of1_sync URL-encodes the branch and omits ref when empty', () => {
  const d = mkdtempSync(join(tmpdir(), 'of1sync-'));
  mkdirSync(join(d, 'bin'));
  writeFileSync(join(d, 'bin', 'curl'), `#!/bin/bash\nprintf '%s\\n' "$*" > ${d}/argv\nprintf '{"ok":true}\\n200'\n`, { mode: 0o755 });
  const call = (branch) => {
    spawnSync('bash', ['-c', `. ${ROOT}/lib/genweb.sh; BRANCH='${branch}' DA_TOKEN=t of1_sync https://w acme/site ${d}/o.json`], { encoding: 'utf8', env: { PATH: `${join(d, 'bin')}:${process.env.PATH}` } });
    return readFileSync(join(d, 'argv'), 'utf8');
  };
  assert.match(call('feat/x'), /stage=preview&ref=feat%2Fx/);
  assert.doesNotMatch(call(''), /ref=/);
});

test('dev worker host adds the --dev proxy suffix; OF1_PROXY_SUFFIX overrides (also empty)', () => {
  const proxy = (env) => run(dump, { OF1_STATE_DIR: state(cfg), ...env }).stdout.trim().split('|').slice(8).join('|');
  assert.equal(proxy({ OF1_GENWEB_URL: 'https://of1-gen-web-service-dev.franklin-prod.workers.dev' }), 'main--site--acme--dev|https://main--site--acme--dev.of1.live');
  assert.equal(proxy({ OF1_GENWEB_URL: 'https://of1-gen-web-service-dev.franklin-prod.workers.dev', OF1_PROXY_SUFFIX: '--alice' }), 'main--site--acme--alice|https://main--site--acme--alice.of1.live');
  assert.equal(proxy({ OF1_GENWEB_URL: 'https://of1-gen-web-service-dev.franklin-prod.workers.dev', OF1_PROXY_SUFFIX: '' }), 'main--site--acme|https://main--site--acme.of1.live');
  assert.equal(proxy({}), 'main--site--acme|https://main--site--acme.of1.live');
});
