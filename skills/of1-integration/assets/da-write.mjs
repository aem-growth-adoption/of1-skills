#!/usr/bin/env node
// da-write.mjs — Write an OF1 DA doc or sheet, then EDS-preview it.
//
// Usage:
//   node da-write.mjs doc   --owner O --repo R --path of1/brand-voice --file <html>
//   node da-write.mjs sheet --owner O --repo R --path of1/config/personas \
//                           --columns a,b,c --rows <json-file>
//   node da-write.mjs live  --owner O --repo R --path of1/config/config.json
//
// doc   → POST multipart admin.da.live/source/O/R/<path>.html, then
//         POST admin.hlx.page/preview/O/R/B/<path>
// sheet → POST multipart admin.da.live/source/O/R/<path>.json, then
//         POST admin.hlx.page/preview/O/R/B/<path>.json
//
// Non-2xx on upload or preview → stderr `FAIL <step> <path> HTTP <status>`, exit 1
// (upload 401/403 adds a "DA token expired or invalid" hint).
// Success → stdout `✓ <path> previewed`.
//
// Token resolution order: $DA_TOKEN, $ADOBE_IMS_TOKEN, $OF1_TOKEN_FILE,
// ./.hlx/.da-token.json, $OF1_DEMO_REPO/.hlx/.da-token.json.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveToken, buildMultipart, daUpload, aemAction, TOKEN_HINT } from '../../../lib/da-client.mjs';


export { resolveToken, buildMultipart, TOKEN_HINT };

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
  // Matches what the da.live sheet editor saves (single sheet named "data");
  // EDS strips :sheetname when serving <path>.json.
  return { total: data.length, limit: data.length, offset: 0, data, ':sheetname': 'data', ':type': 'sheet' };
}

function normalizePath(p) {
  return String(p).replace(/^\/+/, '').replace(/\.(html|json)$/, '');
}

// Upload `content` to DA and preview it. Returns { ok, message }; never throws
// on HTTP/network failure.
export async function writeDa({ kind, owner, repo, path: p, content, token, fetchImpl = globalThis.fetch }) {
  if (kind !== 'doc' && kind !== 'sheet') throw new Error(`Unknown kind "${kind}" (expected doc|sheet)`);
  const base = normalizePath(p);
  const ext = kind === 'doc' ? 'html' : 'json';
  const sourcePath = `${base}.${ext}`;
  const previewPath = kind === 'doc' ? base : sourcePath;
  const mime = kind === 'doc' ? 'text/html' : 'application/json';

  const upErr = await daUpload({ owner, repo, path: sourcePath, content, contentType: mime, token, fetchImpl });
  if (upErr) return { ok: false, message: upErr };

  const prevErr = await aemAction({ action: 'preview', owner, repo, path: previewPath, token, fetchImpl });
  if (prevErr) return { ok: false, message: prevErr };

  return { ok: true, message: `✓ ${previewPath} previewed` };
}

// Publish an already-previewed path to the live index.
export async function publishLive({ owner, repo, path: p, token, fetchImpl = globalThis.fetch }) {
  const livePath = String(p).replace(/^\/+/, '');
  const err = await aemAction({ action: 'live', owner, repo, path: livePath, token, fetchImpl });
  return err ? { ok: false, message: err } : { ok: true, message: `✓ ${livePath} published live` };
}

function parseArgs(argv) {
  const [kind, ...rest] = argv;
  const args = { kind };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--owner') args.owner = rest[++i];
    else if (a === '--repo') args.repo = rest[++i];
    else if (a === '--path') args.path = rest[++i];
    else if (a === '--file') args.file = rest[++i];
    else if (a === '--columns') args.columns = rest[++i];
    else if (a === '--rows') args.rows = rest[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!['doc', 'sheet', 'live'].includes(kind)) throw new Error('First argument must be "doc", "sheet" or "live"');
  for (const k of ['owner', 'repo', 'path']) if (!args[k]) throw new Error(`Missing --${k}`);
  if (kind === 'doc' && !args.file) throw new Error('Missing --file');
  if (kind === 'sheet' && (!args.columns || !args.rows)) throw new Error('Missing --columns / --rows');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.kind === 'live') {
    const res = await publishLive({ ...args, token: await resolveToken() });
    if (!res.ok) { console.error(res.message); process.exit(1); }
    console.log(res.message);
    return;
  }
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

// Compare against the realpath: Node resolves import.meta.url through
// symlinks, but argv[1] keeps the symlinked path (symlinked installs are common).
function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((e) => { console.error(`FATAL: ${e.message}`); process.exit(1); });
}
