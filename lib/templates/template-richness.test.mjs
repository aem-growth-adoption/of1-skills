import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countContentBlocks, maxItems } from './template-richness.mjs';

const SCRIPT = fileURLToPath(new URL('./template-richness.mjs', import.meta.url));

// Shape of a real EDS `.plain.html`: top-level section <div>s, block wrappers
// `<div class="NAME[ variant]">` directly inside, classless row/cell <div>s below.
// No "block" class — that is added client-side by decorateBlocks().
const PLAIN = `<div>
  <div class="hero">
    <div>
      <div><picture><img src="./media_1.png" alt=""></picture></div>
      <div><h1>Find your fit</h1><p>Intro</p></div>
    </div>
  </div>
  <div class="cards variant-double">
    <div><div>A</div><div>B</div></div>
    <div><div>C</div><div>D</div></div>
  </div>
</div>
<div>
  <div class="columns">
    <div><div><p>x</p></div><div><p>y</p></div></div>
  </div>
  <div class="section-metadata">
    <div>
      <div>Template Intent</div>
      <div>recommendation</div>
    </div>
    <div>
      <div>Template Max Items</div>
      <div>
        4
      </div>
    </div>
  </div>
</div>`;

test('countContentBlocks counts block wrappers in real plain.html, excluding section-metadata', () => {
  assert.equal(countContentBlocks(PLAIN), 3);
});

test('countContentBlocks ignores classed divs nested inside cells', () => {
  const html = '<div><div class="cards"><div><div><div class="inner">x</div></div></div></div></div>';
  assert.equal(countContentBlocks(html), 1);
});

test('countContentBlocks returns 0 for a template with only section-metadata or nothing', () => {
  assert.equal(countContentBlocks('<div><div class="section-metadata"><div><div>a</div><div>b</div></div></div></div>'), 0);
  assert.equal(countContentBlocks(''), 0);
});

test('maxItems reads Template Max Items across multi-line HTML (bare or <p>-wrapped)', () => {
  assert.equal(maxItems(PLAIN), 4);
  assert.equal(maxItems('<div class="section-metadata"><div><div><p>Template Max Items</p></div><div><p>2</p></div></div></div>'), 2);
  assert.equal(maxItems('<div><div class="hero"></div></div>'), null);
});

test('CLI prints "<blocks> <maxItems>" from stdin (maxItems empty when absent)', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { input: PLAIN, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '3 4');
  const r2 = spawnSync(process.execPath, [SCRIPT], { input: '<div><div class="hero"></div></div>', encoding: 'utf8' });
  assert.equal(r2.stdout, '1 \n');
});

test('CLI works when invoked through a symlink (installed-skill layout)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-richness-'));
  const link = path.join(dir, 'template-richness.mjs');
  fs.symlinkSync(SCRIPT, link);
  const r = spawnSync(process.execPath, [link], { input: PLAIN, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '3 4');
});

test('countContentBlocks excludes page metadata blocks too', () => {
  const html = '<div><div class="hero"></div><div class="metadata"><div><div>Title</div><div>x</div></div></div></div>';
  assert.equal(countContentBlocks(html), 1);
});
