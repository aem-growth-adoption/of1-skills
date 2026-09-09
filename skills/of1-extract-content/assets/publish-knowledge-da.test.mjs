// skills/of1-extract-content/assets/publish-knowledge-da.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, resolveSlug, renderKnowledgeDoc, renderContentDoc, hashSrc } from './publish-knowledge-da.mjs';

test('slugify normalizes to url-safe slug', () => {
  assert.equal(slugify('Multi-Entity Accounting!'), 'multi-entity-accounting');
  assert.equal(slugify('  A / B  '), 'a-b');
  assert.equal(slugify(''), 'page');
});

test('resolveSlug prefers slug, else derives from url last segment', () => {
  assert.equal(resolveSlug({ slug: 'x', url: 'https://s/a/b' }), 'x');
  assert.equal(resolveSlug({ url: 'https://site.com/accounting/multi-entity' }), 'multi-entity');
});

test('renderKnowledgeDoc emits bare h1 + blocks, escaped, no block tables', () => {
  const html = renderKnowledgeDoc({
    title: 'Returns & Refunds',
    blocks: [
      { tag: 'h2', text: 'How to return' },
      { tag: 'p', text: 'Ship it <back> in 30 days.' },
      { tag: 'li', text: 'Step one' },
      { tag: 'li', text: 'Step two' },
      { tag: 'p', text: '' },
    ],
  });
  assert.match(html, /<h1>Returns &amp; Refunds<\/h1>/);
  assert.match(html, /<h2>How to return<\/h2>/);
  assert.match(html, /<p>Ship it &lt;back&gt; in 30 days\.<\/p>/);
  assert.match(html, /<ul><li>Step one<\/li><li>Step two<\/li><\/ul>/);
  assert.doesNotMatch(html, /class="/); // no EDS block tables
  assert.doesNotMatch(html, /<p><\/p>/); // empty block dropped
  assert.match(html, /^<body>/);
});

test('renderKnowledgeDoc drops a captured block that repeats the title (no duplicate h1)', () => {
  const html = renderKnowledgeDoc({
    title: 'Multi-entity accounting',
    blocks: [
      { tag: 'h1', text: 'Multi-entity accounting' },
      { tag: 'p', text: 'Consolidate every entity.' },
    ],
  });
  const h1Count = (html.match(/<h1>/g) || []).length;
  assert.equal(h1Count, 1);
  assert.match(html, /<h1>Multi-entity accounting<\/h1>/);
  assert.match(html, /<p>Consolidate every entity\.<\/p>/);
});

test('hashSrc is stable and 12 hex chars', () => {
  assert.match(hashSrc('https://x/a.png'), /^[0-9a-f]{12}$/);
  assert.equal(hashSrc('https://x/a.png'), hashSrc('https://x/a.png'));
  assert.notEqual(hashSrc('https://x/a.png'), hashSrc('https://x/b.png'));
});

test('renderContentDoc rewrites image blocks to rehosted DA urls, in order', () => {
  const src = 'https://wknd.site/media_abc.png?width=750';
  const map = { [hashSrc(src)]: ['https://main--r--o.aem.page/media/product-abc-1.png'] };
  const html = renderContentDoc({
    title: 'Adventures',
    blocks: [
      { tag: 'h2', text: 'Hiking' },
      { tag: 'img', src, alt: 'A trail' },
      { tag: 'p', text: 'Great hikes.' },
    ],
  }, map);
  assert.match(html, /<p><img src="https:\/\/main--r--o\.aem\.page\/media\/product-abc-1\.png" alt="A trail"><\/p>/);
  // image appears before the paragraph (document order preserved)
  assert.ok(html.indexOf('/media/product-abc-1.png') < html.indexOf('Great hikes.'));
});

test('renderContentDoc drops an image whose src is not in the map (rehost failed)', () => {
  const html = renderContentDoc({
    title: 'T',
    blocks: [{ tag: 'img', src: 'https://x/missing.png', alt: 'x' }, { tag: 'p', text: 'body' }],
  }, {});
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('body'));
});

test('renderContentDoc escapes alt and flushes a preceding li run before the image', () => {
  const src = 'https://x/a.png';
  const map = { [hashSrc(src)]: ['https://da/a.png'] };
  const html = renderContentDoc({
    title: 'T',
    blocks: [{ tag: 'li', text: 'one' }, { tag: 'img', src, alt: 'a "quote" <b>' }],
  }, map);
  assert.ok(html.indexOf('<ul><li>one</li></ul>') < html.indexOf('<img'));
  assert.match(html, /alt="a &quot;quote&quot; &lt;b&gt;"/);
});

test('renderKnowledgeDoc still emits text-only (backward compat, image blocks dropped)', () => {
  const html = renderKnowledgeDoc({
    title: 'Returns',
    blocks: [{ tag: 'p', text: 'Ship it back.' }, { tag: 'img', src: 'https://x/a.png', alt: 'x' }],
  });
  assert.ok(html.includes('Ship it back.'));
  assert.ok(!html.includes('<img'));
});
