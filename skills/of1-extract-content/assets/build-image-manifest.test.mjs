import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, parseArgs } from './build-image-manifest.mjs';
import { hashSrc } from './publish-knowledge-da.mjs';

const SCRIPT = fileURLToPath(new URL('./build-image-manifest.mjs', import.meta.url));

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

test('parseArgs: --pages sets the input file', () => {
  assert.equal(parseArgs(['--pages', '/tmp/x.json']).pages, '/tmp/x.json');
});

test('parseArgs: default pages is $OF1_STATE_DIR/knowledge-pages.json', () => {
  const saved = process.env.OF1_STATE_DIR;
  process.env.OF1_STATE_DIR = '/state';
  try {
    assert.equal(parseArgs([]).pages, '/state/knowledge-pages.json');
  } finally {
    if (saved === undefined) delete process.env.OF1_STATE_DIR; else process.env.OF1_STATE_DIR = saved;
  }
});

test('CLI: runs when invoked through a symlink, reading --pages', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bim-'));
  const link = path.join(dir, 'bim-link.mjs');
  fs.symlinkSync(SCRIPT, link);
  const pages = path.join(dir, 'knowledge-pages.json');
  fs.writeFileSync(pages, JSON.stringify([{ title: 'A', blocks: [{ tag: 'img', src: 'https://s/a.png' }] }]));
  const out = path.join(dir, 'manifest.json');
  const r = spawnSync(process.execPath, [link, '--pages', pages, '--output', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), [{ productId: hashSrc('https://s/a.png'), urls: ['https://s/a.png'] }]);
});
