import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveToken, buildMultipart, daUpload, aemAction } from './da-client.mjs';

const KEYS = ['DA_TOKEN', 'ADOBE_IMS_TOKEN', 'OF1_TOKEN_FILE', 'OF1_DEMO_REPO'];

async function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-'));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  process.chdir(tmp);
  try { return await fn(tmp); } finally {
    process.chdir(cwd);
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('resolveToken: precedence tokenFile > DA_TOKEN > ADOBE_IMS_TOKEN > OF1_TOKEN_FILE', async () => {
  await withEnv({}, async (tmp) => {
    const a = path.join(tmp, 'a.json'); fs.writeFileSync(a, JSON.stringify({ access_token: 'fromArg' }));
    const b = path.join(tmp, 'b.json'); fs.writeFileSync(b, JSON.stringify({ access_token: 'fromEnvFile' }));
    process.env.OF1_TOKEN_FILE = b;
    assert.equal(await resolveToken(), 'fromEnvFile');
    process.env.ADOBE_IMS_TOKEN = 'ims';
    assert.equal(await resolveToken(), 'ims');
    process.env.DA_TOKEN = 'da';
    assert.equal(await resolveToken(), 'da');
    assert.equal(await resolveToken({ tokenFile: a }), 'fromArg');
  });
});

test('resolveToken: ./.hlx/.da-token.json then $OF1_DEMO_REPO; else throws', async () => {
  await withEnv({}, async (tmp) => {
    await assert.rejects(resolveToken(), /Could not resolve DA token/);
    const demo = path.join(tmp, 'demo', '.hlx'); fs.mkdirSync(demo, { recursive: true });
    fs.writeFileSync(path.join(demo, '.da-token.json'), JSON.stringify({ access_token: 'demo' }));
    process.env.OF1_DEMO_REPO = path.join(tmp, 'demo');
    assert.equal(await resolveToken(), 'demo');
    fs.mkdirSync('.hlx'); fs.writeFileSync('.hlx/.da-token.json', JSON.stringify({ access_token: 'local' }));
    assert.equal(await resolveToken(), 'local');
  });
});

test('buildMultipart: boundary header and both CRLF delimiters', () => {
  const { body, contentType } = buildMultipart('hi', 'x.html', 'text/html');
  const m = contentType.match(/^multipart\/form-data; boundary=(.+)$/);
  assert.ok(m);
  const s = body.toString('utf8');
  assert.ok(s.startsWith(`--${m[1]}\r\n`));
  assert.ok(s.includes('filename="x.html"'));
  assert.ok(s.endsWith(`\r\n--${m[1]}--\r\n`));
});

test('daUpload: null on 200; FAIL + token hint on 401', async () => {
  const calls = [];
  const ok = await daUpload({ owner: 'O', repo: 'R', path: 'a/b.html', content: 'x', contentType: 'text/html', token: 'T',
    fetchImpl: async (u, o) => { calls.push([u, o]); return { ok: true, status: 200 }; } });
  assert.equal(ok, null);
  assert.equal(calls[0][0], 'https://admin.da.live/source/O/R/a/b.html');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer T');
  const bad = await daUpload({ owner: 'O', repo: 'R', path: 'a/b.html', content: 'x', contentType: 'text/html', token: 'T',
    fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.match(bad, /^FAIL upload a\/b\.html HTTP 401 — DA token expired or invalid/);
});

test('aemAction: live sends both auth headers to the expected URL', async () => {
  let seen;
  const r = await aemAction({ action: 'live', owner: 'O', repo: 'R', path: 'of1/x', token: 'T',
    fetchImpl: async (u, o) => { seen = [u, o]; return { ok: true, status: 200 }; } });
  assert.equal(r, null);
  assert.equal(seen[0], 'https://admin.hlx.page/live/O/R/main/of1/x');
  assert.equal(seen[1].method, 'POST');
  assert.equal(seen[1].headers.Authorization, 'Bearer T');
  assert.equal(seen[1].headers['x-content-source-authorization'], 'Bearer T');
});
