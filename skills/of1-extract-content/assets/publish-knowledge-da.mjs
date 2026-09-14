#!/usr/bin/env node
// publish-knowledge-da.mjs — Publish captured page content as bare DA docs
// under of1/knowledge/{slug}, then EDS-preview them so {slug}.plain.html is
// live for the gen-web content-RAG (contentIngestion includePaths
// ["/of1/knowledge/**"]). Content, not craft: <h1> + <h2>/<p>/<li>, no blocks.
//
// Input:  of1/config/knowledge-pages.json  (array of {slug?,url?,title,blocks})
// Output: of1/knowledge/{slug}.html (DA) + EDS preview per page
//
// Usage: node publish-knowledge-da.mjs --owner O --repo R --branch B
//        [--config-dir of1/config] [--knowledge-dir of1/knowledge]
//        [--token-file path] [--concurrency 8]
//
// Token resolution order: --token-file, $DA_TOKEN, $ADOBE_IMS_TOKEN,
// $OF1_TOKEN_FILE, `oauth-token adobe`, ./.hlx/.da-token.json.

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

async function resolveToken(tokenFileArg) {
  if (tokenFileArg) return readTokenFile(tokenFileArg);
  if (process.env.DA_TOKEN) return process.env.DA_TOKEN;
  if (process.env.ADOBE_IMS_TOKEN) return process.env.ADOBE_IMS_TOKEN;
  if (process.env.OF1_TOKEN_FILE) return readTokenFile(process.env.OF1_TOKEN_FILE);
  try {
    const { stdout } = await exec('oauth-token adobe');
    if (stdout.trim()) return stdout.trim();
  } catch { /* SLICC shim absent */ }
  if (fs.existsSync('.hlx/.da-token.json')) return readTokenFile('.hlx/.da-token.json');
  throw new Error('Could not resolve DA token. Pass --token-file, set $DA_TOKEN/$ADOBE_IMS_TOKEN, or place .hlx/.da-token.json.');
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function hashSrc(src) {
  return crypto.createHash('sha1').update(String(src || '').trim()).digest('hex').slice(0, 12);
}

export function slugify(input) {
  const s = String(input || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'page';
}

export function resolveSlug(entry) {
  if (entry.slug) return slugify(entry.slug);
  let last = '';
  try { last = new URL(entry.url).pathname.split('/').filter(Boolean).pop() || ''; }
  catch { last = String(entry.url || '').split('/').filter(Boolean).pop() || ''; }
  return slugify(last);
}

const HEADINGS = new Set(['h1', 'h2', 'h3']);

export function renderContentDoc(entry, imageMap = {}) {
  const title = String(entry.title || '').trim();
  const parts = [`<h1>${escapeHtml(entry.title || '')}</h1>`];
  const blocks = Array.isArray(entry.blocks) ? entry.blocks : [];
  let liRun = [];
  const flushLi = () => {
    if (liRun.length) { parts.push(`<ul>${liRun.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`); liRun = []; }
  };
  for (const b of blocks) {
    if (b?.tag === 'img') {
      const mapped = imageMap[hashSrc(String(b.src || ''))];
      const url = Array.isArray(mapped) ? mapped[0] : mapped;
      if (!url) continue; // rehost failed/absent → drop the image, keep the doc
      flushLi();
      // Wrap in <p> like EDS default-content so the worker chunker (which reads
      // <img> from inside a matched block) picks it up.
      parts.push(`<p><img src="${escapeHtml(url)}" alt="${escapeHtml(b.alt || '')}"></p>`);
      continue;
    }
    const text = String(b?.text || '').trim();
    if (!text) continue;
    if (text === title) continue; // drop captured block that repeats the title (no duplicate h1)
    const tag = HEADINGS.has(b.tag) ? b.tag : (b.tag === 'li' ? 'li' : 'p');
    if (tag === 'li') { liRun.push(text); continue; }
    flushLi();
    parts.push(`<${tag}>${escapeHtml(text)}</${tag}>`);
  }
  flushLi();
  return `<body>\n<header></header>\n<main>\n<div>\n${parts.join('\n')}\n</div>\n</main>\n<footer></footer>\n</body>`;
}

// Backward-compatible text-only renderer (no image map).
export function renderKnowledgeDoc(entry) {
  return renderContentDoc(entry, {});
}

async function uploadDoc(html, token, owner, repo, docPath) {
  const boundary = '----DABoundary' + crypto.randomBytes(8).toString('hex');
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="data"; filename="${path.basename(docPath)}"\r\nContent-Type: text/html\r\n\r\n`;
  const body = `${header}${html}\r\n--${boundary}--\r\n`;
  const resp = await fetch(`https://admin.da.live/source/${owner}/${repo}/${docPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  return resp.ok ? null : `upload HTTP ${resp.status}`;
}

async function triggerPreview(token, owner, repo, branch, resourcePath) {
  try {
    const resp = await fetch(`https://admin.hlx.page/preview/${owner}/${repo}/${branch}/${resourcePath}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    return resp.ok ? null : `preview HTTP ${resp.status}`;
  } catch (e) { return `preview error: ${e.message}`; }
}

async function triggerLive(token, owner, repo, branch, resourcePath) {
  // Publish to LIVE — the EDS query-index indexer builds only from published
  // pages, so preview alone leaves /of1/knowledge out of query-index.json and
  // the worker's content-RAG discovers nothing.
  try {
    const resp = await fetch(`https://admin.hlx.page/live/${owner}/${repo}/${branch}/${resourcePath}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    return resp.ok ? null : `live HTTP ${resp.status}`;
  } catch (e) { return `live error: ${e.message}`; }
}

function parseArgs(argv) {
  const args = { configDir: 'of1/config', knowledgeDir: 'of1/knowledge', concurrency: 8 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--owner') args.owner = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--branch') args.branch = argv[++i];
    else if (a === '--config-dir') args.configDir = argv[++i];
    else if (a === '--knowledge-dir') args.knowledgeDir = argv[++i];
    else if (a === '--token-file') args.tokenFile = argv[++i];
    else if (a === '--concurrency') args.concurrency = parseInt(argv[++i], 10) || 8;
    else if (a === '--image-map') args.imageMap = argv[++i];
  }
  if (!args.owner || !args.repo || !args.branch) throw new Error('Missing required --owner / --repo / --branch');
  return args;
}

async function publishEntry(entry, token, args, seen, imageMap) {
  let slug = resolveSlug(entry);
  // Dedupe collisions by suffixing a short hash of the source url/title.
  if (seen.has(slug)) {
    const h = crypto.createHash('sha1').update(entry.url || entry.title || slug).digest('hex').slice(0, 6);
    slug = `${slug}-${h}`;
  }
  seen.add(slug);
  const docPath = `${args.knowledgeDir}/${slug}.html`;
  const resourcePath = `${args.knowledgeDir}/${slug}`;
  const html = renderContentDoc(entry, imageMap || {});
  const upErr = await uploadDoc(html, token, args.owner, args.repo, docPath);
  if (upErr) return { slug, ok: false, err: upErr };
  const prevErr = await triggerPreview(token, args.owner, args.repo, args.branch, resourcePath);
  if (prevErr) return { slug, ok: false, err: prevErr };
  const liveErr = await triggerLive(token, args.owner, args.repo, args.branch, resourcePath);
  if (liveErr) return { slug, ok: false, err: liveErr };
  return { slug, ok: true, resourcePath: `/${resourcePath}` };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = await resolveToken(args.tokenFile);
  const manifestPath = path.join(args.configDir, 'knowledge-pages.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`${manifestPath} not found — capture step must run first`);
  const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('knowledge-pages.json is empty or not an array');
  const imageMap = args.imageMap && fs.existsSync(args.imageMap)
    ? JSON.parse(fs.readFileSync(args.imageMap, 'utf8'))
    : {};

  const results = [];
  const seen = new Set();
  for (let i = 0; i < entries.length; i += args.concurrency) {
    const batch = entries.slice(i, i + args.concurrency);
    results.push(...await Promise.all(batch.map((e) => publishEntry(e, token, args, seen, imageMap))));
  }

  const ok = results.filter((r) => r.ok);
  for (const r of results) console.log(r.ok ? `  ✓ ${r.resourcePath}` : `  ✗ ${r.slug}: ${r.err}`);
  const failed = results.length - ok.length;
  if (failed > 0) { console.error(`\n✗ ${failed} knowledge page(s) failed`); process.exit(1); }
  console.log(`\n✓ ${ok.length} knowledge page(s) published to DA under of1/knowledge/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`FATAL: ${e.message}`); process.exit(1); });
}
