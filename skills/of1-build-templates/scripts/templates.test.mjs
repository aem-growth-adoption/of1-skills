import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = join(here, '..');
const sh = (cmd, cwd) => spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8' });
const FAKE_CURL = `#!/bin/bash
url=""; method=GET; hasO=0
while [ $# -gt 0 ]; do case "$1" in -X) method="$2"; shift;; -o) hasO=1;; http*) url="$1";; esac; shift; done
d="$FAKE_DIR"; echo "$method $url" >> "$d/calls.log"
if [ "$hasO" = 1 ]; then case "$url" in */blocks/*) [ -f "$d/live" ] && { printf 200; exit 0; } || { printf 404; exit 22; };; *) printf 200; exit 0;; esac; fi
case "$method $url" in
  "POST https://admin.hlx.page/"*) printf 'ok\\n%s' "$(cat "$d/preview-code" 2>/dev/null || echo 200)";;
  *admin.da.live/list/*) cat "$d/list.json";;
  *.plain.html) f="$d/$(basename "$url")"; [ -f "$f" ] && cat "$f" || exit 22;;
  *) exit 22;;
esac
`;
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-tpl-')));
  const [state, repo, bin, fake] = ['state', 'repo', 'bin', 'fake'].map((d) => join(base, d));
  [state, repo, bin, fake].forEach((p) => mkdirSync(p));
  writeFileSync(join(state, 'repo-config.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', domain: 'x.com' }));
  writeFileSync(join(bin, 'curl'), FAKE_CURL); chmodSync(join(bin, 'curl'), 0o755);
  writeFileSync(join(fake, 'list.json'), JSON.stringify([{ path: '/o/r/templates/a.html', ext: 'html' }]));
  sh(`git init -q --bare -b main ${base}/origin.git && git init -q -b main . && git config user.email a@b && git config user.name t && git remote add origin ${base}/origin.git && git commit -q --allow-empty -m init && git push -q origin main`, repo);
  const run = (script, args = [], more = {}) => spawnSync('bash', [join(here, script), ...args], { encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: base, OF1_STATE_DIR: state, OF1_DEMO_REPO: repo, ADOBE_IMS_TOKEN: 't',
      SKILL_DIR: skillDir, FAKE_DIR: fake, ...more } });
  return { fake, repo, run };
}
const doc = (n, max) => '<div>' + Array.from({ length: n }, () => '<div class="cards"></div>').join('')
  + (max ? `<div class="section-metadata"><div><div>Template Max Items</div><div>${max}</div></div></div>` : '') + '</div>';

test('preview-all: POSTs preview for each template doc', () => {
  const f = fixture();
  const r = f.run('preview-all.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(f.fake, 'calls.log'), 'utf8'), /POST https:\/\/admin\.hlx\.page\/preview\/o\/r\/main\/templates\/a/);
});
test('preview-all: aborts on preview 403 and on empty listing', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'preview-code'), '403');
  const r = f.run('preview-all.sh');
  assert.equal(r.status, 1); assert.match(r.stderr, /preview failed for templates\/a/);
  writeFileSync(join(f.fake, 'list.json'), '[]');
  const r2 = f.run('preview-all.sh');
  assert.equal(r2.status, 1); assert.match(r2.stderr, /no \/templates docs listed/);
});
test('verify-richness: warns for exploratory doc with 2 blocks', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'a.plain.html'), doc(2, 4));
  const r = f.run('verify-richness.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARN: exploratory templates\/a \(Max Items 4\) has only 2/);
});
test('verify-richness: quick answer with 2 blocks passes silently; 0 blocks aborts', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'a.plain.html'), doc(2, 2));
  const r = f.run('verify-richness.sh');
  assert.equal(r.status, 0); assert.doesNotMatch(r.stderr, /WARN/);
  writeFileSync(join(f.fake, 'a.plain.html'), doc(0, 4));
  const r2 = f.run('verify-richness.sh');
  assert.equal(r2.status, 1); assert.match(r2.stderr, /0 content blocks/);
});
test('commit-block-code: commits, pushes, waits for code sync', () => {
  const f = fixture();
  mkdirSync(join(f.repo, 'blocks/pc'), { recursive: true });
  writeFileSync(join(f.repo, 'blocks/pc/pc.js'), 'x');
  writeFileSync(join(f.fake, 'live'), '');
  const r = f.run('commit-block-code.sh', ['pc'], { OF1_CODESYNC_SLEEP: '0' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(sh('git log --oneline -1', f.repo).stdout, /pc block/);
  assert.equal(sh('git status -sb', f.repo).stdout.includes('ahead'), false);
});
test('commit-block-code: fails when code never goes live', () => {
  const f = fixture();
  mkdirSync(join(f.repo, 'blocks/pc'), { recursive: true });
  writeFileSync(join(f.repo, 'blocks/pc/pc.js'), 'x');
  const r = f.run('commit-block-code.sh', ['pc'], { OF1_CODESYNC_SLEEP: '0', OF1_CODESYNC_TRIES: '2' });
  assert.equal(r.status, 1); assert.match(r.stderr, /not live/);
});
test('bash -n', () => {
  for (const s of ['common.sh', 'preview-all.sh', 'verify-richness.sh', 'commit-block-code.sh'])
    assert.equal(spawnSync('bash', ['-n', join(here, s)]).status, 0, s);
});
