// skills/of1-extract-content/assets/publish-knowledge-da.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, resolveSlug, renderKnowledgeDoc } from './publish-knowledge-da.mjs';

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
