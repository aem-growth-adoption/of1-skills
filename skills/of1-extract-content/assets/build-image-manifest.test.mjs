import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest } from './build-image-manifest.mjs';
import { hashSrc } from './publish-knowledge-da.mjs';

test('buildManifest emits one entry per unique image src, keyed by hashSrc', () => {
  const entries = [
    { title: 'A', blocks: [{ tag: 'p', text: 'x' }, { tag: 'img', src: 'https://s/a.png', alt: '' }] },
    { title: 'B', blocks: [{ tag: 'img', src: 'https://s/b.png', alt: '' }, { tag: 'img', src: 'https://s/a.png', alt: '' }] },
  ];
  const m = buildManifest(entries);
  assert.deepEqual(m, [
    { productId: hashSrc('https://s/a.png'), urls: ['https://s/a.png'] },
    { productId: hashSrc('https://s/b.png'), urls: ['https://s/b.png'] },
  ]);
});

test('buildManifest returns [] when there are no image blocks', () => {
  assert.deepEqual(buildManifest([{ title: 'A', blocks: [{ tag: 'p', text: 'x' }] }]), []);
  assert.deepEqual(buildManifest([]), []);
  assert.deepEqual(buildManifest(null), []);
});

test('buildManifest ignores img blocks with empty src', () => {
  assert.deepEqual(buildManifest([{ blocks: [{ tag: 'img', src: '', alt: '' }] }]), []);
});
