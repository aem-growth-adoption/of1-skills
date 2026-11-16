#!/usr/bin/env node
// Image validity for a DA template's `.plain.html` (of1-build-templates assemble).
//
// A template's image cells are what a generated page shows whenever the worker has no better
// real image to swap in, so an invented or placeholder URL ends up on screen (or as a broken
// `about:error` image when DA/EDS could not import it, which also hides white-on-photo heroes).
// Pure helpers here; `scripts/verify-images.sh` adds the live HTTP check.
//
// CLI: reads plain.html on stdin.
//   (default)  prints "<reason>\t<url>" per bad image, exit 1 when any, else exit 0
//   --urls     prints the unique image URLs one per line (input for the online check)

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PLACEHOLDER_HOSTS = /^(?:[a-z0-9-]+\.)*(?:placehold\.co|placeholder\.com|picsum\.photos|dummyimage\.com|lorempixel\.com|placekitten\.com|placeimg\.com|fakeimg\.pl|loremflickr\.com)$/i;
// example-hero.jpg, /placeholder-card.jpg, dummy.png ...
const PLACEHOLDER_NAME = /(?:^|[/_.-])(?:example|placeholder|dummy|sample)[a-z0-9_-]*\.(?:jpe?g|png|webp|gif|svg|avif)(?:[?#]|$)/i;
// the bare `media_1.png` an agent invents (real DA media files are `media_1<40 hex>.ext`)
const BARE_MEDIA = /(?:^|\/)media_1\.[a-z0-9]+(?:[?#]|$)/i;

const decode = (u) => String(u).replace(/&#x26;|&#38;|&amp;/gi, '&').trim();

/** Every distinct image URL in `src` and `srcset` attributes, document order, entities decoded. */
export function extractImageUrls(html) {
  const out = [];
  const add = (u) => { const d = decode(u); if (!out.includes(d)) out.push(d); };
  for (const m of String(html || '').matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (src) add(src[1] ?? src[2]);
    const set = /\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (set) for (const cand of (set[1] ?? set[2]).split(',')) { const u = cand.trim().split(/\s+/)[0]; if (u) add(u); }
  }
  return out;
}

/** null when the URL looks real, else why it does not: unusable-src | placeholder-host | placeholder-name. */
export function classifyImage(url) {
  const u = decode(url);
  if (!u || /^(?:about|data|javascript|blob):/i.test(u)) return 'unusable-src';
  try {
    const host = new URL(u, 'https://x.invalid').hostname;
    if (PLACEHOLDER_HOSTS.test(host)) return 'placeholder-host';
  } catch { return 'unusable-src'; }
  if (PLACEHOLDER_NAME.test(u) || BARE_MEDIA.test(u)) return 'placeholder-name';
  return null;
}

/** [{url, reason}] for every placeholder / invented / unusable image in the document. */
export function findBadImages(html) {
  return extractImageUrls(html).map((url) => ({ url, reason: classifyImage(url) })).filter((x) => x.reason);
}

/** A live image URL answers 200 with an image/* content type. */
export function isImageResponse(status, contentType) {
  return Number(status) === 200 && /^image\//i.test(String(contentType || '').trim());
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
}

if (isDirectRun()) {
  const html = fs.readFileSync(0, 'utf8');
  if (process.argv.includes('--urls')) {
    process.stdout.write(extractImageUrls(html).map((u) => `${u}\n`).join(''));
  } else {
    const bad = findBadImages(html);
    process.stdout.write(bad.map((b) => `${b.reason}\t${b.url}\n`).join(''));
    process.exitCode = bad.length ? 1 : 0;
  }
}
