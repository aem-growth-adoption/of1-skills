import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, identity, prereqs, pages } from './cli.mjs';

const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));

test('unknown command exits 2 with the command list', () => {
  const r = spawnSync('node', [cli, 'bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Commands: identity, pages, prereqs/);
});

test('identity from git remote', async () => {
  const r = await identity({ exec: () => 'git@github.com:O/R.git\n' });
  assert.equal(r.site, 'o/r');
  assert.equal(r.hosts.proxy, 'https://main--r--o--dev.of1.live');
});

test('run prints json and returns the command code', async () => {
  let out = '';
  const code = await run(['x', '--json'], { x: async () => ({ result: { a: 1 }, code: 1 }) }, { write: (s) => { out += s; } });
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(out), { a: 1 });
});

const cwd = fileURLToPath(new URL('.', import.meta.url));
const exec = () => 'https://github.com/o/r\n';
const list = (status) => async () => ({ ok: status === 200, status, json: async () => [] });

test('prereqs: missing token', async () => {
  const r = await prereqs({ exec, cwd, resolve: async () => { throw new Error('x'); } });
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('da-token'));
});

test('prereqs: DA list statuses', async () => {
  const run1 = (status) => prereqs({ exec, cwd, resolve: async () => 't', fetchImpl: list(status) });
  assert.ok(!(await run1(200)).missing.some((m) => m.startsWith('da-')));
  for (const s of [401, 403]) assert.ok((await run1(s)).missing.some((m) => m.startsWith('da-token-invalid') && m.includes('DA token expired')), String(s));
  assert.ok((await run1(500)).missing.some((m) => m.startsWith('da-unreachable')));
});

test('prereqs: bad remote is reported as repo', async () => {
  const r = await prereqs({ exec: () => 'https://gitlab.com/o/r', cwd, resolve: async () => 't', fetchImpl: list(200) });
  assert.ok(r.missing.some((m) => m.startsWith('repo: origin is not a GitHub repo')));
  assert.ok(!r.missing.some((m) => m.startsWith('da-access')));
});

test('pages command proposes live pages and reports skipped', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/gone')) return { ok: false, status: 404 };
    return { ok: false, status: url.endsWith('/sitemap.xml') ? 404 : 200, text: async () => '' };
  };
  const r = await pages(['--domain', 'none', '--pages', '["/a","/gone"]'], { fetchImpl, exec: () => 'https://github.com/o/r' });
  assert.equal(r.origin, 'https://main--r--o.aem.live');
  assert.deepEqual(r.proposal, [{ path: '/a', type: 'nav' }]);
  assert.deepEqual(r.skipped, [{ path: '/gone', reason: 'not-live' }]);
});
