import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = join(here, '..');
const publishScripts = join(skillDir, '..', 'of1-publish', 'scripts');
// Fake curl: logs every call; PUT body saved; statuses/plain body configurable via files.
const FAKE_CURL = `#!/bin/bash
url=""; method=GET; body=""; hasO=0
while [ $# -gt 0 ]; do case "$1" in -X) method="$2"; shift;; -d) body="$2"; shift;; -o) hasO=1; shift;; http*) url="$1";; esac; shift; done
d="$FAKE_DIR"; echo "$method $url" >> "$d/calls.log"
[ "$hasO" = 1 ] && { printf '%s' "$(cat "$d/sdk-code" 2>/dev/null || echo 200)"; exit 0; }
case "$method $url" in
  "PUT "*) printf '%s' "$body" > "$d/put-body"; printf 'resp\\n%s' "$(cat "$d/put-code" 2>/dev/null || echo 201)";;
  "POST "*) printf 'ok\\n200';;
  *plain.html) printf '%s\\n200' "$(cat "$d/plain" 2>/dev/null || echo '<div>engine</div>')";;
  *) exit 22;;
esac
`;
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-sty-')));
  const [state, repo, bin, fake] = ['state', 'repo', 'bin', 'fake'].map((d) => join(base, d));
  [state, repo, bin, fake].forEach((p) => mkdirSync(p));
  writeFileSync(join(state, 'repo-config.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', domain: 'x.com' }));
  writeFileSync(join(bin, 'curl'), FAKE_CURL); chmodSync(join(bin, 'curl'), 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: base, OF1_STATE_DIR: state, OF1_DEMO_REPO: repo,
    ADOBE_IMS_TOKEN: 't', FAKE_DIR: fake };
  const run = (script, args = [], more = {}) => spawnSync('bash', [script.includes('/') ? script : join(here, script), ...args],
    { encoding: 'utf8', env: { ...env, SKILL_DIR: skillDir, ...more } });
  return { base, state, repo, fake, run, env };
}

test('install-block: copies of1.js/of1.css fresh over stale ones', () => {
  const f = fixture();
  mkdirSync(join(f.repo, 'blocks/of1'), { recursive: true });
  writeFileSync(join(f.repo, 'blocks/of1/of1.js'), 'STALE'); writeFileSync(join(f.repo, 'blocks/of1/of1.css'), 'STALE');
  const r = f.run('install-block.sh');
  assert.equal(r.status, 0, r.stderr);
  for (const n of ['of1.js', 'of1.css'])
    assert.equal(readFileSync(join(f.repo, 'blocks/of1', n), 'utf8'), readFileSync(join(skillDir, 'assets', n), 'utf8'));
});

test('upload-of1-page: engine + escaped landing rows in PUT body', () => {
  const f = fixture();
  writeFileSync(join(f.state, 'of1-landing.json'), JSON.stringify({ title: 'Ask <b>&</b> more', subtitle: 'Sub', placeholder: 'Type…' }));
  const r = f.run('upload-of1-page.sh');
  assert.equal(r.status, 0, r.stderr);
  const body = readFileSync(join(f.fake, 'put-body'), 'utf8');
  assert.match(body, /<td><p>engine<\/p><\/td><td><p>da-blocks-slots<\/p><\/td>/);
  assert.match(body, /<td><p>title<\/p><\/td><td><p>Ask &lt;b&gt;&amp;&lt;\/b&gt; more<\/p><\/td>/);
  assert.match(body, /<p>subtitle<\/p>/);
  assert.match(body, /<p>placeholder<\/p>/);
  assert.match(body, /<td><p>domain<\/p><\/td><td><p>o\/r<\/p><\/td>/);
});

const apiEndpoint = (f) => readFileSync(join(f.fake, 'put-body'), 'utf8').match(/<p>api-endpoint<\/p><\/td><td><p>([^<]*)<\/p>/)?.[1];

test('upload-of1-page: api-endpoint is the proxied host (not gen-web) and the SDK is checked there', () => {
  const f = fixture();
  const r = f.run('upload-of1-page.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(apiEndpoint(f), 'https://main--r--o.of1.live');
  assert.match(readFileSync(join(f.fake, 'calls.log'), 'utf8'), /https:\/\/main--r--o\.of1\.live\/sdk\/of1-client\.js/);
  assert.doesNotMatch(readFileSync(join(f.fake, 'put-body'), 'utf8'), /workers\.dev/);
});

test('upload-of1-page: dev worker pairs with the --dev proxy host', () => {
  const f = fixture();
  assert.equal(f.run('upload-of1-page.sh', [], { OF1_GENWEB_URL: 'https://of1-gen-web-service-dev.franklin-prod.workers.dev' }).status, 0);
  assert.equal(apiEndpoint(f), 'https://main--r--o--dev.of1.live');
});

test('upload-of1-page: OF1_API_ENDPOINT overrides (e.g. a custom domain or gen-web)', () => {
  const f = fixture();
  assert.equal(f.run('upload-of1-page.sh', [], { OF1_API_ENDPOINT: 'https://of1.example.com' }).status, 0);
  assert.equal(apiEndpoint(f), 'https://of1.example.com');
});

test('upload-of1-page: rejects an unsafe OF1_API_ENDPOINT before writing anything', () => {
  for (const bad of ['http://x.com', 'https://x.com/path', 'https://x.com"><script>', 'javascript:alert(1)', 'https://x.com ']) {
    const f = fixture();
    const r = f.run('upload-of1-page.sh', [], { OF1_API_ENDPOINT: bad });
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /OF1_API_ENDPOINT/);
    assert.equal(existsSync(join(f.fake, 'put-body')), false, bad);
  }
});

test('upload-of1-page: exit 1 when the SDK is not served at the api-endpoint', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'sdk-code'), '404');
  const r = f.run('upload-of1-page.sh');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\/sdk\/of1-client\.js/);
  assert.match(r.stderr, /OF1_API_ENDPOINT/);
});

test('upload-of1-page: no landing rows when of1-landing.json absent', () => {
  const f = fixture();
  assert.equal(f.run('upload-of1-page.sh').status, 0);
  const body = readFileSync(join(f.fake, 'put-body'), 'utf8');
  assert.match(body, /engine/);
  assert.doesNotMatch(body, /<p>(title|subtitle|placeholder)<\/p>/);
});

test('upload-of1-page: exit 1 on PUT 500', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'put-code'), '500');
  const r = f.run('upload-of1-page.sh');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /PUT \/of1\.html returned HTTP 500/);
});

test('upload-of1-page: exit 1 when plain.html lacks engine', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'plain'), '<div>old page</div>');
  const r = f.run('upload-of1-page.sh');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no 'engine' row/);
});

test('of1-publish step 2 runs the upload script (stub curl, publish SKILL_DIR)', () => {
  const f = fixture();
  // publish common.sh needs a git repo for nothing here, only cd; token probe uses the fake curl (-o branch -> 200)
  const r = f.run(join(publishScripts, '02-refresh-of1-page.sh'), [], { SKILL_DIR: join(skillDir, '..', 'of1-publish') });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /DA PUT \/of1\.html/);
  assert.match(readFileSync(join(f.fake, 'put-body'), 'utf8'), /engine/);
  assert.match(readFileSync(join(f.fake, 'calls.log'), 'utf8'), /PUT https:\/\/admin\.da\.live\/source\/o\/r\/of1\.html/);
});

test('bash -n', () => {
  for (const s of ['common.sh', 'install-block.sh', 'upload-of1-page.sh', 'verify-live.sh', 'commit-block.sh'])
    assert.equal(spawnSync('bash', ['-n', join(here, s)]).status, 0, s);
});
