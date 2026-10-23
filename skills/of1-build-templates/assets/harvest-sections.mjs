#!/usr/bin/env node
// Harvest the site's REAL authored blocks (of1-build-templates base phase).
//
// A template composed of invented markup and invented images looks nothing like the site. The
// site's own migrated pages already contain good, decorated-ready compositions with real photos:
// this tool fetches their `.plain.html`, splits out every top-level block, makes every URL
// absolute, and pools the real content images. `compose-template.mjs` then assembles templates
// from these blocks instead of from imagination.
//
// CLI:  node harvest-sections.mjs --base https://main--r--o.aem.page --out harvest.json
//         [--paths /en,/en/services]   (default: pages from /sitemap.json or /query-index.json)
//         [--max 12]                   (page cap, default 12)

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { classifyImage } from './template-images.mjs';

const NON_BLOCKS = new Set(['section-metadata', 'metadata']);
const SKIP_PATH = /^\/(?:of1|templates|nav|footer|fragments?|drafts?|tools|redirects?)(?:\/|$)|\/(?:redirects?|nav|footer)$/i;
const ICON_PX = 64;
const decode = (u) => String(u).replace(/&#x26;|&#38;|&amp;/gi, '&').trim();

/** Top-level blocks of a `.plain.html`: [{name, classes, rows, html}]. Skips section-metadata and default content. */
export function splitBlocks(html) {
  const src = String(html || '');
  const re = /<div\b([^>]*)>|<\/div\s*>/gi;
  const blocks = [];
  let depth = 0;
  let start = -1;
  let cls = '';
  for (const m of src.matchAll(re)) {
    if (m[0].startsWith('</')) {
      depth = Math.max(0, depth - 1);
      if (start >= 0 && depth === 1) {
        const outer = src.slice(start, m.index + m[0].length);
        const name = cls.split(/\s+/)[0];
        if (!NON_BLOCKS.has(name)) blocks.push({ name, classes: cls, rows: countRows(outer), html: outer });
        start = -1;
      }
      continue;
    }
    if (depth === 1 && start < 0) {
      const c = /\bclass\s*=\s*"([^"]*)"/i.exec(m[1] || '');
      if (c && c[1].trim()) { start = m.index; cls = c[1].trim().replace(/\s+/g, ' '); }
    }
    depth += 1;
  }
  return blocks;
}

/** Direct child rows of a block's outer html. */
export function countRows(blockHtml) {
  let depth = 0;
  let rows = 0;
  for (const m of String(blockHtml).matchAll(/<div\b[^>]*>|<\/div\s*>/gi)) {
    if (m[0].startsWith('</')) { depth -= 1; continue; }
    if (depth === 1) rows += 1;
    depth += 1;
  }
  return rows;
}

function resolveUrl(u, pageUrl) {
  const v = u.trim();
  if (!v || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(v)) return /^\/\//.test(v) ? `https:${v}` : u;
  try { return new URL(v, pageUrl).href; } catch { return u; }
}

/** Make src / srcset / href absolute against the page the HTML came from. */
export function absolutizeHtml(html, pageUrl) {
  return String(html || '')
    .replace(/(\s(?:src|href))\s*=\s*"([^"]*)"/gi, (_m, a, v) => `${a}="${resolveUrl(v, pageUrl)}"`)
    .replace(/(\ssrcset)\s*=\s*"([^"]*)"/gi, (_m, a, v) => `${a}="${v.split(',').map((c) => { const [u, ...rest] = c.trim().split(/\s+/); return [resolveUrl(u, pageUrl), ...rest].join(' '); }).join(', ')}"`);
}

function isIcon(tag, url) {
  if (/\.svg(?:[?#]|$)/i.test(url)) return true;
  const w = Number(/\swidth="(\d+)"/i.exec(tag)?.[1]);
  const h = Number(/\sheight="(\d+)"/i.exec(tag)?.[1]);
  return (w > 0 && w <= ICON_PX) || (h > 0 && h <= ICON_PX);
}

/** Real content images (no icons, no placeholders) of a block, in order: [{url, alt}]. */
export function contentImages(html) {
  const out = [];
  for (const m of String(html).matchAll(/<img\b[^>]*>/gi)) {
    const src = /\ssrc\s*=\s*"([^"]*)"/i.exec(m[0]);
    if (!src) continue;
    const url = decode(src[1]);
    if (classifyImage(url) || isIcon(m[0], url)) continue;
    out.push({ url, alt: decode(/\salt\s*=\s*"([^"]*)"/i.exec(m[0])?.[1] ?? '') });
  }
  return out;
}

const textOf = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** pages: [{url, html}] -> {pages, blocks: {name: [{page, classes, rows, images, text, html}]}, images: [{url, alt, page}]}. */
export function harvest(pages) {
  const out = { pages: [], blocks: {}, images: [] };
  const seen = new Set();
  for (const { url, html } of pages) {
    out.pages.push(url);
    for (const b of splitBlocks(html)) {
      const abs = absolutizeHtml(b.html, url);
      const imgs = contentImages(abs);
      (out.blocks[b.name] ||= []).push({ page: url, classes: b.classes, rows: b.rows, images: imgs.length, text: textOf(abs).slice(0, 140), html: abs });
      for (const im of imgs) if (!seen.has(im.url)) { seen.add(im.url); out.images.push({ ...im, page: url }); }
    }
  }
  return out;
}

/** Content page paths from a site index ({data:[{path}]}): drops OF1 / templates / nav / fragments / drafts. */
export function selectPaths(index, max = 12) {
  const rows = Array.isArray(index?.data) ? index.data : [];
  return rows.map((r) => r?.path).filter((p) => typeof p === 'string' && p.startsWith('/') && !SKIP_PATH.test(p)).slice(0, max);
}

async function main(argv) {
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const base = arg('--base');
  const outFile = arg('--out');
  if (!base || !outFile) { console.error('usage: harvest-sections.mjs --base <https://main--repo--org.aem.page> --out <file> [--paths /a,/b] [--max 12]'); process.exit(2); }
  const max = Number(arg('--max', 12));
  let paths = arg('--paths') ? arg('--paths').split(',').map((p) => p.trim()).filter(Boolean) : [];
  if (!paths.length) {
    for (const idx of ['/sitemap.json', '/query-index.json']) {
      const r = await fetch(`${base}${idx}`).catch(() => null);
      if (r?.ok) { paths = selectPaths(await r.json().catch(() => ({})), max); if (paths.length) break; }
    }
  }
  if (!paths.length) { console.error(`FAIL: no pages to harvest (no --paths, and ${base}/sitemap.json | query-index.json lists no content pages)`); process.exit(1); }
  const pages = [];
  for (const p of paths.slice(0, max)) {
    const url = `${base}${p === '/' ? '/index' : p}`;
    const r = await fetch(`${url}.plain.html`).catch(() => null);
    if (r?.ok) pages.push({ url, html: await r.text() });
    else console.error(`WARN: ${url}.plain.html not served — skipped`);
  }
  const h = harvest(pages);
  if (!pages.length || !Object.keys(h.blocks).length) { console.error('FAIL: harvested no blocks'); process.exit(1); }
  fs.writeFileSync(outFile, JSON.stringify(h, null, 1));
  const counts = Object.entries(h.blocks).map(([k, v]) => `${k}×${v.length}`).join(' ');
  console.log(`✓ harvested ${pages.length} page(s): ${counts}; ${h.images.length} real image(s) → ${outFile}`);
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
}
if (isDirectRun()) main(process.argv.slice(2));
