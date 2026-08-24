#!/usr/bin/env node
// download-images.mjs — Parallel product-image download + upload to DA.
//
// Reads a manifest of products + image URLs, downloads each image concurrently,
// sniffs its content type from magic bytes (so JPEGs aren't uploaded as PNGs),
// and uploads to DA via the filesystem mount when available or admin.da.live PUT
// otherwise. Default concurrency is 8 workers — enough to saturate I/O without
// being rude to source servers.
//
// Usage:
//   node download-images.mjs \
//     --owner aem-growth-adoption \
//     --repo of1-demo-orchestrator \
//     --branch wknd-2 \
//     [--input image-manifest.json] \
//     [--output image-mapping.json] \
//     [--max-per-product 5] \
//     [--workers 8] \
//     [--update-products] \
//     [--products-json of1/config/products.json] \
//     [--token-file path/to/token.json] \
//     [--mount-dir /mnt/da]
//
// Manifest source: pass --input to read an explicit manifest file, OR omit it
// and the script derives the manifest directly from --products-json (default
// of1/config/products.json) — one entry per product that has an images[] array.
// The separate manifest file is redundant when products.json already carries the
// source URLs, so the common path is to skip --input entirely.
//
// Manifest shape (when --input is used):
//   [{"productId": "house-blend", "urls": ["https://...", "https://..."]}, ...]
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

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const MIN_BYTES = 10000;
const DEFAULT_WORKERS = 8;

// (magic_prefix, mime, extension)
const MAGIC = [
  { prefix: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mime: 'image/png', ext: 'png' },
  { prefix: [0xff, 0xd8, 0xff], mime: 'image/jpeg', ext: 'jpg' },
  { prefix: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], mime: 'image/gif', ext: 'gif' },
  { prefix: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], mime: 'image/gif', ext: 'gif' },
];

function detectContentType(bytes) {
  for (const { prefix, mime, ext } of MAGIC) {
    let match = true;
    for (let i = 0; i < prefix.length; i++) {
      if (bytes[i] !== prefix[i]) { match = false; break; }
    }
    if (match) return { mime, ext };
  }
  // WEBP: RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return { mime: 'image/png', ext: 'png' }; // safe fallback
}

function parseArgs(argv) {
  const args = {
    input: null, owner: null, repo: null, branch: null,
    output: 'image-mapping.json', maxPerProduct: 5, workers: DEFAULT_WORKERS,
    updateProducts: false, productsJson: 'of1/config/products.json',
    tokenFile: null, mountDir: '/mnt/da',
  };
  const raw = argv;
  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case '--input': args.input = raw[++i]; break;
      case '--owner': args.owner = raw[++i]; break;
      case '--repo': args.repo = raw[++i]; break;
      case '--branch': args.branch = raw[++i]; break;
      case '--output': args.output = raw[++i]; break;
      case '--max-per-product': {
        const rawVal = raw[++i];
        args.maxPerProduct = parseInt(rawVal, 10);
        if (Number.isNaN(args.maxPerProduct)) {
          console.error(`Invalid --max-per-product value: ${rawVal}`);
          process.exit(1);
        }
        break;
      }
      case '--workers': {
        const rawVal = raw[++i];
        args.workers = parseInt(rawVal, 10);
        if (Number.isNaN(args.workers)) {
          console.error(`Invalid --workers value: ${rawVal}`);
          process.exit(1);
        }
        break;
      }
      case '--update-products': args.updateProducts = true; break;
      case '--products-json': args.productsJson = raw[++i]; break;
      case '--token-file': args.tokenFile = raw[++i]; break;
      case '--mount-dir': args.mountDir = raw[++i]; break;
      default:
        console.error(`Unknown argument: ${raw[i]}`);
        process.exit(1);
    }
  }
  if (!args.owner || !args.repo || !args.branch) {
    console.error('Required: --owner, --repo, --branch (manifest comes from --input or --products-json)');
    process.exit(1);
  }
  return args;
}

function readTokenFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(content);
  const token = data.access_token || data.token;
  if (!token) throw new Error(`Token file ${filePath} missing access_token / token field`);
  return token;
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

async function downloadImage(url) {
  let resp;
  try {
    resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  } catch (e) {
    return { data: null, err: `download error: ${e.message}` };
  }
  if (!resp.ok) return { data: null, err: `HTTP ${resp.status}` };
  const buffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length < MIN_BYTES) return { data: null, err: `too small (${bytes.length} bytes)` };
  return { data: bytes, err: null };
}

async function triggerPreview(token, owner, repo, branch, filename) {
  // Ingest the uploaded media file into EDS's Media Bus so it resolves at
  // {branch}--{repo}--{owner}.aem.page/media/{filename}. Without this, the
  // file only exists in DA's source store — content.da.live is not a public
  // delivery endpoint (auth-gated) and the aem.page path 404s until previewed.
  const url = `https://admin.hlx.page/preview/${owner}/${repo}/${branch}/media/${filename}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-content-source-authorization': `Bearer ${token}`,
      },
    });
    if (resp.ok) return null;
    return `preview HTTP ${resp.status}`;
  } catch (e) {
    return `preview error: ${e.message}`;
  }
}

async function upload(data, contentType, token, owner, repo, branch, filename, mountDir) {
  if (mountDir) {
    const mountPath = path.join(mountDir, branch, 'media', filename);
    // Narrow the try to the filesystem write only. If the write succeeds but
    // triggerPreview later fails, we must NOT fall through and re-upload a file
    // that is already on the mount (finding 51).
    let wrote = false;
    try {
      fs.mkdirSync(path.dirname(mountPath), { recursive: true });
      fs.writeFileSync(mountPath, Buffer.from(data));
      wrote = true;
    } catch (e) {
      // mount unavailable — fall through to the API path
    }
    if (wrote) {
      const err = await triggerPreview(token, owner, repo, branch, filename);
      return ['mount', err || null];
    }
  }

  // DA requires multipart/form-data with field name "data" for binary uploads.
  // Raw PUT silently returns 2xx but doesn't persist the file.
  const boundary = '----DABoundary' + crypto.randomBytes(8).toString('hex');
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="data"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const headerBytes = new TextEncoder().encode(header);
  const footerBytes = new TextEncoder().encode(footer);
  const body = new Uint8Array(headerBytes.length + data.length + footerBytes.length);
  body.set(headerBytes, 0);
  body.set(data, headerBytes.length);
  body.set(footerBytes, headerBytes.length + data.length);

  const url = `https://admin.da.live/source/${owner}/${repo}/media/${filename}`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
  } catch (e) {
    return ['api', `upload error: ${e.message}`];
  }
  if (!resp.ok) return ['api', `HTTP ${resp.status}`];
  // File is uploaded to DA's source store but not yet in the Media Bus —
  // request a preview so it becomes reachable at the site's /media/ path.
  const previewErr = await triggerPreview(token, owner, repo, branch, filename);
  if (previewErr) return ['api', previewErr];
  return ['api', null];
}

async function processOne(task, token, owner, repo, branch, mountDir) {
  const { productId, n, url } = task;
  const { data, err: dlErr } = await downloadImage(url);
  if (dlErr) {
    return { product_id: productId, n, ok: false, stage: 'download', err: dlErr };
  }
  const { mime: contentType, ext } = detectContentType(data);
  const filename = `product-${productId}-${n}.${ext}`;
  const [method, upErr] = await upload(data, contentType, token, owner, repo, branch, filename, mountDir);
  if (upErr) {
    return { product_id: productId, n, ok: false, stage: 'upload', err: upErr };
  }
  return { product_id: productId, n, ok: true, method, filename, size: data.length };
}

// Concurrency limiter — bounded pool, no third-party deps.
function semaphore(max) {
  let active = 0;
  const queue = [];
  return function run(fn) {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        active++;
        try { resolve(await fn()); } catch (e) { reject(e); } finally {
          active--;
          if (queue.length > 0) queue.shift()();
        }
      };
      if (active < max) execute();
      else queue.push(execute);
    });
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = await resolveToken(args.tokenFile);

  const mountDir = fs.existsSync(args.mountDir) ? args.mountDir : null;

  let manifest;
  if (args.input) {
    manifest = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  } else {
    // No explicit manifest — derive it from products.json (the common path).
    if (!fs.existsSync(args.productsJson)) {
      console.error(
        `No --input manifest given and ${args.productsJson} not found — nothing to download.`,
      );
      process.exit(1);
    }
    const products = JSON.parse(fs.readFileSync(args.productsJson, 'utf8'));
    manifest = products
      .filter((p) => Array.isArray(p.images) && p.images.length)
      .map((p) => ({ productId: p.id, urls: p.images }));
    console.log(`Derived manifest from ${args.productsJson}: ${manifest.length} product(s) with images`);
  }

  const tasks = [];
  for (const item of manifest) {
    const pid = item.productId;
    const urls = (item.urls || []).slice(0, args.maxPerProduct);
    for (let n = 0; n < urls.length; n++) {
      tasks.push({ productId: pid, n: n + 1, url: urls[n] });
    }
  }

  console.log(`Processing ${tasks.length} images across ${manifest.length} products (workers=${args.workers}, mount=${mountDir ? 'yes' : 'no'})`);

  const run = semaphore(args.workers);
  const results = await Promise.all(
    tasks.map((task) => run(() => processOne(task, token, args.owner, args.repo, args.branch, mountDir))),
  );

  for (const r of results) {
    if (r.ok) {
      console.log(`  ok ${r.product_id}[${r.n}]: ${Math.floor(r.size / 1024)}KB -> ${r.method}  (${r.filename})`);
    } else {
      console.log(`  FAIL ${r.product_id}[${r.n}]: ${r.stage} ${r.err}`);
    }
  }

  const okN = results.filter((r) => r.ok).length;
  const failN = results.length - okN;
  console.log(`\nSummary: ${okN} uploaded, ${failN} failed.`);

  // Build mapping
  const mapping = {};
  for (const r of results) {
    if (r.ok) {
      const url = `https://${args.branch}--${args.repo}--${args.owner}.aem.page/media/${r.filename}`;
      if (!mapping[r.product_id]) mapping[r.product_id] = [];
      mapping[r.product_id].push({ n: r.n, url });
    }
  }
  for (const pid of Object.keys(mapping)) {
    mapping[pid].sort((a, b) => a.n - b.n);
    mapping[pid] = mapping[pid].map((x) => x.url);
  }

  fs.writeFileSync(args.output, JSON.stringify(mapping, null, 2));
  console.log(`Mapping written to: ${args.output}`);

  if (args.updateProducts) {
    if (fs.existsSync(args.productsJson)) {
      const products = JSON.parse(fs.readFileSync(args.productsJson, 'utf8'));
      let updated = 0;
      for (const p of products) {
        const pid = p.id || '';
        if (mapping[pid]) {
          p.images = mapping[pid];
          updated++;
        }
      }
      fs.writeFileSync(args.productsJson, JSON.stringify(products, null, 2));
      console.log(`Updated ${updated} products in ${args.productsJson}`);
    } else {
      console.error(`WARN: --update-products requested but ${args.productsJson} not found`);
    }
  }

  process.exit(failN === 0 ? 0 : 1);
}

await main();
