import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBlocks, absolutizeHtml, harvest, selectPaths } from './harvest-sections.mjs';

const PAGE = 'https://main--r--o.aem.page/en/services';
const pic = (u, extra = '') => `<picture><source srcset="${u}" media="(min-width: 600px)"><img loading="lazy" alt="Car" src="${u}"${extra}></picture>`;
const HTML = `<div>
  <div class="hero-split spaced"><div><div>${pic('./media_1aaa.jpg?width=750&#x26;format=jpg', ' width="690" height="518"')}</div></div><div><div><h1>Services</h1></div></div></div>
  <div class="news-cards grey">
    <div><div>${pic('/media_1bbb.jpg', ' width="768" height="384"')}</div><div><p>Promo</p><h3>One</h3><p><a href="./one">Go</a></p></div><div>green</div></div>
    <div><div>${pic('https://cdn.example/c.jpg', ' width="768" height="384"')}</div><div><p>Promo</p><h3>Two</h3><p><a href="/two">Go</a></p></div><div>dark-grey</div></div>
  </div>
</div>
<div><div class="pledge-row"><div><div><picture><img src="./icon.svg" width="32" height="32" alt=""></picture></div><div><p><strong>Safety</strong></p></div></div></div>
<div class="section-metadata"><div><div>Style</div><div>x</div></div></div></div>
<div><p>Default content, not a block</p></div>`;

test('splitBlocks returns top-level blocks with name, classes, rows and outer html; skips section-metadata and default content', () => {
  const blocks = splitBlocks(HTML);
  assert.deepEqual(blocks.map((b) => b.name), ['hero-split', 'news-cards', 'pledge-row']);
  assert.equal(blocks[0].classes, 'hero-split spaced');
  assert.equal(blocks[1].rows, 2);
  assert.ok(blocks[1].html.startsWith('<div class="news-cards grey">') && blocks[1].html.endsWith('</div>'));
  assert.match(blocks[1].html, /<h3>Two<\/h3>/);
  assert.doesNotMatch(blocks[1].html, /pledge-row/);
});

test('absolutizeHtml resolves ./, / and bare src/srcset/href against the page; leaves absolute, #, mailto, data untouched', () => {
  const out = absolutizeHtml('<img src="./a.jpg"><img srcset="/b.jpg 1x, c.jpg 2x"><a href="/x">x</a><a href="https://e.com/y">y</a><a href="#top">t</a><a href="mailto:a@b.c">m</a><img src="data:image/gif;base64,AAA">', PAGE);
  assert.match(out, /src="https:\/\/main--r--o\.aem\.page\/en\/a\.jpg"/);
  assert.match(out, /srcset="https:\/\/main--r--o\.aem\.page\/b\.jpg 1x, https:\/\/main--r--o\.aem\.page\/en\/c\.jpg 2x"/);
  assert.match(out, /href="https:\/\/main--r--o\.aem\.page\/x"/);
  assert.match(out, /href="https:\/\/e\.com\/y"/);
  assert.match(out, /href="#top"/);
  assert.match(out, /href="mailto:a@b\.c"/);
  assert.match(out, /src="data:image\/gif;base64,AAA"/);
});

test('harvest groups absolutized blocks by type and builds a de-duplicated pool of real content images', () => {
  const h = harvest([{ url: PAGE, html: HTML }]);
  assert.deepEqual(h.pages, [PAGE]);
  assert.deepEqual(Object.keys(h.blocks).sort(), ['hero-split', 'news-cards', 'pledge-row']);
  const nc = h.blocks['news-cards'][0];
  assert.equal(nc.page, PAGE); assert.equal(nc.rows, 2); assert.equal(nc.images, 2);
  assert.doesNotMatch(nc.html, /src="\.\//); // absolute now
  assert.match(nc.html, /href="https:\/\/main--r--o\.aem\.page\/en\/one"/);
  // image pool: content images only (the 32px svg icon is excluded), absolute, entity-decoded, unique, with alt + page
  assert.deepEqual(h.images.map((i) => i.url), [
    'https://main--r--o.aem.page/en/media_1aaa.jpg?width=750&format=jpg',
    'https://main--r--o.aem.page/media_1bbb.jpg',
    'https://cdn.example/c.jpg',
  ]);
  assert.equal(h.images[0].alt, 'Car'); assert.equal(h.images[0].page, PAGE);
});

test('harvest never puts placeholder images into the pool', () => {
  const h = harvest([{ url: PAGE, html: `<div><div class="hero">${pic('https://picsum.photos/seed/a/10/10')}${pic('https://s.example/real.jpg')}</div></div>` }]);
  assert.deepEqual(h.images.map((i) => i.url), ['https://s.example/real.jpg']);
});

test('selectPaths keeps content pages from a site index, drops OF1/template/nav/fragment/draft paths, caps the count', () => {
  const index = { data: ['/', '/en', '/en/services', '/of1', '/of1/knowledge/a', '/templates/x', '/nav', '/footer', '/fragments/f', '/drafts/d', '/en/redirects', '/de'].map((path) => ({ path })) };
  assert.deepEqual(selectPaths(index, 10), ['/', '/en', '/en/services', '/de']);
  assert.deepEqual(selectPaths(index, 2), ['/', '/en']);
  assert.deepEqual(selectPaths({}, 5), []);
});
