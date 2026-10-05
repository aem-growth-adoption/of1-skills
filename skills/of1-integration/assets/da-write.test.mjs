import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSheetJson, buildMultipart, writeDa, resolveToken } from './da-write.mjs';

const SCRIPT = fileURLToPath(new URL('./da-write.mjs', import.meta.url));

test('buildSheetJson projects rows to columns', () => {
  const out = buildSheetJson(
    [{ name: 'A', keywords: ['x', 'y'], explore: 0.2 }],
    ['id', 'name', 'keywords', 'explore'],
  );
  assert.deepEqual(out, {
    total: 1,
    limit: 1,
    offset: 0,
    data: [{ id: '', name: 'A', keywords: 'x, y', explore: '0.2' }],
    ':type': 'sheet',
  });
});

test('buildSheetJson drops keys not in columns', () => {
  const out = buildSheetJson([{ label: 'L', query: 'Q', extra: 'nope' }], ['label', 'query']);
  assert.deepEqual(out.data, [{ label: 'L', query: 'Q' }]);
});

test('buildSheetJson throws when an array item contains a comma', () => {
  assert.throws(
    () => buildSheetJson([{ keywords: ['ok', 'a,b'] }], ['keywords']),
    /comma/,
  );
});

test('buildMultipart uses field "data" with filename and content type', () => {
  const { body, contentType } = buildMultipart('<p>x</p>', 'b.html', 'text/html');
  const s = Buffer.from(body).toString('utf8');
  assert.match(s, /name="data"; filename="b\.html"/);
  assert.match(s, /Content-Type: text\/html/);
  assert.match(s, /<p>x<\/p>/);
  const boundary = contentType.match(/^multipart\/form-data; boundary=(.+)$/)[1];
  assert.ok(s.startsWith(`--${boundary}\r\n`));
  assert.ok(s.endsWith(`\r\n--${boundary}--\r\n`));
});

test('buildMultipart accepts Uint8Array content', () => {
  const { body } = buildMultipart(new Uint8Array([104, 105]), 'x.json', 'application/json');
  assert.match(Buffer.from(body).toString('utf8'), /\r\n\r\nhi\r\n--/);
});

function fakeFetch(statusFor) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    const status = statusFor(url);
    return { ok: status >= 200 && status < 300, status };
  };
  return { impl, calls };
}

const base = { owner: 'O', repo: 'R', branch: 'B', token: 'T' };

test('writeDa sheet: uploads .json then previews with both auth headers', async () => {
  const { impl, calls } = fakeFetch(() => 200);
  const res = await writeDa({ ...base, kind: 'sheet', path: '/of1/config/personas', content: '{}', fetchImpl: impl });
  assert.deepEqual(res, { ok: true, message: '✓ of1/config/personas.json previewed' });
  assert.equal(calls[0].url, 'https://admin.da.live/source/O/R/of1/config/personas.json');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer T');
  assert.match(calls[0].opts.headers['Content-Type'], /^multipart\/form-data; boundary=/);
  assert.equal(calls[1].url, 'https://admin.hlx.page/preview/O/R/B/of1/config/personas.json');
  assert.equal(calls[1].opts.method, 'POST');
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer T');
  assert.equal(calls[1].opts.headers['x-content-source-authorization'], 'Bearer T');
});

test('writeDa doc: uploads .html and previews extensionless path', async () => {
  const { impl, calls } = fakeFetch(() => 201);
  const res = await writeDa({ ...base, kind: 'doc', path: 'of1/brand-voice', content: '<body></body>', fetchImpl: impl });
  assert.equal(res.ok, true);
  assert.equal(res.message, '✓ of1/brand-voice previewed');
  assert.equal(calls[0].url, 'https://admin.da.live/source/O/R/of1/brand-voice.html');
  assert.equal(calls[1].url, 'https://admin.hlx.page/preview/O/R/B/of1/brand-voice');
});

test('writeDa reports preview 403 on a sheet write', async () => {
  const { impl } = fakeFetch((u) => (u.includes('/preview/') ? 403 : 200));
  const res = await writeDa({ ...base, kind: 'sheet', path: 'of1/config/personas', content: '{}', fetchImpl: impl });
  assert.deepEqual(res, { ok: false, message: 'FAIL preview of1/config/personas.json HTTP 403' });
});

test('writeDa reports upload 401 and skips preview', async () => {
  const { impl, calls } = fakeFetch(() => 401);
  const res = await writeDa({ ...base, kind: 'doc', path: 'of1/brand-voice', content: 'x', fetchImpl: impl });
  assert.deepEqual(res, { ok: false, message: 'FAIL upload of1/brand-voice.html HTTP 401' });
  assert.equal(calls.length, 1);
});

test('writeDa reports network errors as failures', async () => {
  const impl = async () => { throw new Error('boom'); };
  const res = await writeDa({ ...base, kind: 'doc', path: 'of1/brand-voice', content: 'x', fetchImpl: impl });
  assert.equal(res.ok, false);
  assert.match(res.message, /^FAIL upload of1\/brand-voice\.html ERROR boom$/);
});

test('CLI: sheet preview 403 → stderr FAIL line, exit 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'da-write-'));
  const rows = path.join(dir, 'rows.json');
  fs.writeFileSync(rows, JSON.stringify([{ label: 'a', query: 'b' }]));
  const preload = path.join(dir, 'stub.mjs');
  fs.writeFileSync(preload, `globalThis.fetch = async (u) => ({ ok: !u.includes('/preview/'), status: u.includes('/preview/') ? 403 : 200 });\n`);
  const r = spawnSync(process.execPath, [
    '--import', preload, SCRIPT, 'sheet',
    '--owner', 'O', '--repo', 'R', '--branch', 'B',
    '--path', 'of1/config/suggestions', '--columns', 'label,query', '--rows', rows,
  ], { encoding: 'utf8', env: { ...process.env, DA_TOKEN: 'T' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAIL preview of1\/config\/suggestions\.json HTTP 403/);
  assert.doesNotMatch(r.stdout, /previewed/);
});

test('CLI: doc success → stdout ✓ line, exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'da-write-'));
  const file = path.join(dir, 'bv.html');
  fs.writeFileSync(file, '<body><main><div><p>hi</p></div></main></body>');
  const preload = path.join(dir, 'stub.mjs');
  fs.writeFileSync(preload, `globalThis.fetch = async () => ({ ok: true, status: 200 });\n`);
  const r = spawnSync(process.execPath, [
    '--import', preload, SCRIPT, 'doc',
    '--owner', 'O', '--repo', 'R', '--branch', 'B',
    '--path', 'of1/brand-voice', '--file', file,
  ], { encoding: 'utf8', env: { ...process.env, DA_TOKEN: 'T' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ of1\/brand-voice previewed/);
});

test('CLI: runs when invoked through a symlink', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'da-write-'));
  const link = path.join(dir, 'da-write-link.mjs');
  fs.symlinkSync(SCRIPT, link);
  const file = path.join(dir, 'bv.html');
  fs.writeFileSync(file, '<body></body>');
  const preload = path.join(dir, 'stub.mjs');
  fs.writeFileSync(preload, `globalThis.fetch = async () => ({ ok: true, status: 200 });\n`);
  const r = spawnSync(process.execPath, [
    '--import', preload, link, 'doc',
    '--owner', 'O', '--repo', 'R', '--branch', 'B',
    '--path', 'of1/brand-voice', '--file', file,
  ], { encoding: 'utf8', env: { ...process.env, DA_TOKEN: 'T' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ of1\/brand-voice previewed/);
});

test('resolveToken: token file JSON without access_token throws', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'da-write-'));
  const f = path.join(dir, 'tok.json');
  fs.writeFileSync(f, JSON.stringify({ refresh_token: 'r' }));
  const saved = { DA_TOKEN: process.env.DA_TOKEN, ADOBE_IMS_TOKEN: process.env.ADOBE_IMS_TOKEN, OF1_TOKEN_FILE: process.env.OF1_TOKEN_FILE };
  delete process.env.DA_TOKEN; delete process.env.ADOBE_IMS_TOKEN;
  process.env.OF1_TOKEN_FILE = f;
  try {
    await assert.rejects(resolveToken(), /access_token/);
    fs.writeFileSync(f, JSON.stringify({ access_token: 'abc' }));
    assert.equal(await resolveToken(), 'abc');
    fs.writeFileSync(f, 'raw-token\n');
    assert.equal(await resolveToken(), 'raw-token');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('CLI: rows containing a comma in an array item → exit 1, mentions comma', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'da-write-'));
  const rows = path.join(dir, 'rows.json');
  fs.writeFileSync(rows, JSON.stringify([{ id: 'p', keywords: ['sugar, free'] }]));
  const preload = path.join(dir, 'stub.mjs');
  fs.writeFileSync(preload, `globalThis.fetch = async () => { throw new Error('should not fetch'); };\n`);
  const r = spawnSync(process.execPath, [
    '--import', preload, SCRIPT, 'sheet',
    '--owner', 'O', '--repo', 'R', '--branch', 'B',
    '--path', 'of1/config/personas', '--columns', 'id,keywords', '--rows', rows,
  ], { encoding: 'utf8', env: { ...process.env, DA_TOKEN: 'T' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /comma/);
});
