import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = join(here, '..');
const REAL_NODE = process.execPath;
const FAKE_CURL = `#!/bin/bash
url=""; hasO=0
for a in "$@"; do case "$a" in http*) url="$a";; -o) hasO=1;; esac; done
d="$FAKE_DIR"
if [ "$hasO" = 1 ]; then printf 200; exit 0; fi
case "$url" in
  */sitemap.json) cat "$d/sitemap.json" 2>/dev/null || exit 22;;
  */nav.plain.html) cat "$d/nav.html" 2>/dev/null || exit 22;;
  *) exit 22;;
esac
`;
// fake playwright-cli: logs calls; eval returns the next capture line from captures.txt
const FAKE_PW = `#!/bin/bash
d="$FAKE_DIR"
echo "$1 $2" >> "$d/pw.log"
case "$1" in
  tab-list) printf -- '- 0: (current) [A]\\n- 1: [B]\\n';;
  eval) n=$(cat "$d/n" 2>/dev/null || echo 0); echo $((n+1)) > "$d/n"
        printf '### Result\\n%s\\n### Ran\\n' "$(sed -n "$((n+1))p" "$d/captures.txt")";;
esac
exit 0
`;
// stub node: real node for -e (env loader); otherwise log the asset name
const FAKE_NODE = `#!/bin/bash
if [ "$1" = -e ]; then exec ${REAL_NODE} "$@"; fi
echo "$(basename "$1")" >> "$FAKE_DIR/node.log"
case "$1" in *build-image-manifest.mjs) echo '[]' > /tmp/knowledge-image-manifest.json;; esac
exit 0
`;
function fixture(env = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-ext-')));
  const state = join(base, 'state'), repo = join(base, 'repo'), bin = join(base, 'bin'), fake = join(base, 'fake');
  [state, repo, bin, fake].forEach((p) => mkdirSync(p, { recursive: true }));
  writeFileSync(join(state, 'repo-config.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', domain: 'x.com' }));
  for (const [n, c] of [['curl', FAKE_CURL], ['playwright-cli', FAKE_PW], ['sleep', '#!/bin/bash\nexit 0\n']]) {
    writeFileSync(join(bin, n), c); chmodSync(join(bin, n), 0o755);
  }
  const mkenv = (more) => ({ PATH: `${bin}:${process.env.PATH}`, HOME: base, OF1_STATE_DIR: state, OF1_DEMO_REPO: repo,
    ADOBE_IMS_TOKEN: 't', SKILL_DIR: skillDir, FAKE_DIR: fake, ...env, ...more });
  const run = (script, args = [], more = {}) =>
    spawnSync('bash', [join(here, script), ...args], { encoding: 'utf8', env: mkenv(more) });
  const source = (more) =>
    spawnSync('bash', ['-c', `. "${here}/common.sh" && echo "$SOURCE_BASE"`], { encoding: 'utf8', env: mkenv(more) });
  return { base, bin, state, repo, fake, run, source };
}

test('common.sh: SOURCE_BASE from OF1_CONTENT_SOURCE else preview host', () => {
  const f = fixture();
  assert.match(f.source({}).stdout, /^https:\/\/main--r--o\.aem\.page$/m);
  assert.match(f.source({ OF1_CONTENT_SOURCE: 'frescopa.coffee' }).stdout, /^https:\/\/frescopa\.coffee$/m);
});

test('discover-urls: sitemap, excludes, home first, cap 20', () => {
  const f = fixture();
  const paths = ['/drafts/a', '/fragments/b', '/of1/c', '/templates/d', '/nav', '/footer', '/about',
    ...Array.from({ length: 30 }, (_, i) => `/p${i}`)];
  writeFileSync(join(f.fake, 'sitemap.json'), JSON.stringify({ data: paths.map((path) => ({ path })) }));
  const r = f.run('discover-urls.sh');
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').filter((l) => l.startsWith('https://main'));
  assert.equal(lines[0], 'https://main--r--o.aem.page/');
  assert.equal(lines.length, 21);
  assert.ok(!lines.some((l) => /\/(drafts|fragments|of1|templates|nav|footer)(\/|$)/.test(l)));
  assert.ok(lines.includes('https://main--r--o.aem.page/about'));
  assert.equal(readFileSync(join(f.state, 'product-urls.txt'), 'utf8').trim().split('\n').length, 21);
});

test('discover-urls: falls back to nav, no duplicate home', () => {
  const f = fixture({ OF1_CONTENT_SOURCE: 'ex.com' });
  writeFileSync(join(f.fake, 'nav.html'), '<a href="/">h</a><a href="/a">a</a><a href="/b?x=1">b</a><a href="/c#f">c</a><a href="https://o.com/z">z</a>');
  const r = f.run('discover-urls.sh');
  const lines = r.stdout.trim().split('\n').filter((l) => l.startsWith('https://ex.com'));
  assert.equal(lines[0], 'https://ex.com/');
  assert.equal(lines.filter((l) => l === 'https://ex.com/').length, 1);
  assert.ok(lines.includes('https://ex.com/a'));
});

test('capture-pages: open/tab-new batching, jq append, skips empty', () => {
  const f = fixture();
  const cap = (u, n) => JSON.stringify({ url: u, title: 't', blocks: Array(n).fill({ tag: 'p', text: 'x' }) });
  // 6 URLs -> batches of 5 + 1; fake tab-list yields 2 tabs per batch -> 4 evals
  writeFileSync(join(f.fake, 'captures.txt'),
    [cap('u1', 1), cap('u2', 0), cap('u3', 2), JSON.stringify(cap('u4', 1))].join('\n'));
  writeFileSync(join(f.state, 'knowledge-pages.json'), '["stale"]');
  const urls = Array.from({ length: 6 }, (_, i) => `https://s/${i}`);
  const r = f.run('capture-pages.sh', urls);
  assert.equal(r.status, 0, r.stderr);
  const log = readFileSync(join(f.fake, 'pw.log'), 'utf8').trim().split('\n');
  assert.equal(log.filter((l) => l.startsWith('open ')).length, 2);
  assert.equal(log.filter((l) => l.startsWith('tab-new ')).length, 4);
  assert.equal(log.filter((l) => l.startsWith('close')).length, 2);
  assert.equal(log[0], 'open https://s/0');
  assert.ok(log.includes('open https://s/5'));
  const pages = JSON.parse(readFileSync(join(f.state, 'knowledge-pages.json'), 'utf8'));
  assert.deepEqual(pages.map((p) => p.url), ['u1', 'u3', 'u4']);
  assert.match(r.stdout, /captured 3 page\(s\)/);
  assert.match(r.stderr, /WARN: no content captured/);
});

test('capture-pages: reads product-urls.txt when no args', () => {
  const f = fixture();
  writeFileSync(join(f.state, 'product-urls.txt'), 'https://s/a\n');
  writeFileSync(join(f.fake, 'captures.txt'), JSON.stringify({ url: 'a', title: '', blocks: [{ tag: 'p', text: 'x' }] }));
  const r = f.run('capture-pages.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(readFileSync(join(f.state, 'knowledge-pages.json'), 'utf8')).length, 1);
});

test('publish-knowledge: manifest, skips download when empty, then publish', () => {
  const f = fixture();
  writeFileSync(join(f.bin, 'node'), FAKE_NODE); chmodSync(join(f.bin, 'node'), 0o755);
  const r = f.run('publish-knowledge.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(join(f.fake, 'node.log'), 'utf8').trim().split('\n'),
    ['build-image-manifest.mjs', 'publish-knowledge-da.mjs']);
});

test('bash -n all scripts', () => {
  for (const s of ['common.sh', 'discover-urls.sh', 'capture-pages.sh', 'publish-knowledge.sh']) {
    assert.equal(spawnSync('bash', ['-n', join(here, s)]).status, 0, s);
  }
});
