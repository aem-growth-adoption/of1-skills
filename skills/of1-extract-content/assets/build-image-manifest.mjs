#!/usr/bin/env node
// build-image-manifest.mjs — Turn captured knowledge-page images into a
// download-images.mjs --input manifest. One entry per UNIQUE image src across
// all pages, keyed by hashSrc(src) so publish-knowledge-da.mjs can map each
// captured <img> back to its rehosted DA url by the same key.
//
// Usage: node build-image-manifest.mjs [--pages $OF1_STATE_DIR/knowledge-pages.json]
//        [--output /tmp/knowledge-image-manifest.json]

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashSrc } from './publish-knowledge-da.mjs';

export function buildManifest(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const seen = new Set();
  const manifest = [];
  for (const entry of list) {
    const blocks = Array.isArray(entry?.blocks) ? entry.blocks : [];
    for (const b of blocks) {
      if (b?.tag !== 'img') continue;
      const src = String(b.src || '').trim();
      if (!src || seen.has(src)) continue;
      seen.add(src);
      manifest.push({ productId: hashSrc(src), urls: [src] });
    }
  }
  return manifest;
}

export function parseArgs(argv) {
  const args = {
    pages: path.join(process.env.OF1_STATE_DIR || '.', 'knowledge-pages.json'),
    output: '/tmp/knowledge-image-manifest.json',
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pages') args.pages = argv[++i];
    else if (argv[i] === '--output') args.output = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args.pages;
  if (!fs.existsSync(manifestPath)) throw new Error(`${manifestPath} not found — capture step must run first`);
  const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const manifest = buildManifest(entries);
  fs.writeFileSync(args.output, JSON.stringify(manifest, null, 2));
  console.log(`✓ ${manifest.length} unique knowledge image(s) → ${args.output}`);
}

// Compare against the realpath: Node resolves import.meta.url through
// symlinks, but argv[1] keeps the symlinked path.
function isDirectRun() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
}

if (isDirectRun()) {
  try { main(); } catch (e) { console.error(`FATAL: ${e.message}`); process.exit(1); }
}
