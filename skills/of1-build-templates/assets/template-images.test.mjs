import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractImageUrls, classifyImage, findBadImages, isImageResponse } from './template-images.mjs';

const SCRIPT = fileURLToPath(new URL('./template-images.mjs', import.meta.url));
const pic = (u) => `<picture><source srcset="${u}" media="(min-width: 600px)"><source srcset="${u}"><img src="${u}" alt=""></picture>`;

test('extractImageUrls reads src and srcset, decodes entity-encoded query separators, dedupes', () => {
  const html = `${pic('https://s/a.jpg?width=750&#x26;format=jpg')}<img src="./b.png"><img src='https://s/a.jpg?width=750&format=jpg'>`;
  assert.deepEqual(extractImageUrls(html), ['https://s/a.jpg?width=750&format=jpg', './b.png']);
});

test('extractImageUrls takes the first URL of every srcset candidate', () => {
  assert.deepEqual(extractImageUrls('<img srcset="https://s/a.jpg 1x, https://s/b.jpg 2x" src="https://s/a.jpg">'), ['https://s/a.jpg', 'https://s/b.jpg']);
});

for (const [url, reason] of [
  ['https://placehold.co/600x400.jpg', 'placeholder-host'],
  ['https://picsum.photos/seed/a/750/500', 'placeholder-host'],
  ['https://via.placeholder.com/300', 'placeholder-host'],
  ['https://dummyimage.com/300x200', 'placeholder-host'],
  ['about:error', 'unusable-src'],
  ['data:image/gif;base64,AAAA', 'unusable-src'],
  ['', 'unusable-src'],
  ['https://www.acme.com/example-hero.jpg', 'placeholder-name'],
  ['https://www.acme.com/content/dam/placeholder-card.jpg', 'placeholder-name'],
  ['https://main--r--o.aem.page/media_1.png?width=750', 'placeholder-name'],
]) {
  test(`classifyImage flags ${url || '(empty)'} as ${reason}`, () => assert.equal(classifyImage(url), reason));
}

for (const url of [
  'https://main--r--o.aem.page/of1/knowledge/media_1f38e82e84226dbcbf269d9f3f5471be80f50a2d5.jpg?width=750&format=jpg',
  './media_1abc123def4567890abc123def4567890abc12345.png',
  '/media_1abc123def4567890abc123def4567890abc12345.png',
  'https://cdn.acme.com/products/vehicle-1.jpg',
  'https://dam.amag-group.ch/is/image/amagproduction/amag-vw-id-polo-header-desktop-v3:16_9_Large?wid=1920',
]) {
  test(`classifyImage accepts ${url.slice(0, 60)}`, () => assert.equal(classifyImage(url), null));
}

test('findBadImages lists each bad URL once with its reason; clean HTML gives []', () => {
  const html = `${pic('https://picsum.photos/seed/a/750/500')}${pic('about:error')}<img src="https://s/ok.jpg">`;
  assert.deepEqual(findBadImages(html), [
    { url: 'https://picsum.photos/seed/a/750/500', reason: 'placeholder-host' },
    { url: 'about:error', reason: 'unusable-src' },
  ]);
  assert.deepEqual(findBadImages(pic('https://s/ok.jpg')), []);
});

test('isImageResponse: 200 + image/* content type only', () => {
  assert.equal(isImageResponse(200, 'image/jpeg'), true);
  assert.equal(isImageResponse(200, 'image/webp; charset=x'), true);
  assert.equal(isImageResponse(200, 'text/html'), false);
  assert.equal(isImageResponse(404, 'image/png'), false);
  assert.equal(isImageResponse(200, ''), false);
});

test('CLI: prints bad images and exits 1; exits 0 when clean', () => {
  const bad = spawnSync('node', [SCRIPT], { input: pic('https://placehold.co/10.jpg'), encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /placeholder-host\thttps:\/\/placehold\.co\/10\.jpg/);
  const ok = spawnSync('node', [SCRIPT], { input: pic('https://s/ok.jpg'), encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, '');
});

test('CLI --urls prints the unique image URLs one per line (for the online check)', () => {
  const r = spawnSync('node', [SCRIPT, '--urls'], { input: `${pic('https://s/a.jpg')}${pic('./b.png')}`, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'https://s/a.jpg\n./b.png\n');
});
