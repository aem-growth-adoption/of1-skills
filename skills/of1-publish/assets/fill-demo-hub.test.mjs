import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderConfigLinks, renderStatusPanel, buildHub, formatSyncError } from './fill-demo-hub.mjs';

const SCRIPT = fileURLToPath(new URL('./fill-demo-hub.mjs', import.meta.url));
const TEMPLATE = fs.readFileSync(new URL('./demo-hub.html', import.meta.url), 'utf8');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fill-demo-hub-'));
}

test('renderConfigLinks links each authored DA item', () => {
  const html = renderConfigLinks({ owner: 'o', repo: 'r', previewBase: 'https://b--r--o.aem.page' });
  for (const url of [
    'https://da.live/edit#/o/r/of1/brand-voice',
    'https://da.live/sheet#/o/r/of1/config/personas',
    'https://da.live/sheet#/o/r/of1/config/suggestions',
    'https://da.live/#/o/r/templates',
    'https://da.live/#/o/r/of1/knowledge',
  ]) {
    assert.ok(html.includes(url), `missing ${url}`);
  }
  assert.ok(html.includes('https://b--r--o.aem.page/of1/config/config.json'));
  assert.ok(!html.includes('personas.json'));
});

test('renderStatusPanel shows skill status, sync errors, indexed count and failing checks', () => {
  const html = renderStatusPanel({
    statuses: [{ skill: 'of1-extract-content', status: 'failed', summary: 'x' }],
    sync: { ok: true, synced: ['config'], errors: [{ file: 'brand-voice', error: 'empty document' }], content: { indexed: 0 } },
    status: { ready: false, config: { hasTemplates: true, hasContent: false } },
  });
  for (const s of ['of1-extract-content', 'failed', 'empty document', 'indexed: 0', 'hasContent']) {
    assert.ok(html.includes(s), `missing ${s}`);
  }
});

test('renderStatusPanel renders worker error shapes {content,status} / {content,error} / {file,status}', () => {
  const html = renderStatusPanel({
    sync: {
      ok: true,
      synced: ['config'],
      errors: [
        { content: '/of1/knowledge/faq', status: 404 },
        { content: '/of1/knowledge/about', error: 'empty body' },
        { file: 'templates', status: 500 },
      ],
      content: { indexed: 3 },
    },
  });
  assert.ok(html.includes('/of1/knowledge/faq: HTTP 404'), html);
  assert.ok(html.includes('/of1/knowledge/about: empty body'), html);
  assert.ok(html.includes('templates: HTTP 500'), html);
  assert.ok(!html.includes('✗ ?'), 'unlabelled error row');
  assert.ok(!html.includes('{&quot;'), 'raw JSON dumped');
});

test('formatSyncError renders templateErrors, named errors and content truncation readably', () => {
  assert.deepEqual(
    formatSyncError({ file: 'templates', templateErrors: [{ template: 'rec-a', error: 'no section-metadata' }, { template: 'cmp', error: 'empty' }] }),
    { label: 'templates', msg: '2 template error(s): rec-a: no section-metadata; cmp: empty' },
  );
  assert.deepEqual(formatSyncError({ file: 'templates', name: 'rec-a', error: 'bad slot' }), { label: 'templates (rec-a)', msg: 'bad slot' });
  assert.deepEqual(formatSyncError({ template: 'rec-a', error: 'boom' }), { label: 'template rec-a', msg: 'boom' });
  assert.deepEqual(
    formatSyncError({ content: 'truncated', total: 80, indexed: 50 }),
    { label: 'content', msg: 'truncated — indexed 50 of 80 page(s)' },
  );
  const html = renderStatusPanel({ sync: { ok: true, synced: [], errors: [{ content: 'truncated', total: 80, indexed: 50 }] } });
  assert.ok(html.includes('content: truncated — indexed 50 of 80 page(s)'), html);
  assert.ok(!html.includes('{&quot;'));
});

test('formatSyncError renders warnings, non-string names and vectors purge errors', () => {
  const w = formatSyncError({ file: 'templates', warning: 'more than 30 templates found — sync truncated' });
  assert.deepEqual(w, { label: 'templates', msg: 'more than 30 templates found — sync truncated', warning: true });
  assert.deepEqual(formatSyncError({ file: 'templates', name: { id: 1 }, error: 'x' }), { label: 'templates ({"id":1})', msg: 'x' });
  assert.deepEqual(formatSyncError({ file: 'templates', name: null, error: 'x' }), { label: 'templates', msg: 'x' });
  assert.deepEqual(formatSyncError({ vectors: 'purge', error: 'timeout' }), { label: 'vectors purge', msg: 'timeout' });
  const html = renderStatusPanel({ sync: { ok: true, synced: [], errors: [{ file: 'templates', warning: 'more than 30 templates found' }] } });
  assert.ok(html.includes('⚠ templates: more than 30 templates found'), html);
  assert.ok(!html.includes('✗ templates'));
});

test('renderStatusPanel renders an in-progress status as "in progress", neutral colour', () => {
  for (const st of ['running', 'in-progress', 'in_progress']) {
    const html = renderStatusPanel({ statuses: [{ skill: 'of1-publish', status: st, summary: 'Publishing — checks pending' }] });
    assert.ok(html.includes('>in progress<'), html);
    assert.ok(html.includes('color:var(--dim);">in progress'), html);
    assert.ok(!html.includes('var(--orange);">in progress'));
  }
});

test('renderStatusPanel shows the phase on repeated skill rows', () => {
  const html = renderStatusPanel({
    statuses: [
      { skill: 'of1-build-templates', phase: 'base', status: 'done', summary: 'plan' },
      { skill: 'of1-build-templates', phase: 'intent-budget', status: 'done', summary: 'b' },
      { skill: 'of1-publish', status: 'done', summary: 'p' },
    ],
  });
  assert.ok(html.includes('of1-build-templates · base'));
  assert.ok(html.includes('of1-build-templates · intent-budget'));
  assert.ok(html.includes('>of1-publish<'));
});

test('buildHub carries the status-file phase into the panel', () => {
  const stateDir = tmpdir();
  const repoDir = tmpdir();
  fs.writeFileSync(path.join(stateDir, 'of1-build-templates-base-status.json'), JSON.stringify({ skill: 'of1-build-templates', phase: 'base', status: 'done', summary: 's' }));
  const html = buildHub({ repoConfig: { owner: 'o', repo: 'r', branch: 'b' }, domain: 'd', stateDir, repoDir, template: TEMPLATE });
  assert.ok(html.includes('of1-build-templates · base'));
});

test('CLI does not warn about missing discovery output when there are no prototypes', () => {
  const stateDir = tmpdir();
  const repoDir = tmpdir();
  fs.writeFileSync(path.join(stateDir, 'repo-config.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'b' }));
  let r = spawnSync(process.execPath, [SCRIPT, repoDir, 'example.com'], { env: { ...process.env, OF1_STATE_DIR: stateDir }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /of1-discovery-output\.md/);
  // With a prototype (full pipeline) the missing discovery output is worth a warning.
  fs.mkdirSync(path.join(repoDir, 'deliverables'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'deliverables', 'prototype-home.html'), '<html></html>');
  r = spawnSync(process.execPath, [SCRIPT, repoDir, 'example.com'], { env: { ...process.env, OF1_STATE_DIR: stateDir }, encoding: 'utf8' });
  assert.match(r.stderr, /of1-discovery-output\.md/);
});

test('renderStatusPanel escapes HTML and tolerates missing inputs', () => {
  const html = renderStatusPanel({
    statuses: [{ skill: '<b>x</b>', status: 'done', summary: '<script>' }],
    sync: null,
    status: null,
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(/not synced|no sync/i.test(html));
});

test('buildHub renders DA links + status panel from staged state, no legacy JSON links', () => {
  const stateDir = tmpdir();
  const repoDir = tmpdir();
  const hub = path.join(stateDir, 'hub');
  fs.mkdirSync(hub);
  fs.writeFileSync(path.join(hub, 'sync.json'), JSON.stringify({ ok: true, synced: ['config', 'templates'], errors: [], content: { indexed: 12 } }));
  fs.writeFileSync(path.join(hub, 'status.json'), JSON.stringify({ ready: true, config: { hasTemplates: true, hasContent: true } }));
  fs.writeFileSync(path.join(hub, 'da-templates.txt'), 'explore-hero\ncompare-grid\n');
  fs.writeFileSync(path.join(hub, 'da-pages.txt'), 'index.html\nnav.html\nabout.html\n');
  fs.writeFileSync(path.join(hub, 'da-knowledge.txt'), 'pricing\nfaq\n');
  fs.writeFileSync(path.join(stateDir, 'of1-extract-content-status.json'), JSON.stringify({ skill: 'of1-extract-content', status: 'done', summary: '9 pages' }));

  const html = buildHub({
    repoConfig: { owner: 'o', repo: 'r', branch: 'b' },
    domain: 'example.com',
    stateDir,
    repoDir,
    template: TEMPLATE,
  });

  assert.ok(!html.includes('of1/config/knowledge.json'));
  assert.ok(!html.includes('config-review.html'));
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), 'unreplaced placeholder');
  assert.ok(html.includes('https://da.live/edit#/o/r/templates/explore-hero'));
  assert.ok(html.includes('https://b--r--o.aem.page/about'));
  assert.ok(!html.includes('https://b--r--o.aem.page/nav"'));
  assert.ok(html.includes('https://da.live/edit#/o/r/of1/knowledge/pricing'));
  assert.ok(html.includes('indexed: 12'));
  assert.ok(html.includes('9 pages'));
  assert.ok(html.includes('https://da.live/sheet#/o/r/of1/config/personas'));
});

test('CLI writes deliverables/index.html via a symlinked path', () => {
  const stateDir = tmpdir();
  const repoDir = tmpdir();
  fs.writeFileSync(path.join(stateDir, 'repo-config.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'b' }));
  const linkDir = tmpdir();
  const link = path.join(linkDir, 'fill-demo-hub.mjs');
  fs.symlinkSync(SCRIPT, link);
  const r = spawnSync(process.execPath, [link, repoDir, 'example.com'], {
    env: { ...process.env, OF1_STATE_DIR: stateDir },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const out = fs.readFileSync(path.join(repoDir, 'deliverables', 'index.html'), 'utf8');
  assert.ok(out.includes('example.com'));
});

test('CLI fails without repo-config.json', () => {
  const stateDir = tmpdir();
  const repoDir = tmpdir();
  const r = spawnSync(process.execPath, [SCRIPT, repoDir, 'example.com'], {
    env: { ...process.env, OF1_STATE_DIR: stateDir },
    encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /repo-config\.json/);
});
