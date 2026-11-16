import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveToken, buildMultipart, daUpload, daGet, daList, aemAction, TOKEN_HINT } from './da-client.mjs';

const KEYS = ['DA_TOKEN', 'ADOBE_IMS_TOKEN', 'OF1_TOKEN_FILE'];

async function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try { return await fn(); } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('resolveToken: DA_TOKEN wins and exec is not called', async () => {
  await withEnv({ DA_TOKEN: 'da' }, async () => {
    const exec = () => { throw new Error('should not run'); };
    assert.equal(await resolveToken({ exec }), 'da');
  });
});

test('resolveToken: without DA_TOKEN runs da-auth-helper and trims stdout', async () => {
  await withEnv({}, async () => {
    let seen;
    const exec = (...a) => { seen = a; return 'tok123\n'; };
    assert.equal(await resolveToken({ exec }), 'tok123');
    assert.equal(seen[0], 'npx');
    assert.deepEqual(seen[1], ['-y', 'github:adobe-rnd/da-auth-helper', 'token']);
  });
});

test('resolveToken: exec failure gives the no-token error', async () => {
  await withEnv({}, async () => {
    await assert.rejects(resolveToken({ exec: () => { throw new Error('x'); } }),
      { message: 'No DA token: set DA_TOKEN or sign in with da-auth-helper' });
  });
});

test('resolveToken: ADOBE_IMS_TOKEN / OF1_TOKEN_FILE alone are ignored', async () => {
  await withEnv({ ADOBE_IMS_TOKEN: 'ims', OF1_TOKEN_FILE: '/nope' }, async () => {
    await assert.rejects(resolveToken({ exec: () => { throw new Error('x'); } }), /No DA token/);
  });
});

test('TOKEN_HINT text', () => {
  assert.equal(TOKEN_HINT, 'DA token expired or invalid — set DA_TOKEN or run da-auth-helper again');
});

test('daGet: returns status and text; 404 is not an error', async () => {
  const r = await daGet({ org: 'O', repo: 'R', path: 'a/b.html', token: 'T',
    fetchImpl: async (u, o) => { assert.equal(u, 'https://admin.da.live/source/O/R/a/b.html'); assert.equal(o.headers.Authorization, 'Bearer T'); return { status: 200, text: async () => 'hi' }; } });
  assert.deepEqual(r, { status: 200, text: 'hi' });
  const nf = await daGet({ org: 'O', repo: 'R', path: 'x', token: 'T', fetchImpl: async () => ({ status: 404, text: async () => '' }) });
  assert.equal(nf.status, 404);
});

test('daList: maps the DA list JSON', async () => {
  let url;
  const r = await daList({ org: 'O', repo: 'R', path: 'templates', token: 'T',
    fetchImpl: async (u) => { url = u; return { ok: true, status: 200, json: async () => ([{ path: '/R/templates/a', ext: 'html', name: 'a', lastModified: 1 }, { path: '/R/templates/sub' }]) }; } });
  assert.equal(url, 'https://admin.da.live/list/O/R/templates');
  assert.deepEqual(r, [{ path: '/R/templates/a', ext: 'html' }, { path: '/R/templates/sub' }]);
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
  const ok = await daUpload({ org: 'O', repo: 'R', path: 'a/b.html', content: 'x', contentType: 'text/html', token: 'T',
    fetchImpl: async (u, o) => { calls.push([u, o]); return { ok: true, status: 200 }; } });
  assert.equal(ok, null);
  assert.equal(calls[0][0], 'https://admin.da.live/source/O/R/a/b.html');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer T');
  const bad = await daUpload({ org: 'O', repo: 'R', path: 'a/b.html', content: 'x', contentType: 'text/html', token: 'T',
    fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.match(bad, /^FAIL upload a\/b\.html HTTP 401 — DA token expired or invalid/);
});

test('aemAction: live sends both auth headers to the expected URL', async () => {
  let seen;
  const r = await aemAction({ action: 'live', org: 'O', repo: 'R', path: 'of1/x', token: 'T',
    fetchImpl: async (u, o) => { seen = [u, o]; return { ok: true, status: 200 }; } });
  assert.equal(r, null);
  assert.equal(seen[0], 'https://admin.hlx.page/live/O/R/main/of1/x');
  assert.equal(seen[1].method, 'POST');
  assert.equal(seen[1].headers.Authorization, 'Bearer T');
  assert.equal(seen[1].headers['x-content-source-authorization'], 'Bearer T');
});
