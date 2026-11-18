import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { slotProblems } from './template-slots.mjs';

const pic = (n) => `<picture><img src="https://x.aem.page/media_1${'a'.repeat(40)}${n}.jpg" alt="p${n}"></picture>`;
const doc = (...sections) => `<body><header></header><main>${sections.map((s) => `<div>${s}</div>`).join('')}</main><footer></footer></body>`;
const block = (cls, rows) => `<div class="${cls}">${rows.map((cells) => `<div>${cells.map((c) => `<div>${c}</div>`).join('')}</div>`).join('')}</div>`;

// Shapes the OF1 worker fills (gen-web slot-address.js): a cell with a picture is an image slot.
const TABS = block('tabs cards separator', [
  ['All', `${pic(1)}<p><a href="/a">Bali Surf Camp</a></p><p>Surf in Bali.</p>`],
  ['Climbing', `${pic(2)}<p><a href="/b">Colorado</a></p><p>Climb.</p>`],
]);
const CAROUSEL_MINI = block('carousel mini', [[pic(1)], [pic(2)], [pic(3)]]);
const CARDS = block('cards separator', [
  [pic(1), '<p><a href="/a">Bali Surf Camp</a></p><p>Surf in Bali.</p>'],
  [pic(2), '<p><a href="/b">Colorado</a></p><p>Climb in Colorado.</p>'],
]);
const TEASER = block('teaser featured', [[pic(1)], ['<p>Featured</p><h2>Camping</h2><p>Text.</p><p><a href="/c">Read</a></p>']]);
const TRIP = block('trip-details grid', [['Activity', 'Surfing'], ['Trip Length', '6 Days'], ['Price', '5000.0']]);

test('slotProblems: a picture and text in one cell can never be written (tabs of cards)', () => {
  const p = slotProblems(doc(TABS, CARDS));
  assert.ok(p.some((x) => /tabs cards separator.*picture and text in one cell/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /tabs cards separator.*nothing to write/.test(x)), p.join('\n'));
});

test('slotProblems: repeated rows with only pictures are always dropped (carousel mini)', () => {
  const p = slotProblems(doc(CAROUSEL_MINI, TEASER));
  assert.ok(p.some((x) => /carousel mini.*nothing to write/.test(x)), p.join('\n'));
});

test('slotProblems: cards, teaser and label/value blocks are fillable', () => {
  assert.deepEqual(slotProblems(doc(CARDS, TEASER, TRIP)), []);
});

test('slotProblems: label/value labels are not writable text', () => {
  const pics = block('specs', [['Hero', pic(1)], ['Gallery', pic(2)]]);
  assert.ok(slotProblems(doc(pics, CARDS)).some((x) => /specs.*nothing to write/.test(x)));
});

test('template-slots CLI: problems on stdout, exit 1; a clean template exits 0 silently', () => {
  const cli = fileURLToPath(new URL('./template-slots.mjs', import.meta.url));
  assert.equal(execFileSync('node', [cli], { input: doc(CARDS, TEASER) }).toString(), '');
  let err;
  try { execFileSync('node', [cli], { input: doc(TABS) }); } catch (e) { err = e; }
  assert.equal(err?.status, 1);
  assert.match(err.stdout.toString(), /picture and text in one cell/);
});
