// download-images.jsh — Parallel product-image download + upload to DA.
//
// Usage:
//   download-images.jsh \
//     --input image-manifest.json \
//     --owner aem-growth-adoption \
//     --repo of1-demo-orchestrator \
//     --branch wknd-2 \
//     [--output image-mapping.json] \
//     [--max-per-product 5] \
//     [--workers 8] \
//     [--update-products] \
//     [--products-json of1/config/products.json] \
//     [--token-file path/to/token.json]

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const MIN_BYTES = 10000;
const DEFAULT_WORKERS = 8;

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
  return { mime: 'image/png', ext: 'png' };
}

function parseArgs(argv) {
  const args = {
    input: null, owner: null, repo: null, branch: null,
    output: 'image-mapping.json', maxPerProduct: 5, workers: DEFAULT_WORKERS,
    updateProducts: false, productsJson: 'of1/config/products.json',
    tokenFile: null, mountDir: null,
  };
  const raw = argv.slice(1); // argv[0] is script name
  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case '--input': args.input = raw[++i]; break;
      case '--owner': args.owner = raw[++i]; break;
      case '--repo': args.repo = raw[++i]; break;
      case '--branch': args.branch = raw[++i]; break;
      case '--output': args.output = raw[++i]; break;
      case '--max-per-product': args.maxPerProduct = parseInt(raw[++i], 10); break;
      case '--workers': args.workers = parseInt(raw[++i], 10); break;
      case '--update-products': args.updateProducts = true; break;
      case '--products-json': args.productsJson = raw[++i]; break;
      case '--token-file': args.tokenFile = raw[++i]; break;
      case '--mount-dir': args.mountDir = raw[++i]; break;
      default:
        console.error(`Unknown argument: ${raw[i]}`);
        process.exit(1);
    }
  }
  if (!args.input || !args.owner || !args.repo || !args.branch) {
    console.error('Required: --input, --owner, --repo, --branch');
    process.exit(1);
  }
  return args;
}

async function readTokenFile(path) {
  const content = await fs.readFile(path);
  const data = JSON.parse(content);
  const token = data.access_token || data.token;
  if (!token) throw new Error(`Token file ${path} missing access_token / token field`);
  return token;
}

async function resolveToken(tokenFileArg) {
  if (tokenFileArg) return await readTokenFile(tokenFileArg);
  if (process.env.DA_TOKEN) return process.env.DA_TOKEN;
  if (process.env.ADOBE_IMS_TOKEN) return process.env.ADOBE_IMS_TOKEN;
  if (process.env.OF1_TOKEN_FILE) return await readTokenFile(process.env.OF1_TOKEN_FILE);
  try {
    const { stdout: result } = await exec('oauth-token adobe');
    const trimmed = result.trim();
    if (trimmed) return trimmed;
  } catch (e) { /* ignore */ }
  try {
    const content = await fs.readFile('.hlx/.da-token.json');
    const data = JSON.parse(content);
    const token = data.access_token || data.token;
    if (token) return token;
  } catch (e) { /* ignore */ }
  throw new Error(
    'Could not resolve DA token. Pass --token-file, set $DA_TOKEN/$ADOBE_IMS_TOKEN, ' +
    'or place token JSON at .hlx/.da-token.json.'
  );
}

async function downloadImage(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
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
        'Authorization': `Bearer ${token}`,
        'x-content-source-authorization': `Bearer ${token}`,
      },
    });
    if (resp.ok) return null;
    return `preview HTTP ${resp.status}`;
  } catch (e) {
    return `preview error: ${e.message}`;
  }
}

async function uploadImage(data, contentType, token, owner, repo, branch, filename, mountDir) {
  // Try mount first
  if (mountDir) {
    try {
      const mountPath = `${mountDir}/${branch}/media/${filename}`;
      // Write binary via base64 workaround — use fetch to upload instead
      // Mount not easily doable in .jsh without binary fs support, skip to API
    } catch (e) { /* fall through */ }
  }

  // DA multipart upload
  const boundary = '----DABoundary' + Math.random().toString(16).slice(2, 18);
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="data"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const headerBytes = new TextEncoder().encode(header);
  const footerBytes = new TextEncoder().encode(footer);
  const body = new Uint8Array(headerBytes.length + data.length + footerBytes.length);
  body.set(headerBytes, 0);
  body.set(data, headerBytes.length);
  body.set(footerBytes, headerBytes.length + data.length);

  const url = `https://admin.da.live/source/${owner}/${repo}/media/${filename}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
    });
    if (!resp.ok) return { method: null, err: `HTTP ${resp.status}` };
  } catch (e) {
    return { method: null, err: `upload error: ${e.message}` };
  }
  // File is uploaded to DA's source store but not yet in the Media Bus —
  // request a preview so it becomes reachable at the site's /media/ path.
  const previewErr = await triggerPreview(token, owner, repo, branch, filename);
  if (previewErr) return { method: null, err: previewErr };
  return { method: 'api', err: null };
}

async function processOne(task, token, owner, repo, branch, mountDir) {
  const { productId, n, url } = task;
  const { data, err: dlErr } = await downloadImage(url);
  if (dlErr) {
    return { product_id: productId, n, ok: false, stage: 'download', err: dlErr };
  }
  const { mime: contentType, ext } = detectContentType(data);
  const filename = `product-${productId}-${n}.${ext}`;
  const { method, err: upErr } = await uploadImage(data, contentType, token, owner, repo, branch, filename, mountDir);
  if (upErr) {
    return { product_id: productId, n, ok: false, stage: 'upload', err: upErr };
  }
  return { product_id: productId, n, ok: true, method, filename, size: data.length };
}

// Concurrency limiter
function semaphore(max) {
  let active = 0;
  const queue = [];
  return function run(fn) {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        active++;
        try { resolve(await fn()); }
        catch (e) { reject(e); }
        finally {
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
  const args = parseArgs(process.argv);
  const token = await resolveToken(args.tokenFile);

  // Check mount availability
  let mountDir = null;
  try {
    await fs.readFile(args.mountDir + '/.'); // probe
    mountDir = args.mountDir;
  } catch (e) { /* no mount */ }

  const manifestContent = await fs.readFile(args.input);
  const manifest = JSON.parse(manifestContent);

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
    tasks.map(task => run(() => processOne(task, token, args.owner, args.repo, args.branch, mountDir)))
  );

  for (const r of results) {
    if (r.ok) {
      console.log(`  ok ${r.product_id}[${r.n}]: ${Math.floor(r.size / 1024)}KB -> ${r.method}  (${r.filename})`);
    } else {
      console.log(`  FAIL ${r.product_id}[${r.n}]: ${r.stage} ${r.err}`);
    }
  }

  const okN = results.filter(r => r.ok).length;
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
    mapping[pid] = mapping[pid].map(x => x.url);
  }

  await fs.writeFile(args.output, JSON.stringify(mapping, null, 2));
  console.log(`Mapping written to: ${args.output}`);

  if (args.updateProducts) {
    try {
      const pjContent = await fs.readFile(args.productsJson);
      const products = JSON.parse(pjContent);
      let updated = 0;
      for (const p of products) {
        const pid = p.id || '';
        if (mapping[pid]) {
          p.images = mapping[pid];
          updated++;
        }
      }
      await fs.writeFile(args.productsJson, JSON.stringify(products, null, 2));
      console.log(`Updated ${updated} products in ${args.productsJson}`);
    } catch (e) {
      console.error(`WARN: --update-products requested but ${args.productsJson} not found`);
    }
  }

  process.exit(failN === 0 ? 0 : 1);
}

await main();
