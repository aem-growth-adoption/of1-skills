import fs from 'node:fs';

const SKIP = [/(legal|privacy|cookie|terms|cart|checkout|account|login|signin|search|404)\b/i, /\/fragments\//, /\/nav/, /\/footer/, /\/templates\//, /\/drafts\//, /\/of1/];
const CAP = 100;
const TARGET_MAX = 40;
const PER_SECTION = 4;

export function crawlOrigin({ domain, org, repo }) {
  if (domain && domain !== 'none') return /^https?:\/\//.test(domain) ? domain.replace(/\/$/, '') : `https://${domain}`;
  return `https://main--${repo}--${org}.aem.live`;
}

export function normalisePath(p) {
  let s = String(p).trim();
  if (/^https?:\/\//i.test(s)) { try { s = new URL(s).pathname; } catch { return null; } }
  s = s.split(/[?#]/)[0].replace(/\.html$/, '');
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s || '/';
}

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);

async function getText(fetchImpl, url) {
  try {
    const r = await fetchImpl(url);
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

export async function discoverPaths(origin, { fetchImpl = globalThis.fetch } = {}) {
  const sm = await getText(fetchImpl, `${origin}/sitemap.xml`);
  if (sm !== null) {
    let urls = [];
    if (/<sitemapindex/i.test(sm)) {
      for (const child of locs(sm)) {
        const x = await getText(fetchImpl, child);
        if (x) urls.push(...locs(x));
      }
    } else urls = locs(sm);
    const paths = [...new Set(urls.map(normalisePath).filter(Boolean))];
    if (paths.length) return { paths, source: 'sitemap' };
  }
  const qi = await getText(fetchImpl, `${origin}/query-index.json`);
  if (qi !== null) {
    try {
      const paths = [...new Set((JSON.parse(qi).data ?? []).map((d) => d.path).filter(Boolean).map(normalisePath))];
      if (paths.length) return { paths, source: 'query-index' };
    } catch { /* ignore */ }
  }
  return { paths: [], source: 'none', reason: 'no-sitemap' };
}

export function classifyPath(path) {
  if (SKIP.some((re) => re.test(path))) return 'skip';
  if (path === '/') return 'home';
  if (/(^|\/)(about|company|who-we-are|our-story)(\/|$)/i.test(path)) return 'about';
  if (/(^|\/)(faq|faqs|help|support)(\/|$)/i.test(path)) return 'faq';
  if (path.split('/').filter(Boolean).length === 1) return 'nav';
  return 'detail';
}

const section = (p) => p.split('/').filter(Boolean)[0] ?? '';

export function proposePages({ paths = [], navPaths = [], input = null }) {
  const norm = (list) => [...new Set(list.map((e) => normalisePath(typeof e === 'string' ? e : e.path)).filter(Boolean))];
  if (input) {
    const types = new Map(input.filter((e) => typeof e !== 'string' && e.type).map((e) => [normalisePath(e.path), e.type]));
    return norm(input).slice(0, CAP).map((path) => ({ path, type: types.get(path) ?? classifyPath(path) }));
  }
  const pool = norm(paths).filter((p) => classifyPath(p) !== 'skip');
  const out = [];
  const seen = new Set();
  const add = (path, type) => {
    if (!seen.has(path) && out.length < TARGET_MAX) { seen.add(path); out.push({ path, type }); }
  };
  if (pool.includes('/') || !out.length) add('/', 'home');
  const poolSet = new Set(pool);
  for (const p of norm(navPaths)) if (poolSet.has(p) && classifyPath(p) !== 'skip') add(p, 'nav');
  for (const p of pool) if (classifyPath(p) === 'nav') add(p, 'nav');
  const bySection = new Map();
  for (const p of pool) {
    if (classifyPath(p) !== 'detail') continue;
    const s = section(p);
    if (!bySection.has(s)) bySection.set(s, []);
    bySection.get(s).push(p);
  }
  for (let i = 0; i < PER_SECTION; i += 1) {
    for (const list of bySection.values()) if (list[i]) add(list[i], 'detail');
  }
  for (const p of pool) {
    const t = classifyPath(p);
    if (t === 'about' || t === 'faq') add(p, t);
  }
  return out;
}

export async function checkLive(origin, paths, { fetchImpl = globalThis.fetch, concurrency = 6 } = {}) {
  const live = [];
  const skipped = [];
  const queue = [...paths];
  const worker = async () => {
    while (queue.length) {
      const path = queue.shift();
      let ok = false;
      try { ok = (await fetchImpl(`${origin}${path}`, { method: 'HEAD' })).status === 200; } catch { /* not live */ }
      if (ok) live.push(path); else skipped.push({ path, reason: 'not-live' });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  const order = new Map(paths.map((p, i) => [p, i]));
  live.sort((a, b) => order.get(a) - order.get(b));
  skipped.sort((a, b) => order.get(a.path) - order.get(b.path));
  return { live, skipped };
}

export async function navPathsFrom(origin, { fetchImpl = globalThis.fetch } = {}) {
  const html = await getText(fetchImpl, `${origin}/nav.plain.html`);
  if (!html) return [];
  return [...new Set([...html.matchAll(/href="([^"#]+)"/g)].map((m) => m[1]).filter((h) => h.startsWith('/') || h.startsWith(origin)).map(normalisePath))];
}

export function readPagesArg(v) {
  if (!v) return null;
  return JSON.parse(v.startsWith('@') ? fs.readFileSync(v.slice(1), 'utf8') : v);
}
