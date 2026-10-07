#!/usr/bin/env node
// Richness check for a DA template's EDS `.plain.html` (of1-build-templates assemble).
//
// `.plain.html` is the undecorated document: top-level section <div>s, each
// holding block wrappers `<div class="NAME[ variant…]">` whose rows/cells are
// classless <div>s. There is NO `block` class (decorateBlocks() adds it in the
// browser), so we count classed <div>s opened at section level (depth 1).
//
// CLI: reads plain.html on stdin, prints "<contentBlocks> <maxItems>" (maxItems
// empty when the template has no `Template Max Items` row).

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const NON_CONTENT = new Set(['section-metadata', 'metadata']);

/** Number of block wrappers directly inside sections, excluding section-metadata / metadata. */
export function countContentBlocks(html) {
  const re = /<div\b([^>]*)>|<\/div\s*>/gi;
  let depth = 0;
  let n = 0;
  for (const m of String(html || '').matchAll(re)) {
    if (m[0].startsWith('</')) { depth = Math.max(0, depth - 1); continue; }
    if (depth === 1) {
      const cls = /\bclass\s*=\s*"([^"]*)"/i.exec(m[1] || '');
      const name = cls && cls[1].trim().split(/\s+/)[0];
      if (name && !NON_CONTENT.has(name)) n += 1;
    }
    depth += 1;
  }
  return n;
}

/** `Template Max Items` value from section-metadata, or null. Multi-line safe. */
export function maxItems(html) {
  const flat = String(html || '').replace(/\s+/g, ' ');
  const m = /Template Max Items\s*(?:<\/[a-z0-9]+>\s*)+<div>\s*(?:<p>\s*)?(\d+)/i.exec(flat);
  return m ? Number(m[1]) : null;
}

// Compare against the realpath: Node resolves import.meta.url through
// symlinks, but argv[1] keeps the symlinked path (installed skills are symlinks).
function isDirectRun() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
}

if (isDirectRun()) {
  const html = fs.readFileSync(0, 'utf8');
  const mi = maxItems(html);
  process.stdout.write(`${countContentBlocks(html)} ${mi === null ? '' : mi}\n`);
}
