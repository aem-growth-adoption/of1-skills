import { run } from './cli.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { of1PageHtml, heroGenerative, decisionBlockHtml, copyPath, ensureDoc, marker, sections, replaceSection, sectionMetadataHtml, findHero, ctaSectionHtml, hasOf1Cta, pickDecisionSection, hasDecision, prepareDoc } from './doc.mjs';

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

const PAGE = '<body><main><div><p>top</p></div><div><h1>Hi</h1></div><div><div class="teaser"><div><div>x</div></div></div></div><div><p>end</p></div></main></body>';

test('findHero returns the section index of the first h1, -1 if none', () => {
  assert.equal(findHero(PAGE), 1);
  assert.equal(findHero('<body><main><div><p>x</p></div></main></body>'), -1);
});

test('ctaSectionHtml has three markers; hasOf1Cta detects it after the hero', () => {
  const cta = ctaSectionHtml({ block: 'of1-cta', heading: ['h', 'dh'], text: ['t', 'dt'], button: { label: ['l', 'dl'], href: '/of1' } });
  assert.equal(cta.match(/\{\{generate:/g).length, 3);
  assert.equal(hasOf1Cta(PAGE), false);
  const out = replaceSection(PAGE, 3, cta);
  assert.equal(hasOf1Cta(out), true);
  assert.equal(hasOf1Cta(replaceSection(PAGE, 0, cta)), false);
});

test('pickDecisionSection skips the hero and picks the teaser', () => {
  assert.deepEqual(pickDecisionSection(PAGE, 1), { index: 2, reason: 'teaser block' });
  const none = pickDecisionSection('<body><main><div><h1>a</h1></div><div><p>x</p></div></main></body>', 0);
  assert.deepEqual(none, { index: -1, reason: 'no promo or teaser section' });
});

test('hasDecision detects an existing decision block', () => {
  assert.equal(hasDecision(PAGE), false);
  assert.equal(hasDecision(replaceSection(PAGE, 2, `<div>${decisionBlockHtml({ id: 'a', hint: 'h', candidates: ['/x', '/y'] })}</div>`)), true);
});

test('prepareDoc copies the source once, then reports exists', async () => {
  const calls = [];
  const fetchImpl = async (url, o = {}) => {
    calls.push([o.method || 'GET', url]);
    if (url.endsWith('/source/o/r/index.html')) return new Response(PAGE, { status: 200 });
    return new Response('', { status: calls.some((c) => c[0] === 'POST') ? 200 : 404 });
  };
  const a = await prepareDoc({ org: 'o', repo: 'r', path: '/', mode: 'copy', token: 't', fetchImpl });
  assert.equal(a.target, '/of1-demo/home');
  assert.equal(a.created, 'created');
  const fetch2 = async (url) => new Response(PAGE, { status: 200 });
  assert.equal((await prepareDoc({ org: 'o', repo: 'r', path: '/', mode: 'copy', token: 't', fetchImpl: fetch2 })).created, 'exists');
  assert.deepEqual(await prepareDoc({ org: 'o', repo: 'r', path: '/about', mode: 'real', token: 't', fetchImpl: fetch2 }), { target: '/about', created: 'exists' });
});

test('pickDecisionSection skips a generative CTA section', () => {
  const cta = ctaSectionHtml({ block: 'banner', heading: ['h', 'd'], text: ['t', 'd'], button: { label: ['l', 'd'], href: '/of1' } });
  const html = replaceSection(PAGE, 2, cta);
  assert.deepEqual(pickDecisionSection(html, 1), { index: -1, reason: 'no promo or teaser section' });
  const two = '<body><main><div><h1>a</h1></div>' + cta + '<div><div class="promo"><div><div>x</div></div></div></div></main></body>';
  assert.equal(pickDecisionSection(two, 0).index, 2);
});

test('hasDecision matches class variants', () => {
  assert.equal(hasDecision('<div class="decision hero"><div></div></div>'), true);
  assert.equal(hasDecision('<div class="decisions"></div>'), false);
});

test('prepare-page CLI rejects an invalid --mode', async () => {
  let err = '';
  const code = await run(['prepare-page', '/x', '--mode', 'bogus'], undefined, { write() {} }, { write: (s) => { err += s; } });
  assert.equal(code, 1);
  assert.match(err, /prepare-page <path> --mode copy\|real/);
});
