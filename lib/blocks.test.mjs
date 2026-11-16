import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBlock, styleFromDesign, blockCommands, parseFrontmatter, loadDesign } from './blocks.mjs';

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

test('install-block --design installs a block that has no CSS (decision)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-'));
  const design = path.join(dir, 'DESIGN.json');
  fs.writeFileSync(design, JSON.stringify({ colors: { primary: '#ff0066' } }));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const { result } = await blockCommands['install-block'](['decision', '--design', design]);
    assert.equal(result.status, 'installed');
  } finally { process.chdir(cwd); }
  assert.deepEqual(fs.readdirSync(path.join(dir, 'blocks/decision')), ['decision.js']);
  assert.equal(fs.readFileSync(path.join(dir, 'blocks/decision/decision.js'), 'utf8'), read('../assets/blocks/decision/decision.js'));
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

test('parseFrontmatter reads the YAML subset of a DESIGN.md frontmatter', () => {
  const fm = parseFrontmatter([
    '<!-- provenance',
    '  writtenBy: x',
    '-->',
    '---',
    'name: WKND # trailing comment',
    '# a comment line',
    'colors:',
    '  wknd-yellow: "#ffea00"',
    "  ink: '#202020'",
    'typography:',
    '  display:',
    '    fontFamily: "asar, \'Times New Roman\', serif"',
    '    fontWeight: 400',
    '  tags:',
    '    - not supported',
    'rounded:',
    '  none: 0px',
    '---',
    '# Body',
    'colors: ignored',
  ].join('\n'));
  assert.equal(fm.name, 'WKND');
  assert.deepEqual(fm.colors, { 'wknd-yellow': '#ffea00', ink: '#202020' });
  assert.equal(fm.typography.display.fontFamily, "asar, 'Times New Roman', serif");
  assert.equal(fm.typography.display.fontWeight, '400');
  assert.equal(fm.rounded.none, '0px');
  assert.deepEqual(parseFrontmatter('# no frontmatter'), {});
});

test('styleFromDesign maps a schemaVersion 2 DESIGN.md + DESIGN.json pair', () => {
  const css = read('../assets/blocks/of1/of1.css');
  const design = loadDesign(fileURLToPath(new URL('./fixtures/wknd/DESIGN.json', import.meta.url)));
  const out = styleFromDesign(css, design);
  for (const re of [
    /--of1-primary:\s*#ffea00;/, /--of1-accent:\s*#ffea00;/, /--of1-text:\s*#202020;/,
    /--of1-text-secondary:\s*#696969;/, /--of1-surface:\s*#ffffff;/, /--of1-border:\s*#ebebeb;/,
    /--of1-radius-card:\s*0px;/, /--of1-radius-pill:\s*50%;/,
    /--of1-font-heading:\s*asar,/, /--of1-font-body:\s*'Source Sans Pro',/,
  ]) assert.match(out, re);
});

test('loadDesign keeps the old top-level DESIGN.json shape', () => {
  const design = loadDesign(fileURLToPath(new URL('./fixtures/design.arco.json', import.meta.url)));
  assert.equal(design.colors.primary, '#B5651D');
  assert.equal(design.rounded.md, '12px');
});

test('install-block --design reports how many tokens it mapped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blk-'));
  for (const f of ['DESIGN.md', 'DESIGN.json']) fs.copyFileSync(new URL(`./fixtures/wknd/${f}`, import.meta.url), path.join(dir, f));
  const empty = path.join(dir, 'empty');
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(empty, 'DESIGN.json'), JSON.stringify({ schemaVersion: 2, extensions: {} }));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const { result } = await blockCommands['install-block'](['of1', '--design', path.join(dir, 'DESIGN.json')]);
    assert.equal(result.status, 'installed');
    assert.equal(result.design.mapped, 10);
    const { result: none } = await blockCommands['install-block'](['of1', '--design', path.join(empty, 'DESIGN.json'), '--overwrite']);
    assert.equal(none.design.mapped, 0);
    const { result: plain } = await blockCommands['install-block'](['decision']);
    assert.equal(plain.design, undefined);
  } finally { process.chdir(cwd); }
});

test('styleFromDesign rejects unsafe values', () => {
  const css = read('../assets/blocks/of1/of1.css');
  const out = styleFromDesign(css, { colors: { primary: 'red; } body { display:none' }, typography: { body: { family: 'a\nb' } } });
  assert.equal(out, css);
});
