import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { crawlOrigin, discoverPaths, classifyPath, proposePages, checkLive } from './pages.mjs';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const mk = (map) => async (url, opts) => {
  const body = map[url];
  return { ok: body !== undefined && body !== 404, status: body === undefined || body === 404 ? 404 : 200, text: async () => body, _m: opts?.method };
};

test('crawlOrigin', () => {
  assert.equal(crawlOrigin({ domain: 'www.x.com', org: 'o', repo: 'r' }), 'https://www.x.com');
  assert.equal(crawlOrigin({ domain: 'none', org: 'o', repo: 'r' }), 'https://main--r--o.aem.live');
  assert.equal(crawlOrigin({ org: 'o', repo: 'r' }), 'https://main--r--o.aem.live');
});

test('sitemap index follows children', async () => {
  const r = await discoverPaths('https://x.test', { fetchImpl: mk({
    'https://x.test/sitemap.xml': fx('sitemap-index.xml'),
    'https://x.test/sitemap-a.xml': fx('sitemap-a.xml'),
    'https://x.test/sitemap-b.xml': fx('sitemap-b.xml'),
  }) });
  assert.equal(r.source, 'sitemap');
  assert.deepEqual(r.paths, ['/', '/a/one', '/b/two']);
});

test('falls back to query-index, then none', async () => {
  const r = await discoverPaths('https://x.test', { fetchImpl: mk({ 'https://x.test/query-index.json': fx('query-index.json') }) });
  assert.equal(r.source, 'query-index');
  assert.deepEqual(r.paths, ['/', '/q/one', '/q/two']);
  assert.deepEqual(await discoverPaths('https://x.test', { fetchImpl: mk({}) }), { paths: [], source: 'none', reason: 'no-sitemap' });
});

test('classifyPath', () => {
  for (const p of ['/en/privacy-policy', '/cart', '/fragments/x', '/nav', '/footer', '/templates/a', '/drafts/a', '/of1/x']) assert.equal(classifyPath(p), 'skip', p);
  assert.equal(classifyPath('/'), 'home');
  assert.equal(classifyPath('/products'), 'nav');
  assert.equal(classifyPath('/products/a'), 'detail');
  assert.equal(classifyPath('/about'), 'about');
  assert.equal(classifyPath('/help/faq'), 'faq');
});

test('proposePages balances sections', () => {
  const paths = ['/', '/cart'];
  for (const s of ['a', 'b', 'c', 'd', 'e']) {
    paths.push(`/${s}`);
    for (let i = 0; i < 59; i += 1) paths.push(`/${s}/p${i}`);
  }
  assert.equal(paths.length, 302);
  const out = proposePages({ paths, navPaths: ['/a', '/b'] });
  assert.ok(out.length >= 20 && out.length <= 40, String(out.length));
  assert.equal(out[0].path, '/');
  for (const s of ['a', 'b', 'c', 'd', 'e']) assert.ok(out.some((p) => p.path.startsWith(`/${s}/`)), s);
  assert.ok(!out.some((p) => p.path === '/cart'));
  assert.equal(new Set(out.map((p) => p.path)).size, out.length);
});

test('input replaces the pool, normalised, deduped, capped', () => {
  const input = [{ path: 'https://x/a.html' }, '/a', '/b/', ...Array.from({ length: 150 }, (_, i) => `/p${i}`)];
  const out = proposePages({ paths: ['/zzz'], input });
  assert.equal(out.length, 100);
  assert.deepEqual(out.slice(0, 2).map((p) => p.path), ['/a', '/b']);
  assert.ok(!out.some((p) => p.path === '/zzz'));
});

test('checkLive reports not-live', async () => {
  const f = async (url, o) => ({ status: url.endsWith('/gone') ? 404 : 200, method: o.method });
  const r = await checkLive('https://x.test', ['/', '/gone', '/ok'], { fetchImpl: f });
  assert.deepEqual(r.live, ['/', '/ok']);
  assert.deepEqual(r.skipped, [{ path: '/gone', reason: 'not-live' }]);
});

test('skip rule is segment-anchored', () => {
  for (const p of ['/research', '/navigation', '/navy', '/of10', '/products/terminal']) assert.notEqual(classifyPath(p), 'skip', p);
  for (const p of ['/search', '/en/search/results', '/of1/x', '/nav']) assert.equal(classifyPath(p), 'skip', p);
});

const sectioned = (n, per) => {
  const paths = ['/'];
  for (let s = 0; s < n; s += 1) {
    paths.push(`/s${s}`);
    for (let i = 0; i < per; i += 1) paths.push(`/s${s}/p${i}`);
  }
  return paths;
};

test('3 sections reach the 20-page floor', () => {
  const out = proposePages({ paths: sectioned(3, 30), navPaths: ['/s0', '/s1', '/s2'] });
  assert.ok(out.length >= 20 && out.length <= 40, String(out.length));
  for (let s = 0; s < 3; s += 1) assert.ok(out.some((p) => p.path.startsWith(`/s${s}`)));
});

test('30 sections are all represented within 40', () => {
  const out = proposePages({ paths: sectioned(30, 5), navPaths: ['/s0', '/s1'] });
  assert.ok(out.length <= 40, String(out.length));
  for (let s = 0; s < 30; s += 1) assert.ok(out.some((p) => p.path === `/s${s}` || p.path.startsWith(`/s${s}/`)), `s${s}`);
});
