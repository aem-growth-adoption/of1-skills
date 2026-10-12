import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'download-images.mjs');
const base = ['--owner', 'o', '--repo', 'r', '--branch', 'b'];
const run = (extra) => spawnSync(process.execPath, [script, ...base, ...extra], {
  encoding: 'utf8',
  env: { PATH: process.env.PATH },
});

test('rejects --products-json', () => {
  const r = run(['--products-json', 'x']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown argument: --products-json/);
});

test('rejects --update-products', () => {
  const r = run(['--update-products']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown argument: --update-products/);
});

test('requires --input', () => {
  const r = run([]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--input/);
});
