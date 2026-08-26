#!/usr/bin/env node
// publish-config-da.mjs — Publish tenant config files to DA as `of1-config`
// key/value block documents so they can be edited in Document Authoring.
//
// The OF1 worker's /api/tenants/:id/sync endpoint reads these files from DA
// (`.plain.html`), parses each `of1-config` block into one record, and falls
// back to the committed `of1/config/{file}.json` only when the DA doc is missing
// or parses to zero records. This script generates the DA doc for each file from
// the JSON the extract-content skill already produced, uploads it to DA's source
// store, and triggers an EDS preview so `{file}.plain.html` goes live.
//
// It does NOT delete the committed JSON — that stays as the fallback safety net
// (see of1-gen-web docs/da-config-authoring.md § "Migrating a tenant to DA").
//
// Usage:
//   node publish-config-da.mjs \
//     --owner aem-growth-adoption \
//     --repo of1-demo-orchestrator \
//     --branch wknd-2 \
//     [--config-dir of1/config] \
//     [--files products,features,faqs] \
//     [--token-file path/to/token.json]
//
// Token resolution order (first that works wins):
//   1. --token-file <path>
//   2. $DA_TOKEN env var (raw token)
//   3. $ADOBE_IMS_TOKEN env var (raw token, Claude Code convention)
//   4. $OF1_TOKEN_FILE env var (path to token JSON)
//   5. `oauth-token adobe` (SLICC shim)
//   6. ./.hlx/.da-token.json (project default)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCb);

// Per-file field layout. Keys mirror the worker's CONFIG_SCHEMAS exactly — the
// parser lowercases both the doc's row key and the schema field name before
// matching, so a camelCase label like `useCase`/`productIds` round-trips, but a
// spaced label ("Use Case") would NOT match. Never introduce spaces in labels.
//   order  — fields emitted, in this order, when present in the JSON record
//   list   — rendered as a <ul><li>… list (one item per bullet)
//   images — rendered as inline <img> (parser collects them as an ordered array)
export const FILE_FIELDS = {
  products: {
    idFrom: 'name',
    order: ['name', 'price', 'currency', 'category', 'description', 'url', 'persona', 'useCase', 'keywords', 'highlights', 'features', 'images'],
    list: new Set(['keywords', 'highlights', 'features']),
    images: new Set(['images']),
  },
  features: {
    idFrom: 'name',
    order: ['name', 'description', 'category', 'productIds'],
    list: new Set(['productIds']),
    images: new Set(),
  },
  faqs: {
    idFrom: 'question',
    order: ['question', 'answer', 'category', 'relatedProducts'],
    list: new Set(['relatedProducts']),
    images: new Set(),
  },
  knowledge: {
    idFrom: 'title',
    order: ['title', 'description', 'keywords', 'facts', 'images', 'persona', 'useCase'],
    list: new Set(['keywords', 'facts']),
    images: new Set(['images']),
  },
};

function parseArgs(argv) {
  const args = { configDir: 'of1/config', files: ['products', 'features', 'faqs'] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--owner') args.owner = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--branch') args.branch = argv[++i];
    else if (a === '--config-dir') args.configDir = argv[++i];
    else if (a === '--files') args.files = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--token-file') args.tokenFile = argv[++i];
  }
  if (!args.owner || !args.repo || !args.branch) {
    throw new Error('Missing required --owner / --repo / --branch');
  }
  return args;
}

function readTokenFile(p) {
  const raw = fs.readFileSync(p, 'utf8').trim();
  try {
    return JSON.parse(raw).access_token || raw;
  } catch {
    return raw;
  }
}

async function resolveToken(tokenFileArg) {
  if (tokenFileArg) return readTokenFile(tokenFileArg);
  if (process.env.DA_TOKEN) return process.env.DA_TOKEN;
  if (process.env.ADOBE_IMS_TOKEN) return process.env.ADOBE_IMS_TOKEN;
  if (process.env.OF1_TOKEN_FILE) return readTokenFile(process.env.OF1_TOKEN_FILE);
  try {
    const { stdout } = await exec('oauth-token adobe');
    const trimmed = stdout.trim();
    if (trimmed) return trimmed;
  } catch (e) { /* ignore — SLICC shim not available */ }
  for (const candidate of ['.hlx/.da-token.json']) {
    if (fs.existsSync(candidate)) return readTokenFile(candidate);
  }
  throw new Error(
    'Could not resolve DA token. Pass --token-file, set $DA_TOKEN/$ADOBE_IMS_TOKEN, '
    + 'or place token JSON at .hlx/.da-token.json.',
  );
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Render one field's value cell. Lists become a bullet list (so commas inside an
// item survive); images become inline <img> tags; everything else is plain text.
function renderValue(field, value, spec) {
  if (spec.list.has(field)) {
    const items = (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean);
    if (items.length === 0) return null;
    return `<ul>${items.map((it) => `<li>${escapeHtml(it)}</li>`).join('')}</ul>`;
  }
  if (spec.images.has(field)) {
    const urls = (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean);
    if (urls.length === 0) return null;
    return urls.map((u) => `<picture><img src="${escapeHtml(u)}" alt=""></picture>`).join('');
  }
  const text = String(value).trim();
  return text === '' ? null : escapeHtml(text);
}

export function recordToBlock(record, spec) {
  const rows = [];
  // Pin the id explicitly so cross-file references (persona/useCase/productIds)
  // stay stable rather than being re-derived by slugify on every sync.
  if (record.id) rows.push(['id', escapeHtml(record.id)]);
  for (const field of spec.order) {
    if (record[field] === undefined || record[field] === null) continue;
    const cell = renderValue(field, record[field], spec);
    if (cell === null) continue;
    rows.push([field, cell]);
  }
  const rowHtml = rows.map(([k, v]) => `<div><div>${k}</div><div>${v}</div></div>`).join('\n');
  return `<div class="of1-config">\n${rowHtml}\n</div>`;
}

export function recordsToDoc(records, spec) {
  const blocks = records.map((r) => recordToBlock(r, spec)).join('\n');
  return `<body>\n<header></header>\n<main>\n<div>\n${blocks}\n</div>\n</main>\n<footer></footer>\n</body>`;
}

async function uploadDoc(html, token, owner, repo, docPath) {
  // DA source expects multipart/form-data with field name "data" (a raw PUT
  // returns 2xx but doesn't persist). Same convention as media uploads.
  const boundary = '----DABoundary' + crypto.randomBytes(8).toString('hex');
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="data"; filename="${path.basename(docPath)}"\r\nContent-Type: text/html\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  const body = `${header}${html}${footer}`;

  const url = `https://admin.da.live/source/${owner}/${repo}/${docPath}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  if (!resp.ok) return `upload HTTP ${resp.status}`;
  return null;
}

async function triggerPreview(token, owner, repo, branch, resourcePath) {
  // Publish the doc into EDS so {resourcePath}.plain.html is live and the worker
  // sync can fetch it. Without this the doc only exists in DA's source store.
  const url = `https://admin.hlx.page/preview/${owner}/${repo}/${branch}/${resourcePath}`;
  try {
    const resp = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return `preview HTTP ${resp.status}`;
  } catch (e) {
    return `preview error: ${e.message}`;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = await resolveToken(args.tokenFile);

  const results = [];
  for (const file of args.files) {
    const spec = FILE_FIELDS[file];
    if (!spec) {
      results.push({ file, ok: false, err: `unknown file (not one of ${Object.keys(FILE_FIELDS).join(', ')})` });
      continue;
    }
    const jsonPath = path.join(args.configDir, `${file}.json`);
    if (!fs.existsSync(jsonPath)) {
      results.push({ file, ok: false, err: `${jsonPath} not found` });
      continue;
    }
    let records;
    try {
      records = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (e) {
      results.push({ file, ok: false, err: `invalid JSON: ${e.message}` });
      continue;
    }
    if (!Array.isArray(records) || records.length === 0) {
      results.push({ file, ok: false, err: 'empty or non-array JSON' });
      continue;
    }

    const html = recordsToDoc(records, spec);
    const docPath = `${args.configDir}/${file}.html`;
    const resourcePath = `${args.configDir}/${file}`;

    const upErr = await uploadDoc(html, token, args.owner, args.repo, docPath);
    if (upErr) {
      results.push({ file, ok: false, err: upErr });
      continue;
    }
    const prevErr = await triggerPreview(token, args.owner, args.repo, args.branch, resourcePath);
    if (prevErr) {
      results.push({ file, ok: false, err: prevErr, count: records.length });
      continue;
    }
    results.push({ file, ok: true, count: records.length });
  }

  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`  ✓ ${r.file}: ${r.count} record(s) published to DA (of1/config/${r.file})`);
    } else {
      failed++;
      console.log(`  ✗ ${r.file}: ${r.err}`);
    }
  }
  if (failed > 0) {
    console.error(`\n✗ ${failed} file(s) failed to publish to DA`);
    process.exit(1);
  }
  console.log('\n✓ All config files published to DA as of1-config blocks');
}

import { pathToFileURL } from 'node:url';

// Only run the CLI when invoked directly, so the render helpers can be imported
// (e.g. by tests) without executing the upload path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`FATAL: ${e.message}`);
    process.exit(1);
  });
}
