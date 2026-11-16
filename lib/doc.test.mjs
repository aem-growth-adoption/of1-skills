import { test } from 'node:test';
import assert from 'node:assert/strict';
import { of1PageHtml, heroGenerative, decisionBlockHtml, copyPath, ensureDoc, marker, sections, replaceSection, sectionMetadataHtml } from './doc.mjs';

test('of1PageHtml has an empty of1 block and no endpoint/domain', () => {
  const h = of1PageHtml();
  assert.match(h, /class="of1"/);
  assert.doesNotMatch(h, /api-endpoint|domain/);
});

test('heroGenerative merges into existing Section Metadata', () => {
  const html = `<body><main><div><h1>Hi</h1>${sectionMetadataHtml({ style: 'dark' })}</div><div><p>x</p></div></main></body>`;
  const out = heroGenerative(html, 'Rewrite for visitor');
  assert.match(out, /style/);
  assert.match(out, /generative-scope/);
  assert.match(out, /generative-instruction/);
  assert.equal(out.match(/section-metadata/g).length, 1);
  assert.equal(sections(out).length, 2);
});

test('heroGenerative without h1 is unchanged; adds metadata when missing', () => {
  const noH1 = '<body><main><div><p>x</p></div></main></body>';
  assert.equal(heroGenerative(noH1, 'a'), noH1);
  assert.match(heroGenerative('<body><main><div><h1>T</h1></div></main></body>', 'a'), /generative-scope/);
});

test('replaceSection and marker', () => {
  const html = '<body><main><div>a</div><div>b</div></main></body>';
  assert.equal(replaceSection(html, 1, '<div>c</div>'), '<body><main><div>a</div><div>c</div></main></body>');
  assert.equal(marker('x', 'y'), '{{generate: x}}{{default: y}}');
  assert.throws(() => marker('a}}b', 'y'));
});

test('decisionBlockHtml keeps candidate order and validates', () => {
  const h = decisionBlockHtml({ id: 'home-hero', hint: 'h', candidates: ['/fragments/of1/home-hero/default', '/fragments/of1/home-hero/budget'] });
  assert.ok(h.indexOf('/default') < h.indexOf('/budget'));
  assert.doesNotMatch(h, /when/);
  assert.throws(() => decisionBlockHtml({ id: 'Home Hero', hint: 'h', candidates: ['/a', '/b'] }));
  assert.throws(() => decisionBlockHtml({ id: 'a', hint: 'h', candidates: ['/a'] }));
  assert.throws(() => decisionBlockHtml({ id: 'a', hint: 'h', candidates: Array(11).fill('/a') }));
  assert.throws(() => decisionBlockHtml({ id: 'a', hint: 'x'.repeat(501), candidates: ['/a', '/b'] }));
});

test('copyPath', () => {
  assert.equal(copyPath('/'), '/of1-demo/home');
  assert.equal(copyPath('/a/b'), '/of1-demo/a/b');
});

test('ensureDoc: exists makes no write; absent creates', async () => {
  const calls = [];
  const mk = (status) => async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url}`);
    if (!init.method || init.method === 'GET') return { status, ok: status === 200, text: async () => 'x' };
    return { status: 200, ok: true, text: async () => '' };
  };
  assert.equal(await ensureDoc({ org: 'o', repo: 'r', path: 'of1', html: '<p/>', token: 't', fetchImpl: mk(200) }), 'exists');
  assert.ok(calls.every((c) => c.startsWith('GET')));
  calls.length = 0;
  assert.equal(await ensureDoc({ org: 'o', repo: 'r', path: 'of1', html: '<p/>', token: 't', fetchImpl: mk(404) }), 'created');
  assert.ok(calls.some((c) => c.startsWith('POST')));
});

test('ensureDoc throws on 401/500 without writing; marker rejects }', async () => {
  for (const status of [401, 500]) {
    const calls = [];
    const f = async (url, init = {}) => { calls.push(init.method || 'GET'); return { status, ok: false, text: async () => '' }; };
    await assert.rejects(ensureDoc({ org: 'o', repo: 'r', path: 'of1', html: '<p/>', token: 't', overwrite: true, fetchImpl: f }), new RegExp(String(status)));
    assert.deepEqual(calls, ['GET']);
  }
  assert.throws(() => marker('a}b', 'c'));
});
