import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readIsland, checkPage, checkSearch, pagesReady, waitFor } from './check.mjs';

const html = readFileSync(new URL('./fixtures/island-page.html', import.meta.url), 'utf8');
const resp = (body, status = 200) => ({ status, ok: status < 300, text: async () => body });

test('checkPage asks for HTML like a browser navigation (the proxy passes anything else through)', async () => {
  let init;
  await checkPage('https://prev--main--r--o--dev.of1.live/x', { fetchImpl: async (u, i) => { init = i; return resp(html); } });
  assert.match(new Headers(init?.headers).get('accept') || '', /text\/html/);
});

test('checkPage ok and requests of1-region=us', async () => {
  const urls = [];
  const r = await checkPage('https://main--r--o--dev.of1.live/x', { fetchImpl: async (u) => { urls.push(u); return resp(html); } });
  assert.equal(r.ok, true); assert.equal(r.generative, 2);
  assert.deepEqual(r.decisions, [{ id: 'hero', choice: 'c1', fallback: false }]);
  assert.match(urls[0], /of1-region=us/);
});

test('checkPage: no island, raw marker, invalid decision', async () => {
  const f = (b) => async () => resp(b);
  assert.deepEqual((await checkPage('https://prev--main--r--o.of1.live/', { fetchImpl: f('<p>hi</p>') })).problems, ['no-island']);
  assert.ok((await checkPage('https://x/', { fetchImpl: f(`${html}{{generate: a}}`) })).problems.includes('raw-marker'));
  const bad = html.replace('"invalid":[]', '"invalid":[{"id":"z"}]');
  assert.ok((await checkPage('https://x/', { fetchImpl: f(bad) })).problems.includes('decision-invalid'));
  const none = html.replace('"applied":2', '"applied":0').replace(/"points":\[.*\],"invalid"/, '"points":[],"invalid"');
  assert.deepEqual((await checkPage('https://x/', { fetchImpl: f(none) })).problems, ['no-generated-slot', 'no-decision']);
});

test('readIsland returns null for broken JSON', () => {
  assert.equal(readIsland('<script type="application/json" id="of1-context">{x</script>'), null);
});

test('checkSearch reports each failing probe', async () => {
  const good = async (u, init) => resp(u.endsWith('/of1') ? '<div class="of1-search">' : init?.method === 'POST' ? 'answer' : 'js');
  const ok = await checkSearch('https://p.of1.live/', 'q', { fetchImpl: good });
  assert.equal(ok.ok, true);
  const bad = await checkSearch('https://p.of1.live', 'q', {
    fetchImpl: async (u) => (u.endsWith('/of1') ? resp('nope') : u.includes('sdk') ? resp('', 404) : resp('')),
  });
  assert.deepEqual(bad.problems, ['page-failed', 'sdk-failed', 'generate-failed']);
});

test('pagesReady', () => {
  const s = JSON.parse(readFileSync(new URL('./fixtures/pages-status.json', import.meta.url), 'utf8'));
  assert.deepEqual(pagesReady(s), { ready: 2, allReady: false, total: 4, pending: ['/c'], failed: ['/d'] });
});

test('pagesReady allReady when nothing is pending', () => {
  assert.deepEqual(pagesReady({ pages: { '/a': { state: 'live' } } }), { ready: 1, allReady: true, total: 1, pending: [], failed: [] });
});

test('waitFor gives up after the timeout (fake clock)', async () => {
  let t = 0; let calls = 0;
  const r = await waitFor(async () => { calls++; return false; }, { timeoutMs: 300, everyMs: 100, now: () => t, sleep: async (ms) => { t += ms; } });
  assert.equal(r, null); assert.ok(calls >= 3 && calls <= 4);
  let n = 0;
  assert.equal(await waitFor(async () => ++n === 2 && 'done', { everyMs: 1, now: () => 0, sleep: async () => {} }), 'done');
});

test('checkPage fails open: fetch rejection, HTTP status, non-preview host', async () => {
  const rej = await checkPage('https://x/', { fetchImpl: async () => { throw new Error('down'); } });
  assert.deepEqual(rej, { ok: false, generative: 0, decisions: [], problems: ['fetch-failed'] });
  assert.deepEqual((await checkPage('https://x/', { fetchImpl: async () => resp('', 404) })).problems, ['http-404']);
  assert.deepEqual((await checkPage('https://x/', { fetchImpl: async () => resp('<p>') })).problems, ['no-island', 'not-preview-host']);
});

test('pagesReady tolerates null entries and empty lists', () => {
  assert.deepEqual(pagesReady({ pages: { '/a': null, '/b': { state: 'ready' } } }), { ready: 1, allReady: false, total: 2, pending: ['/a'], failed: [] });
  for (const s of [{}, null, { pages: {} }]) assert.deepEqual(pagesReady(s), { ready: 0, allReady: false, reason: 'no-pages', total: 0, pending: [], failed: [] });
});

test('pagesReady index-off', () => {
  assert.deepEqual(pagesReady({ sync: { status: 'off' }, pages: { '/a': { state: 'off' } } }), { ready: 0, allReady: false, reason: 'index-off', total: 1, pending: [], failed: ['/a'] });
});

test('pagesReady splits ready, failed and pending', () => {
  const r = pagesReady({ sync: { status: 'ok' }, pages: { '/a': { state: 'ready' }, '/b': { state: 'unusable' }, '/c': { state: 'fetching' } } });
  assert.deepEqual(r, { ready: 1, allReady: false, total: 3, pending: ['/c'], failed: ['/b'] });
});

test('pagesReady has no pending with only ready and failed', () => {
  const r = pagesReady({ pages: { '/a': { state: 'live' }, '/b': { state: 'missing' } } });
  assert.deepEqual(r.pending, []);
  assert.deepEqual(r.failed, ['/b']);
  assert.equal(r.allReady, false);
});
