import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeTemplate, keepRows } from './compose-template.mjs';
import { harvest } from './harvest-sections.mjs';
import { findBadImages } from './template-images.mjs';

const PAGE = 'https://main--r--o.aem.page/en';
const pic = (u, wh = ' width="768" height="384"') => `<picture><source srcset="${u}"><img alt="Old alt" src="${u}"${wh}></picture>`;
const SRC = `<div>
  <div class="hero-split"><div><div>${pic('https://s.example/hero.jpg')}</div></div><div><div><h1>Old headline</h1></div></div><div><div><a href="https://old.example/book"><picture><img src="https://s.example/i.png" width="32" height="32"></picture></a><strong>Book now</strong></div></div></div>
  <div class="news-cards">
    <div><div>${pic('https://s.example/a.jpg')}</div><div><p>Promo A</p><h3>Card A</h3><p><a href="https://old.example/a">More</a></p></div><div>green</div></div>
    <div><div>${pic('https://s.example/b.jpg')}</div><div><p>Promo B</p><h3>Card B</h3><p><a href="https://old.example/b">More</a></p></div><div>dark-grey</div></div>
    <div><div>${pic('https://s.example/c.jpg')}</div><div><p>Promo C</p><h3>Card C</h3><p><a href="https://old.example/c">More</a></p></div><div>violet</div></div>
  </div>
</div>`;
const H = harvest([{ url: PAGE, html: SRC }]);
const META = { intent: 'comparison', description: 'Hero and two cards', minItems: 2, maxItems: 2 };
const spec = (sections, extra = {}) => ({ ...META, sections, ...extra });

test('keepRows keeps only the requested direct child rows, in the given order', () => {
  const out = keepRows(H.blocks['news-cards'][0].html, [2, 0]);
  assert.match(out, /^<div class="news-cards">/);
  assert.ok(out.indexOf('Card C') < out.indexOf('Card A'));
  assert.doesNotMatch(out, /Card B/);
  assert.throws(() => keepRows(H.blocks['news-cards'][0].html, [5]), /row 5/);
});

test('composes a body-wrapped document from harvested blocks with section-metadata, one block per section', () => {
  const { html } = composeTemplate(spec([{ block: 'hero-split' }, { block: 'news-cards', keepRows: [0, 1] }]), H);
  assert.match(html, /^<body><header><\/header><main>/);
  assert.match(html, /<\/main><footer><\/footer><\/body>$/);
  assert.equal((html.match(/<div class="hero-split">/g) || []).length, 1);
  assert.match(html, /<div class="news-cards">/);
  assert.doesNotMatch(html, /Card C/);
  for (const [k, v] of [['Template Intent', 'comparison'], ['Template Description', 'Hero and two cards'], ['Template Min Items', '2'], ['Template Max Items', '2']]) {
    assert.match(html, new RegExp(`<div>${k}</div><div>${v}</div>`));
  }
  // real harvested images stay as they were
  assert.match(html, /https:\/\/s\.example\/a\.jpg/);
  assert.deepEqual(findBadImages(html), []);
});

test('replace swaps exact text (HTML-escaped) and fails loudly when the text is not in the block', () => {
  const { html } = composeTemplate(spec([{ block: 'hero-split', replace: [['Old headline', 'Compare <A> & B']] }]), H);
  assert.match(html, /<h1>Compare &lt;A&gt; &amp; B<\/h1>/);
  assert.throws(() => composeTemplate(spec([{ block: 'hero-split', replace: [['Not there', 'x']] }]), H), /"Not there" not found in hero-split/);
});

test('images replace content pictures in order (not icons), with the given alt; remaining ones stay real', () => {
  const { html } = composeTemplate(spec([{ block: 'news-cards', keepRows: [0, 1], images: [{ url: 'https://s.example/NEW.jpg', alt: 'New car' }] }]), H);
  assert.match(html, /<img[^>]*src="https:\/\/s\.example\/NEW\.jpg"[^>]*alt="New car"|<img[^>]*alt="New car"[^>]*src="https:\/\/s\.example\/NEW\.jpg"/);
  assert.equal((html.match(/NEW\.jpg/g) || []).length, 3); // two <source srcset> + <img src>
  assert.match(html, /https:\/\/s\.example\/b\.jpg/); // second card untouched
  const hero = composeTemplate(spec([{ block: 'hero-split', images: [{ url: 'https://s.example/NEW.jpg', alt: 'x' }] }]), H).html;
  assert.match(hero, /https:\/\/s\.example\/i\.png/); // the 32px icon is not a content image
  assert.doesNotMatch(hero, /hero\.jpg/);
});

test('refuses placeholder, invented or unusable images', () => {
  for (const url of ['https://picsum.photos/seed/a/10/10', 'about:error', 'https://www.acme.com/example-hero.jpg']) {
    assert.throws(() => composeTemplate(spec([{ block: 'news-cards', images: [{ url, alt: 'x' }] }]), H), /not a real image/);
  }
});

test('ctaHref points every link of the template at /of1 (including the icon button)', () => {
  const { html } = composeTemplate(spec([{ block: 'hero-split' }, { block: 'news-cards' }], { ctaHref: '/of1' }), H);
  assert.deepEqual([...new Set([...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]))], ['/of1']);
});

test('unknown block, bad pick and commas in metadata are rejected', () => {
  assert.throws(() => composeTemplate(spec([{ block: 'nope' }]), H), /no harvested block "nope"/);
  assert.throws(() => composeTemplate(spec([{ block: 'hero-split', pick: 3 }]), H), /hero-split.*pick 3/);
  assert.throws(() => composeTemplate({ ...META, description: 'a, b', sections: [{ block: 'hero-split' }] }, H), /comma/);
  assert.throws(() => composeTemplate({ ...META, sections: [] }, H), /at least one section/);
});
