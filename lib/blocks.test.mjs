import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installBlock, styleFromDesign } from './blocks.mjs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('of1.js loads the SDK from its own origin and has no worker config', () => {
  const js = read('../assets/blocks/of1/of1.js');
  assert.match(js, /\/sdk\/of1-client\.js/);
  assert.match(js, /window\.location\.origin/);
  assert.doesNotMatch(js, /api-endpoint|readBlockConfig|workers\.dev|DEFAULT_WORKER_URL/);
});

test('decision.js equals the proxy reference byte-for-byte', () => {
  assert.equal(read('../assets/blocks/decision/decision.js'), read('./fixtures/decision.reference.js'));
});

test('installBlock installs once and keeps local edits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-'));
  assert.equal(installBlock({ repoDir: dir, name: 'decision' }), 'installed');
  const f = path.join(dir, 'blocks/decision/decision.js');
  fs.appendFileSync(f, '// local');
  assert.equal(installBlock({ repoDir: dir, name: 'decision' }), 'exists');
  assert.match(fs.readFileSync(f, 'utf8'), /\/\/ local$/);
  assert.equal(installBlock({ repoDir: dir, name: 'decision', overwrite: true }), 'updated');
});

test('styleFromDesign maps primary colour to --of1-accent and adds no font-family', () => {
  const css = read('../assets/blocks/of1/of1.css');
  const out = styleFromDesign(css, { colors: { primary: '#ff0066' }, typography: { heading: 'Georgia, serif' } });
  assert.match(out, /--of1-accent:\s*#ff0066;/);
  assert.match(out, /--of1-font-heading:\s*Georgia, serif;/);
  assert.equal(styleFromDesign(css, {}), css);
});

test('styleFromDesign maps a real Stardust DESIGN.json, fonts included', () => {
  const css = read('../assets/blocks/of1/of1.css');
  const design = JSON.parse(read('./fixtures/design.arco.json'));
  const out = styleFromDesign(css, design);
  for (const re of [
    /--of1-primary:\s*#B5651D;/, /--of1-primary-hover:\s*#8E4E14;/, /--of1-accent:\s*#B5651D;/,
    /--of1-text:\s*#1C2B35;/, /--of1-text-secondary:\s*#5C6B73;/, /--of1-surface:\s*#FFFFFF;/,
    /--of1-border:\s*#D4CFC5;/, /--of1-radius-card:\s*12px;/, /--of1-radius-pill:\s*100px;/,
    /--of1-font-heading:\s*'Inter', sans-serif;/, /--of1-font-body:\s*'Inter', sans-serif;/,
  ]) assert.match(out, re);
});

test('styleFromDesign rejects unsafe values', () => {
  const css = read('../assets/blocks/of1/of1.css');
  const out = styleFromDesign(css, { colors: { primary: 'red; } body { display:none' }, typography: { body: { family: 'a\nb' } } });
  assert.equal(out, css);
});
