#!/usr/bin/env node
// Fillability of a DA template's `.plain.html` for the OF1 worker (of1-build-templates assemble).
//
// The worker turns every block cell into one slot and the model writes text into it. A cell
// holding a <picture> is an image slot, whatever else it holds, so its text can never be
// written; a block with nothing to write, or repeated rows without text, is always dropped
// from the answer. Mirrors gen-web `pipeline/lib/slot-address.js` (roleOf, label/value rows).
//
// CLI: reads plain.html on stdin; prints one problem per line and exits 1, else exits 0.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const NON_BLOCKS = new Set(['section-metadata', 'metadata']);
const ICON_PX = 64;

/** Direct child divs of an element's inner HTML: [{ attrs, inner }]. */
function childDivs(html) {
  const out = [];
  let depth = 0;
  let start = -1;
  let attrs = '';
  for (const m of String(html).matchAll(/<div\b([^>]*)>|<\/div\s*>/gi)) {
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0 && start >= 0) out.push({ attrs, inner: html.slice(start, m.index) });
      continue;
    }
    if (depth === 0) { start = m.index + m[0].length; attrs = m[1] || ''; }
    depth += 1;
  }
  return out;
}

const text = (h) => String(h).replace(/<picture\b[\s\S]*?<\/picture>|<img\b[^>]*>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
const hasPicture = (h) => [...String(h).matchAll(/<img\b[^>]*>/gi)].some(([tag]) => {
  const src = /\ssrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1] || '';
  const w = Number(/\swidth="(\d+)"/i.exec(tag)?.[1]);
  return !/\.svg(?:[?#]|$)/i.test(src) && !(w > 0 && w <= ICON_PX);
});

// Label/value rows (gen-web detectLabelValueRows): 2-3 cells, first cell short plain text,
// on 2 or more rows. The label cell is fixed text, never a slot.
function labelRows(rows) {
  const isLabel = (cells) => cells.length >= 2 && cells.length <= 3 && !/<(picture|img|a)\b/i.test(cells[0])
    && text(cells[0]) && text(cells[0]).split(/\s+/).length <= 4;
  const hits = rows.map((cells, i) => (isLabel(cells) ? i : -1)).filter((i) => i >= 0);
  return new Set(hits.length >= 2 ? hits : []);
}

/** Problems that make a template block unfillable, one string per problem. */
export function slotProblems(html) {
  const main = /<main>([\s\S]*)<\/main>/i.exec(html)?.[1] ?? html;
  const problems = [];
  childDivs(main).forEach((section, si) => {
    childDivs(section.inner).forEach((blockDiv, bi) => {
      const name = /\bclass\s*=\s*"([^"]*)"/i.exec(blockDiv.attrs)?.[1]?.trim();
      if (!name || NON_BLOCKS.has(name.split(/\s+/)[0])) return;
      const rows = childDivs(blockDiv.inner).map((row) => {
        const cells = childDivs(row.inner).map((c) => c.inner);
        return cells.length ? cells : [row.inner];
      });
      const labels = labelRows(rows);
      let writable = 0;
      rows.forEach((cells, ri) => cells.forEach((cell, ci) => {
        if (labels.has(ri) && ci === 0) return;
        if (hasPicture(cell)) {
          if (text(cell)) problems.push(`${name} (section ${si + 1}, block ${bi + 1}) row ${ri + 1} cell ${ci + 1}: picture and text in one cell, the text can't be written`);
        } else if (text(cell) || /<a\b/i.test(cell)) writable += 1;
      }));
      if (!writable) problems.push(`${name} (section ${si + 1}, block ${bi + 1}): nothing to write (only pictures or labels), the block is always dropped`);
    });
  });
  return problems;
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
}
if (isDirectRun()) {
  const problems = slotProblems(fs.readFileSync(0, 'utf8'));
  if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
}
