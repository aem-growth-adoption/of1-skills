#!/usr/bin/env node
// da-write.mjs — Write an OF1 DA doc or sheet, then EDS-preview it.
//
// Usage:
//   node da-write.mjs doc   --owner O --repo R --branch B --path of1/brand-voice --file <html>
//   node da-write.mjs sheet --owner O --repo R --branch B --path of1/config/personas \
//                           --columns a,b,c --rows <json-file>
//
// doc   → POST multipart admin.da.live/source/O/R/<path>.html, then
//         POST admin.hlx.page/preview/O/R/B/<path>
// sheet → POST multipart admin.da.live/source/O/R/<path>.json, then
//         POST admin.hlx.page/preview/O/R/B/<path>.json
//
// Non-2xx on upload or preview → stderr `FAIL <step> <path> HTTP <status>`, exit 1.
// Success → stdout `✓ <path> previewed`.
//
// Token resolution order: $DA_TOKEN, $ADOBE_IMS_TOKEN, $OF1_TOKEN_FILE,
// `oauth-token adobe`, ./.hlx/.da-token.json, $OF1_DEMO_REPO/.hlx/.da-token.json.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execCb);

function readTokenFile(p) {
  const raw = fs.readFileSync(p, 'utf8').trim();
  try { return JSON.parse(raw).access_token || raw; } catch { return raw; }
}

export async function resolveToken() {
  if (process.env.DA_TOKEN) return process.env.DA_TOKEN;
  if (process.env.ADOBE_IMS_TOKEN) return process.env.ADOBE_IMS_TOKEN;
  if (process.env.OF1_TOKEN_FILE) return readTokenFile(process.env.OF1_TOKEN_FILE);
  try {
    const { stdout } = await exec('oauth-token adobe');
    if (stdout.trim()) return stdout.trim();
  } catch { /* SLICC shim absent */ }
  if (fs.existsSync('.hlx/.da-token.json')) return readTokenFile('.hlx/.da-token.json');
  if (process.env.OF1_DEMO_REPO) {
    const p = path.join(process.env.OF1_DEMO_REPO, '.hlx', '.da-token.json');
    if (fs.existsSync(p)) return readTokenFile(p);
  }
  throw new Error('Could not resolve DA token. Set $DA_TOKEN/$ADOBE_IMS_TOKEN/$OF1_TOKEN_FILE, or place .hlx/.da-token.json.');
}

function cell(value, column) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      if (String(item).includes(',')) {
        throw new Error(`Column "${column}" array item contains a comma: ${JSON.stringify(item)} — consumers split on comma`);
      }
    }
    return value.map((v) => String(v)).join(', ');
  }
  return String(value);
}

export function buildSheetJson(rows, columns) {
  const data = rows.map((row) => {
    const out = {};
    for (const c of columns) out[c] = cell(row?.[c], c);
    return out;
  });
  return { total: data.length, limit: data.length, offset: 0, data, ':type': 'sheet' };
}

export function buildMultipart(content, filename, contentType) {
  const boundary = '----DABoundary' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="data"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const payload = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  return { body: Buffer.concat([head, payload, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

function normalizePath(p) {
  return String(p).replace(/^\/+/, '').replace(/\.(html|json)$/, '');
}

async function step(name, label, fetchImpl, url, opts) {
  try {
    const resp = await fetchImpl(url, opts);
    return resp.ok ? null : `FAIL ${name} ${label} HTTP ${resp.status}`;
  } catch (e) {
    return `FAIL ${name} ${label} ERROR ${e.message}`;
  }
}

// Upload `content` to DA and preview it. Returns { ok, message }; never throws
// on HTTP/network failure.
export async function writeDa({ kind, owner, repo, branch, path: p, content, token, fetchImpl = globalThis.fetch }) {
  if (kind !== 'doc' && kind !== 'sheet') throw new Error(`Unknown kind "${kind}" (expected doc|sheet)`);
  const base = normalizePath(p);
  const ext = kind === 'doc' ? 'html' : 'json';
  const sourcePath = `${base}.${ext}`;
  const previewPath = kind === 'doc' ? base : sourcePath;
  const mime = kind === 'doc' ? 'text/html' : 'application/json';

  const { body, contentType } = buildMultipart(content, path.posix.basename(sourcePath), mime);
  const upErr = await step('upload', sourcePath, fetchImpl, `https://admin.da.live/source/${owner}/${repo}/${sourcePath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body,
  });
  if (upErr) return { ok: false, message: upErr };

  const prevErr = await step('preview', previewPath, fetchImpl, `https://admin.hlx.page/preview/${owner}/${repo}/${branch}/${previewPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-content-source-authorization': `Bearer ${token}` },
  });
  if (prevErr) return { ok: false, message: prevErr };

  return { ok: true, message: `✓ ${previewPath} previewed` };
}

function parseArgs(argv) {
  const [kind, ...rest] = argv;
  const args = { kind };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--owner') args.owner = rest[++i];
    else if (a === '--repo') args.repo = rest[++i];
    else if (a === '--branch') args.branch = rest[++i];
    else if (a === '--path') args.path = rest[++i];
    else if (a === '--file') args.file = rest[++i];
    else if (a === '--columns') args.columns = rest[++i];
    else if (a === '--rows') args.rows = rest[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (kind !== 'doc' && kind !== 'sheet') throw new Error('First argument must be "doc" or "sheet"');
  for (const k of ['owner', 'repo', 'branch', 'path']) if (!args[k]) throw new Error(`Missing --${k}`);
  if (kind === 'doc' && !args.file) throw new Error('Missing --file');
  if (kind === 'sheet' && (!args.columns || !args.rows)) throw new Error('Missing --columns / --rows');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let content;
  if (args.kind === 'doc') {
    content = fs.readFileSync(args.file, 'utf8');
  } else {
    const rows = JSON.parse(fs.readFileSync(args.rows, 'utf8'));
    if (!Array.isArray(rows)) throw new Error(`${args.rows} must contain a JSON array of rows`);
    const columns = args.columns.split(',').map((c) => c.trim()).filter(Boolean);
    content = JSON.stringify(buildSheetJson(rows, columns));
  }
  const token = await resolveToken();
  const res = await writeDa({ ...args, content, token });
  if (!res.ok) { console.error(res.message); process.exit(1); }
  console.log(res.message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`FATAL: ${e.message}`); process.exit(1); });
}
