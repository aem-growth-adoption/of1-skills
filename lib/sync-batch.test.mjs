import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = { content: 'phase', error: 'Too many subrequests by single Worker invocation. To configure this limit, refer to https://developers.cloudflare.com/workers/wrangler/configuration/#limits' };

// A fake curl that answers each call with the next scripted response and records its URL.
function sandbox(responses) {
  const d = mkdtempSync(join(tmpdir(), 'of1batch-'));
  mkdirSync(join(d, 'bin'));
  responses.forEach((r, i) => writeFileSync(join(d, `r${i}.json`), typeof r === 'string' ? r : JSON.stringify(r)));
  writeFileSync(join(d, 'bin', 'curl'), `#!/bin/bash
n=$(cat ${d}/n 2>/dev/null || echo 0); echo $((n+1)) > ${d}/n
for a in "$@"; do case "$a" in https://*) echo "$a" >> ${d}/urls;; esac; done
f=${d}/r$n.json; [ -f "$f" ] || f=${d}/r$((${responses.length}-1)).json
printf '%s\\n200' "$(cat $f)"\n`, { mode: 0o755 });
  return d;
}
const sync = (d, stage = 'publish') => {
  const out = join(d, 'o.json');
  const r = spawnSync('bash', ['-c', `. ${ROOT}/lib/genweb.sh; DA_TOKEN=t of1_sync https://w acme/site ${out} ${stage}`], { encoding: 'utf8', env: { PATH: `${join(d, 'bin')}:${process.env.PATH}` } });
  let urls = []; try { urls = readFileSync(join(d, 'urls'), 'utf8').trim().split('\n'); } catch { /* none */ }
  return { r, urls, out: JSON.parse(readFileSync(out, 'utf8')) };
};

test('a normal sync is a single call, untouched', () => {
  const d = sandbox([{ ok: true, synced: ['config'], errors: [], content: { indexed: 12 } }]);
  const { r, urls, out } = sync(d);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(urls.length, 1);
  assert.equal(out.content.indexed, 12);
});

test('subrequest-cap error on the content phase re-runs content in batches and folds the result in', () => {
  const d = sandbox([
    { ok: true, synced: ['config', 'templates'], errors: [CAP], content: null },
    { ok: true, errors: [], content: { indexed: 500, done: false, next: 37, total: 90 } },
    { ok: true, errors: [], content: { indexed: 879, done: true, next: null, total: 90 } },
  ]);
  const { r, urls, out } = sync(d);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(urls.length, 3);
  assert.match(urls[1], /sync\?stage=publish&file=content&offset=0&limit=40$/);
  assert.match(urls[2], /sync\?stage=publish&file=content&offset=37&limit=40$/); // resumes at `next`, not offset+limit
  assert.equal(out.content.indexed, 879);
  assert.equal(out.content.done, true);
  assert.deepEqual(out.synced, ['config', 'templates']);
  assert.deepEqual(out.errors, []); // the cap error is resolved
  assert.equal(out.ok, true);
});

test('errors from a batch slice are kept; unrelated errors from the first call are kept', () => {
  const d = sandbox([
    { ok: true, errors: [{ file: 'suggestions', warning: 'x' }, CAP], content: null },
    { ok: true, errors: [{ content: '/of1/knowledge/a', error: 'fetch 500' }], content: { indexed: 5, done: true, next: null, total: 1 } },
  ]);
  const { out } = sync(d);
  assert.deepEqual(out.errors.map((e) => e.file || e.content), ['suggestions', '/of1/knowledge/a']);
});

test('other content errors do not trigger batching', () => {
  const d = sandbox([{ ok: true, errors: [{ content: 'phase', error: 'Vectorize or AI binding not configured' }], content: null }]);
  const { urls, out } = sync(d);
  assert.equal(urls.length, 1);
  assert.equal(out.errors.length, 1);
});

test('stops (and says so) when a batch never reports done, instead of looping forever', () => {
  const d = sandbox([
    { ok: true, errors: [CAP], content: null },
    { ok: true, errors: [], content: { indexed: 1, done: false, next: 0, total: 99 } }, // next never advances
  ]);
  const { r, urls, out } = sync(d);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(urls.length <= 52, `${urls.length} calls`);
  assert.ok(out.errors.some((e) => e.content === 'batch'), JSON.stringify(out.errors));
});
