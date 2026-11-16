import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, identity, prereqs } from './cli.mjs';

const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));

test('unknown command exits 2 with the command list', () => {
  const r = spawnSync('node', [cli, 'bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Commands: identity, prereqs/);
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

test('prereqs reports missing token and 401', async () => {
  const exec = () => 'https://github.com/o/r\n';
  const cwd = fileURLToPath(new URL('.', import.meta.url));
  const noTok = await prereqs({ exec, cwd, resolve: async () => { throw new Error('x'); } });
  assert.equal(noTok.ok, false);
  assert.ok(noTok.missing.includes('da-token'));
  const r401 = await prereqs({ exec, cwd, resolve: async () => 't', fetchImpl: async () => ({ status: 401, text: async () => '' }) });
  assert.ok(r401.missing.includes('da-token-invalid'));
});
