import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildResult } from './write-result.mjs';

const CLI = new URL('./write-result.mjs', import.meta.url).pathname;

test('buildResult: done with deliverables and checks', () => {
  const r = buildResult({
    status: 'done', summary: 'ok',
    deliverable: ['https://a.example/x=Hub', 'https://b.example/?q=1=Search'],
    checks: '6/6',
  });
  assert.deepEqual(r, {
    status: 'done', summary: 'ok',
    deliverables: [{ url: 'https://a.example/x', label: 'Hub' }, { url: 'https://b.example/?q=1', label: 'Search' }],
    checks: { passed: 6, total: 6 },
  });
});

test('buildResult: defaults', () => {
  assert.deepEqual(buildResult({ status: 'failed', summary: 'x' }),
    { status: 'failed', summary: 'x', deliverables: [], checks: { passed: 0, total: 0 } });
});

test('buildResult: invalid status throws', () => {
  assert.throws(() => buildResult({ status: 'nope', summary: 'x' }));
});

test('CLI writes the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wr-'));
  const p = spawnSync('node', [CLI, '--state-dir', dir, '--status', 'review', '--summary', 'hi',
    '--deliverable', 'https://x.test/=X', '--checks', '5/6']);
  assert.equal(p.status, 0, p.stderr.toString());
  const j = JSON.parse(readFileSync(join(dir, 'of1-integration-result.json'), 'utf8'));
  assert.equal(j.status, 'review');
  assert.deepEqual(j.checks, { passed: 5, total: 6 });
  assert.deepEqual(j.deliverables, [{ url: 'https://x.test/', label: 'X' }]);
});

test('CLI invalid status exits non-zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wr-'));
  const p = spawnSync('node', [CLI, '--state-dir', dir, '--status', 'bad', '--summary', 's']);
  assert.notEqual(p.status, 0);
});
