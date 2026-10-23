#!/usr/bin/env node
// Compose a DA template document from HARVESTED real blocks (of1-build-templates intent phase).
//
// Spec (JSON):
//   { "intent": "comparison", "description": "…", "minItems": 2, "maxItems": 2,
//     "ctaHref": "/of1",                       // optional: every link in the template points here
//     "sections": [
//       { "block": "hero-split", "pick": 0,    // which harvested instance (default 0)
//         "keepRows": [0, 1],                  // optional: keep only these direct child rows, in this order
//         "replace": [["Old text", "New text"]],        // exact text -> new text (HTML-escaped); fails if not found
//         "images": [{ "url": "https://…", "alt": "…" }] } // real images for the block's content pictures, in order
//     ] }
//
// Everything not replaced stays exactly as the site authored it (structure, variants, real photos),
// which is the point: a template that looks like the site because it IS the site's own markup.
//
// CLI: node compose-template.mjs --harvest harvest.json --spec spec.json --out template.html

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { classifyImage } from './template-images.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

/** Keep only the given direct child rows (by index, in the given order) of a block's outer html. */
export function keepRows(blockHtml, idxs) {
  const open = /^<div\b[^>]*>/i.exec(blockHtml)[0];
  const inner = blockHtml.slice(open.length, blockHtml.lastIndexOf('</div>'));
  const rows = [];
  let depth = 0;
  let start = 0;
  for (const m of inner.matchAll(/<div\b[^>]*>|<\/div\s*>/gi)) {
    if (m[0].startsWith('</')) { depth -= 1; if (depth === 0) rows.push(inner.slice(start, m.index + m[0].length)); continue; }
    if (depth === 0) start = m.index;
    depth += 1;
  }
  for (const i of idxs) if (!Number.isInteger(i) || i < 0 || i >= rows.length) throw new Error(`keepRows: row ${i} does not exist (block has ${rows.length} rows)`);
  return `${open}${idxs.map((i) => rows[i]).join('')}</div>`;
}

const ICON_PX = 64;
// Content picture = a <picture> (or bare <img>) whose image is not an icon (svg / <=64px).
function contentPictureRanges(html) {
  const out = [];
  for (const m of html.matchAll(/<picture\b[\s\S]*?<\/picture>|<img\b[^>]*>/gi)) {
    if (out.length && m.index < out[out.length - 1].end) continue; // <img> already inside a counted <picture>
    const tag = /<img\b[^>]*>/i.exec(m[0])?.[0] || '';
    const src = /\ssrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1] || '';
    const w = Number(/\swidth="(\d+)"/i.exec(tag)?.[1]);
    const h = Number(/\sheight="(\d+)"/i.exec(tag)?.[1]);
    if (/\.svg(?:[?#]|$)/i.test(src) || (w > 0 && w <= ICON_PX) || (h > 0 && h <= ICON_PX)) continue;
    out.push({ start: m.index, end: m.index + m[0].length, tag });
  }
  return out;
}

function swapImages(html, images, block) {
  const ranges = contentPictureRanges(html);
  if (images.length > ranges.length) throw new Error(`${block}: ${images.length} image(s) given but the block has only ${ranges.length} content picture(s)`);
  let out = '';
  let last = 0;
  images.forEach((im, i) => {
    if (classifyImage(im.url)) throw new Error(`${block}: "${im.url}" is not a real image (${classifyImage(im.url)}) — use an image from the harvested pool`);
    const u = escAttr(im.url);
    const wh = /(?:\swidth="\d+")?(?:\sheight="\d+")?/.exec(ranges[i].tag)?.[0] || '';
    out += html.slice(last, ranges[i].start)
      + `<picture><source srcset="${u}" media="(min-width: 600px)"><source srcset="${u}"><img loading="lazy" alt="${escAttr(im.alt || '')}" src="${u}"${wh}></picture>`;
    last = ranges[i].end;
  });
  return out + html.slice(last);
}

/** spec + harvest -> { html } (a `<body>` document ready for da_put). Throws on anything it cannot do faithfully. */
export function composeTemplate(spec, harvest) {
  if (!Array.isArray(spec.sections) || spec.sections.length === 0) throw new Error('spec needs at least one section');
  for (const k of ['description', 'intent']) if (/,/.test(String(spec[k] ?? ''))) throw new Error(`section-metadata ${k} must not contain a comma`);
  const sections = spec.sections.map((s) => {
    const list = harvest.blocks?.[s.block];
    if (!list?.length) throw new Error(`no harvested block "${s.block}" (harvested: ${Object.keys(harvest.blocks || {}).join(', ') || 'none'})`);
    const pick = s.pick ?? 0;
    if (!list[pick]) throw new Error(`${s.block}: pick ${pick} does not exist (${list.length} harvested)`);
    let html = list[pick].html;
    if (s.keepRows) html = keepRows(html, s.keepRows);
    for (const [from, to] of s.replace || []) {
      if (!html.includes(from)) throw new Error(`"${from}" not found in ${s.block} (pick ${pick}) — copy the text exactly as harvested`);
      html = html.replace(from, esc(to));
    }
    if (s.images?.length) html = swapImages(html, s.images, s.block);
    return html;
  });
  let body = sections.map((h) => `<div>${h}</div>`);
  if (spec.ctaHref) body = body.map((h) => h.replace(/(\shref)="[^"]*"/gi, `$1="${escAttr(spec.ctaHref)}"`));
  const meta = [['Template Intent', spec.intent], ['Template Description', spec.description], ['Template Min Items', spec.minItems], ['Template Max Items', spec.maxItems]]
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<div><div>${k}</div><div>${esc(v)}</div></div>`).join('');
  body[body.length - 1] = body[body.length - 1].replace(/<\/div>$/, `<div class="section-metadata">${meta}</div></div>`);
  return { html: `<body><header></header><main>${body.join('')}</main><footer></footer></body>` };
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
}
if (isDirectRun()) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const [hf, sf, out] = [arg('--harvest'), arg('--spec'), arg('--out')];
  if (!hf || !sf || !out) { console.error('usage: compose-template.mjs --harvest harvest.json --spec spec.json --out template.html'); process.exit(2); }
  try {
    const { html } = composeTemplate(JSON.parse(fs.readFileSync(sf, 'utf8')), JSON.parse(fs.readFileSync(hf, 'utf8')));
    fs.writeFileSync(out, html);
    console.log(`✓ composed ${out}`);
  } catch (e) { console.error(`FAIL: ${e.message}`); process.exit(1); }
}
