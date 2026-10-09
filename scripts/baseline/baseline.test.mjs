import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shapeOfConfig, shapeOfSheet, shapeOfTemplate, shapeOfOf1Page, shapeOfBrandVoice,
  shapeOfStatus, shapeOfGenerate, diffShapes, captureShape, DEFAULT_WORKER, parseArgs, OWNED_PATHSPECS, filterOwnedPaths,
} from './baseline.mjs';

test('shapeOfConfig', () => {
  assert.equal(shapeOfConfig(null), null);
  assert.deepEqual(
    shapeOfConfig({ b: 1, a: 2, templates: { names: ['x', 'y'] }, contentIngestion: { indexPath: '/q.json' } }),
    { keys: ['a', 'b', 'contentIngestion', 'templates'], templateNames: 2, hasIndexPath: true },
  );
  assert.deepEqual(shapeOfConfig({}), { keys: [], templateNames: 0, hasIndexPath: false });
});

test('shapeOfSheet', () => {
  assert.equal(shapeOfSheet(null), null);
  assert.deepEqual(shapeOfSheet({ data: [{ b: 1, a: 2 }, { c: 1 }] }), { columns: ['a', 'b'], rows: 2 });
  assert.deepEqual(shapeOfSheet({ data: [] }), { columns: [], rows: 0 });
});

test('shapeOfTemplate with metadata', () => {
  const html = `<div data-template-intent="budget" data-template-max-items="4"><div class="hero"><div><div>x</div></div></div><div class="cards"></div><div class="section-metadata"><div><div>k</div></div></div></div>`;
  assert.deepEqual(shapeOfTemplate(html), { blocks: ['hero', 'cards'], intent: 'budget', minItems: null, maxItems: 4 });
});

test('shapeOfTemplate without metadata', () => {
  const r = shapeOfTemplate('<div><div class="hero"></div></div>');
  assert.equal(r.intent, null);
  assert.equal(shapeOfTemplate(null), null);
});

test('shapeOfOf1Page', () => {
  assert.equal(shapeOfOf1Page(null), null);
  const html = '<div><div class="of1"><div><div>Title</div><div>x</div></div><div><div>Theme</div><div>y</div></div></div></div>';
  assert.deepEqual(shapeOfOf1Page(html), { rows: ['Title', 'Theme'] });
});

test('shapeOfBrandVoice', () => {
  assert.equal(shapeOfBrandVoice(null), null);
  assert.deepEqual(
    shapeOfBrandVoice('<h2>Tone</h2><ul><li>a</li><li>b</li></ul><h3>Avoid</h3><ul><li>c</li></ul>'),
    { headings: ['Tone', 'Avoid'], listItems: 3 },
  );
});

test('shapeOfStatus', () => {
  assert.equal(shapeOfStatus(null), null);
  assert.deepEqual(
    shapeOfStatus({ ready: true, config: { hasTemplates: true, contentChunks: 127, hasCtaTemplate: false } }),
    { ready: true, flags: { hasTemplates: true, contentChunks: true, hasCtaTemplate: false } },
  );
});

test('shapeOfGenerate', () => {
  const nd = ['{"type":"section"}', 'garbage', '{"type":"section"}', '{"type":"suggestions"}', '{"type":"done"}'].join('\n');
  assert.deepEqual(shapeOfGenerate(nd), { eventTypes: ['done', 'section', 'suggestions'], sections: 2, errors: 0 });
  assert.equal(shapeOfGenerate('{"type":"error"}\n').errors, 1);
});

test('diffShapes', () => {
  assert.deepEqual(diffShapes({ a: { b: 1 } }, { a: { b: 2 } }), ['a.b: 1 -> 2']);
  assert.deepEqual(diffShapes({ a: 1 }, { a: 1 }), []);
});

test('captureShape tolerates 404s', async () => {
  const res = (body, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const fetchImpl = async (url, opts) => {
    const u = String(url);
    if (u.endsWith('/of1/brand-voice.plain.html')) return res('', false);
    if (u.endsWith('/of1/config/config.json')) return res({ templates: { names: ['home'] } });
    if (u.endsWith('/templates/home.plain.html')) return res('<div><div class="hero"></div></div>');
    if (u.endsWith('/query-index.json')) return res({ data: [{ path: '/of1/knowledge/a' }, { path: '/x' }] });
    if (u.endsWith('/status')) return res({ ready: true });
    if (u.endsWith('/api/generate')) return res('{"type":"section"}\n{"type":"done"}\n');
    return res('', false);
  };
  const out = await captureShape({ base: 'https://t.aem.page', worker: 'https://w', tenantId: 't', gitFiles: ['b', 'a'], fetchImpl });
  assert.equal(out.brandVoice, null);
  assert.equal(out.personas, null);
  assert.deepEqual(out.gitFiles, ['a', 'b']);
  assert.equal(out.knowledgePages, 1);
  assert.deepEqual(out.templates.home.blocks, ['hero']);
  assert.equal(out.generate.sections, 1);
  assert.equal(out.status.ready, true);
});

test('shapeOfTemplate uses first class token of variant blocks', () => {
  assert.deepEqual(shapeOfTemplate('<div><div class="cards dark"></div></div>').blocks, ['cards']);
});

test('shapeOfTemplate ignores classed divs nested inside cells', () => {
  const html = '<div><div class="hero"><div><div class="inner"></div></div></div></div>';
  assert.deepEqual(shapeOfTemplate(html).blocks, ['hero']);
});

test('shapeOfTemplate lists blocks of several sections in order', () => {
  const html = '<div><div class="hero"></div></div><div><div class="cards"></div></div>';
  assert.deepEqual(shapeOfTemplate(html).blocks, ['hero', 'cards']);
});

test('default worker is used by capture and opt-out is honoured', async () => {
  assert.equal(DEFAULT_WORKER, 'https://of1-gen-web-service.franklin-prod.workers.dev');
  const urls = [];
  const fetchImpl = async (u) => { urls.push(String(u)); return { ok: false, status: 404 }; };
  await captureShape({ base: 'https://t.aem.page', worker: DEFAULT_WORKER, tenantId: 't', gitFiles: [], fetchImpl });
  assert.ok(urls.some((u) => u.startsWith(`${DEFAULT_WORKER}/api/tenants/t/status`)));
  urls.length = 0;
  await captureShape({ base: 'https://t.aem.page', worker: '', tenantId: 't', gitFiles: [], fetchImpl });
  assert.ok(!urls.some((u) => u.includes('/api/')));
});

test('parseArgs rejects flags without a value', () => {
  assert.throws(() => parseArgs(['--tenant']), /--tenant/);
  assert.throws(() => parseArgs(['--tenant', '--out', 'x']), /--tenant/);
  assert.deepEqual(parseArgs(['capture', '--tenant', 't']), { _: ['capture'], tenant: 't' });
});

test('filterOwnedPaths keeps only OF1-owned paths', () => {
  const files = ['blocks/of1/of1.js', 'of1/config/config.json', 'deliverables/index.html', 'helix-query.yaml', '.hlxignore',
    'scripts/aem.js', 'styles/styles.css', 'stardust/current/DESIGN.json', 'blocks/of1x/a.js', 'of1.txt'];
  assert.deepEqual(filterOwnedPaths(files),
    ['blocks/of1/of1.js', 'of1/config/config.json', 'deliverables/index.html', 'helix-query.yaml', '.hlxignore']);
  assert.deepEqual(OWNED_PATHSPECS, ['blocks/of1', 'of1', 'deliverables', 'helix-query.yaml', '.hlxignore']);
});
