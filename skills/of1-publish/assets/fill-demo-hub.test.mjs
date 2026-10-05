import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderConfigLinks, renderStatusPanel, buildHub } from './fill-demo-hub.mjs';

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
