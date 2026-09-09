#!/usr/bin/env node
// build-image-manifest.mjs — Turn captured knowledge-page images into a
// download-images.mjs --input manifest. One entry per UNIQUE image src across
// all pages, keyed by hashSrc(src) so publish-knowledge-da.mjs can map each
// captured <img> back to its rehosted DA url by the same key.
//
// Usage: node build-image-manifest.mjs [--config-dir of1/config]
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

function parseArgs(argv) {
  const args = { configDir: 'of1/config', output: '/tmp/knowledge-image-manifest.json' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config-dir') args.configDir = argv[++i];
    else if (argv[i] === '--output') args.output = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.join(args.configDir, 'knowledge-pages.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`${manifestPath} not found — capture step must run first`);
  const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const manifest = buildManifest(entries);
  fs.writeFileSync(args.output, JSON.stringify(manifest, null, 2));
  console.log(`✓ ${manifest.length} unique knowledge image(s) → ${args.output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(`FATAL: ${e.message}`); process.exit(1); }
}
