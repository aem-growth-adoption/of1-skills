import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = join(here, '..');
const sh = (cmd, cwd) => spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8' });
const FAKE_CURL = `#!/bin/bash
url=""; hasw=0; hasO=0
for a in "$@"; do case "$a" in http*) url="$a";; -w) hasw=1;; -o) hasO=1;; esac; done
d="$FAKE_DIR"
if [ "$hasO" = 1 ]; then printf 200; exit 0; fi
case "$url" in
  */list/o/r/templates) printf '%s\\n%s' "$(cat "$d/da-list.json")" "$(cat "$d/da-code")";;
  */of1/config/config.json) cat "$d/cfg-sheet.json" 2>/dev/null || exit 22;;
  */query-index.json) cat "$d/qi.json" 2>/dev/null || exit 22;;
  */api/generate) echo "$url" >> "$d/gen-urls.log"; cat "$d/gen.ndjson" 2>/dev/null || exit 22; [ "$hasw" = 1 ] && printf '\\n%s' "$(cat "$d/gen-code" 2>/dev/null || echo 200)";;
  */api/personalize) cat "$d/pers.ndjson" 2>/dev/null || exit 22; [ "$hasw" = 1 ] && printf '\\n200';;
  */sitemap.json) cat "$d/sitemap.json" 2>/dev/null || exit 22;;
  *) exit 22;;
esac
`;

function fixture({ cfg = { domain: 'x.com' }, tracked = ['of1/config/config.json'], env = {} } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-pub-')));
  const state = join(base, 'state'), repo = join(base, 'repo'), bin = join(base, 'bin'), fake = join(base, 'fake');
  [state, repo, bin, fake].forEach((p) => mkdirSync(p, { recursive: true }));
  writeFileSync(join(state, 'repo-config.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', domain: 'x.com' }));
  writeFileSync(join(bin, 'curl'), FAKE_CURL); chmodSync(join(bin, 'curl'), 0o755);
  writeFileSync(join(fake, 'da-code'), '200'); writeFileSync(join(fake, 'da-list.json'), '[]');
  sh(`git init -q --bare -b main ${base}/origin.git && git init -q -b main . && git config user.email a@b && git config user.name t && git remote add origin ${base}/origin.git`, repo);
  mkdirSync(join(repo, 'of1/config'), { recursive: true });
  for (const f of tracked) writeFileSync(join(repo, f), f.endsWith('config.json') && f.endsWith('of1/config/config.json') ? JSON.stringify(cfg) : '{}');
  sh('git add -A && git commit -qm init && git push -q origin main', repo);
  const run = (script, args = [], more = {}) => spawnSync('bash', [join(here, script), ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: base, OF1_STATE_DIR: state, OF1_DEMO_REPO: repo, ADOBE_IMS_TOKEN: 't',
      SKILL_DIR: skillDir, FAKE_DIR: fake, ...env, ...more },
  });
  const cfgNow = () => JSON.parse(readFileSync(join(repo, 'of1/config/config.json'), 'utf8'));
  return { base, state, repo, fake, run, cfgNow };
}
const docs = (...n) => JSON.stringify(n.map((name) => ({ name, ext: 'html' })));
const qi = (...p) => JSON.stringify({ data: p.map((path) => ({ path })) });

const sheet = (rows) => JSON.stringify({ data: Object.entries(rows).map(([key, value]) => ({ key, value })) });
const fakeWriter = (f) => {
  const w = join(f.base, 'daw.sh');
  writeFileSync(w, '#!/bin/bash\necho "$@" >> "$FAKE_DIR/daw.log"\nwhile [ $# -gt 0 ]; do [ "$1" = --rows ] && cp "$2" "$FAKE_DIR/rows-written.json"; shift; done\n');
  chmodSync(w, 0o755);
  return { OF1_DA_WRITE: w };
};
const dawFixture = (rows, qiPaths = []) => {
  const f = fixture({ tracked: [] });
  writeFileSync(join(f.fake, 'cfg-sheet.json'), sheet(rows));
  writeFileSync(join(f.fake, 'qi.json'), qi(...qiPaths));
  return f;
};
test('02b: sitemap fallback upserts indexPath through da-write sheet, nothing committed', () => {
  const f = dawFixture({ domain: 'x.com' }, ['/x']);
  writeFileSync(join(f.fake, 'sitemap.json'), qi('/of1/knowledge/k'));
  const r = f.run('02b-index-overrides.sh', [], fakeWriter(f));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(readFileSync(join(f.fake, 'daw.log'), 'utf8'), /sheet .*--path of1\/config\/config --columns key,value/);
  const rows = JSON.parse(readFileSync(join(f.fake, 'rows-written.json'), 'utf8'));
  assert.deepEqual(rows, [{ key: 'domain', value: 'x.com' }, { key: 'contentIngestion.indexPath', value: '/sitemap.json' }]);
  assert.equal(sh('git status --porcelain of1; git ls-files of1', f.repo).stdout.trim(), '');
});
test('02b: user-set indexPath untouched; no write', () => {
  const f = dawFixture({ domain: 'x.com', 'contentIngestion.indexPath': '/query-index.json?limit=2000' }, ['/templates/a']);
  const r = f.run('02b-index-overrides.sh', [], fakeWriter(f));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(f.fake, 'daw.log')));
  assert.match(r.stdout, /user-set/);
  assert.match(r.stdout, /unchanged/);
});
test('02b: non-sheet config fails with a hint', () => {
  const f = fixture({ tracked: [] });
  const r = f.run('02b-index-overrides.sh');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a config sheet/);
});

const hub = (f, name, o) => { mkdirSync(join(f.state, 'hub'), { recursive: true }); writeFileSync(join(f.state, 'hub', name), JSON.stringify(o)); };
test('01: any tracked of1/config file fails and is listed; none passes', () => {
  const bad = fixture();
  const r = bad.run('01-assert-git-config.sh');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /of1\/config\/config\.json/);
  assert.match(r.stderr, /of1-migrate/);
  const ok = fixture({ tracked: [] });
  const r2 = ok.run('01-assert-git-config.sh');
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(JSON.parse(readFileSync(join(ok.state, 'of1-publish-status.json'), 'utf8')).status, 'running');
});
test('check 7: reads hasCtaTemplate from hub/status.json', () => {
  const f = fixture();
  hub(f, 'status.json', { ready: true, config: { hasCtaTemplate: false } });
  const r = f.run('checks.sh', ['7'], { OF1_CTA_TEMPLATE: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /hasCtaTemplate/);
  hub(f, 'status.json', { ready: true, config: { hasCtaTemplate: true } });
  writeFileSync(join(f.fake, 'pers.ndjson'), '{"type":"inject_cta"}\n');
  const ok = f.run('checks.sh', ['7'], { OF1_CTA_TEMPLATE: '1' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /inject_cta/);
});
test('check 7: missing hub/status.json fails', () => {
  const f = fixture();
  const r = f.run('checks.sh', ['7'], { OF1_CTA_TEMPLATE: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /hasCtaTemplate/);
});

test('checks 2: indexed 0 fails; warning-only errors pass', () => {
  const f = fixture();
  hub(f, 'sync.json', { ok: true, errors: [], content: { indexed: 0 } });
  let r = f.run('checks.sh', ['2']);
  assert.equal(r.status, 1); assert.match(r.stderr, /content\.indexed = 0/);
  hub(f, 'sync.json', { ok: true, errors: [{ file: 'templates', warning: 'truncated' }], content: { indexed: 3 } });
  r = f.run('checks.sh', ['2']);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /3 chunk/);
  hub(f, 'sync.json', { ok: true, errors: [{ file: 'brand-voice', error: 'empty document' }], content: { indexed: 3 } });
  assert.equal(f.run('checks.sh', ['2']).status, 1);
});
const pubSync = (f, o) => { hub(f, 'sync-preview.json', { ok: true, errors: [], content: { indexed: 3 } }); hub(f, 'sync-publish.json', o); };
test('check 2: publish sync with only 404 warnings/empty passes; 502 error and 401 fail', () => {
  const f = fixture({ tracked: [] });
  pubSync(f, { ok: true, synced: [], errors: [{ file: 'query-index', warning: '404 not published' }], content: null });
  let r = f.run('checks.sh', ['2']);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /publish sync ok/);
  pubSync(f, { ok: true, synced: [], errors: [{ file: 'brand-voice', error: 'HTTP 502' }], content: null });
  r = f.run('checks.sh', ['2']);
  assert.equal(r.status, 1); assert.match(r.stderr, /publish sync errors/);
  pubSync(f, { ok: false, error: 'sync rejected (HTTP 401)' });
  assert.equal(f.run('checks.sh', ['2']).status, 1);
  hub(f, 'sync-preview.json', { ok: true, errors: [], content: { indexed: 0 } });
  hub(f, 'sync-publish.json', { ok: true, errors: [], content: null });
  assert.equal(f.run('checks.sh', ['2']).status, 1);
});
test('04b: publishes sheets + pages only with OF1_PUBLISH_LIVE=1 via 04-sync', () => {
  const f = syncFixture('200', '{"ok":true,"synced":[],"errors":[],"content":null}');
  const w = fakeWriter(f);
  let r = f.run('04-sync.sh', [], w);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(f.fake, 'daw.log')), 'live must not be called');
  for (const n of ['sync-preview.json', 'sync-publish.json', 'sync.json']) assert.ok(existsSync(join(f.state, 'hub', n)), n);
  const argv = readFileSync(join(f.fake, 'sync-argv.log'), 'utf8');
  assert.match(argv, /sync\?stage=preview/); assert.match(argv, /sync\?stage=publish/);
  r = f.run('04-sync.sh', [], { ...w, OF1_PUBLISH_LIVE: '1' });
  assert.equal(r.status, 0, r.stderr);
});
test('checks 3: not ready names gated flag; ready passes', () => {
  const f = fixture();
  hub(f, 'status.json', { ready: false, config: { hasTemplates: false, hasContent: true, hasBrandVoice: false } });
  let r = f.run('checks.sh', ['3']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /hasTemplates/); assert.doesNotMatch(r.stderr, /hasBrandVoice/);
  hub(f, 'status.json', { ready: true, config: { hasTemplates: true, hasContent: true, hasBrandVoice: false } });
  r = f.run('checks.sh', ['3']);
  assert.equal(r.status, 0); assert.match(r.stdout, /tenant ready/);
});

const PW = `#!/bin/bash
printf '### Result\\nstub\\n### Ran\\n'
`;
test('checks 4: ends with REVIEW line; all does not claim check 4 passed', () => {
  const f = fixture({ tracked: [] });
  writeFileSync(join(f.base, 'bin', 'playwright-cli'), PW); chmodSync(join(f.base, 'bin', 'playwright-cli'), 0o755);
  let r = f.run('checks.sh', ['4'], { OF1_STATE_DIR: f.state });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').pop(), 'REVIEW check 4 output above: any HEADER/FOOTER/OF1 BLOCK MISSING, TITLE MISSING or chips: 0 is a failure');
  hub(f, 'sync.json', { ok: true, errors: [], content: { indexed: 3 } });
  hub(f, 'status.json', { ready: true, config: {} });
  writeFileSync(join(f.fake, 'gen.ndjson'), '{"type":"section"}\n{"type":"section"}\n');
  r = f.run('checks.sh', ['all']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /checks 1-3,5-6 passed; check 4 needs your review/);
  assert.doesNotMatch(r.stdout, /all \d checks passed/);
  writeFileSync(join(f.fake, 'gen.ndjson'), '');
  assert.equal(f.run('checks.sh', ['all']).status, 1);
});
const withHub = (f) => {
  hub(f, 'sync.json', { ok: true, errors: [], content: { indexed: 3 } });
  hub(f, 'status.json', { ready: true, config: {} });
};
test('08-publish-hub: hub committed and pushed before checks; second run no-op', () => {
  const f = fixture(); withHub(f);
  assert.equal(f.run('07-hub.sh').status, 0);
  assert.ok(existsSync(join(f.repo, 'deliverables/index.html')));
  let r = f.run('08-publish-hub.sh');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const remote = (c) => sh(`git --git-dir=${f.base}/origin.git ${c}`, f.repo).stdout.trim();
  assert.equal(remote('ls-tree -r --name-only main | grep deliverables/index.html'), 'deliverables/index.html');
  assert.match(remote('log -1 --format=%s main'), /OF1 demo hub for x\.com/);
  const head = remote('rev-parse main');
  r = f.run('08-publish-hub.sh');
  assert.equal(r.status, 0); assert.match(r.stdout, /hub unchanged/);
  assert.equal(remote('rev-parse main'), head);
});
test('finish.sh: final status, hub re-committed, prints values to copy', () => {
  const f = fixture(); withHub(f);
  assert.equal(f.run('08-publish-hub.sh').status, 0);
  const r = f.run('finish.sh', ['done']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DOMAIN: x\.com/);
  assert.match(r.stdout, /Demo hub: https:\/\/main--r--o\.aem\.page\/deliverables\/index\.html/);
  assert.match(r.stdout, /OF1 page: https:\/\/main--r--o\.aem\.page\/of1/);
  assert.match(r.stdout, /DA config: https:\/\/da\.live\/#\/o\/r\/of1/);
  assert.match(r.stdout, /Tenant: o\/r/);
  const remote = sh(`git --git-dir=${f.base}/origin.git log --format=%s main`, f.repo).stdout;
  assert.ok((remote.match(/demo hub/g) || []).length >= 1);
});

test('bash -n on every script', () => {
  const scripts = readdirSync(here).filter((n) => n.endsWith('.sh'));
  assert.ok(scripts.length >= 12, scripts.join());
  for (const s of scripts) assert.equal(spawnSync('bash', ['-n', join(here, s)]).status, 0, s);
});

const SYNC_CURL = `#!/bin/bash
d="$FAKE_DIR"
echo "$@" >> "$d/sync-argv.log"
case "$*" in *-K\\ -*) cat > "$d/sync-stdin.log";; esac
case "$*" in *-o\\ *) printf 200; exit 0;; esac
case "$*" in *"/sync"*) cat "$d/sync-body" ; printf '\\n%s' "$(cat "$d/sync-code")";; *) exit 22;; esac
`;
const syncFixture = (code, body, env = {}) => {
  const f = fixture({ env });
  writeFileSync(join(f.base, 'bin', 'curl'), SYNC_CURL); chmodSync(join(f.base, 'bin', 'curl'), 0o755);
  writeFileSync(join(f.fake, 'sync-code'), code); writeFileSync(join(f.fake, 'sync-body'), body);
  return f;
};
const SECRET = 'SECRET-DA-TOKEN-123';
test('04-sync: DA token sent as Authorization header via stdin config, not argv, not in hub', () => {
  const f = syncFixture('200', '{"ok":true,"synced":["config"],"errors":[],"content":{"indexed":3}}', { ADOBE_IMS_TOKEN: SECRET });
  const r = f.run('04-sync.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(f.fake, 'sync-stdin.log'), 'utf8'), /Authorization: Bearer SECRET-DA-TOKEN-123/);
  const argv = readFileSync(join(f.fake, 'sync-argv.log'), 'utf8'); // includes the DA probe call
  assert.doesNotMatch(argv, new RegExp(SECRET));
  assert.match(argv, /tenants\/o\/r\/sync\?stage=preview(\s|$)/);
  assert.doesNotMatch(argv, /ref=/);
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET));
  const out = readFileSync(join(f.state, 'hub', 'sync.json'), 'utf8');
  assert.doesNotMatch(out, new RegExp(SECRET));
  assert.equal(JSON.parse(out).ok, true);
});
test('04-sync: 401 gives explicit message and valid JSON ok:false', () => {
  const f = syncFixture('401', '{"error":"Unauthorized"}', { ADOBE_IMS_TOKEN: SECRET });
  const r = f.run('04-sync.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /sync rejected \(HTTP 401\): DA token invalid or lacks access to o\/r, or worker not configured/);
  const j = JSON.parse(readFileSync(join(f.state, 'hub', 'sync.json'), 'utf8'));
  assert.equal(j.ok, false);
  assert.equal(f.run('checks.sh', ['2']).status, 1);
});
test('of1_sync: missing token -> ok:false "no DA token", valid JSON, no request', () => {
  const f = syncFixture('200', '{}');
  const out = join(f.base, 'o.json');
  const r = spawnSync('bash', ['-c', `. ${skillDir}/../../lib/genweb.sh; unset DA_TOKEN; of1_sync https://w main--r--o ${out}`], { encoding: 'utf8', env: { PATH: `${join(f.base, 'bin')}:${process.env.PATH}`, FAKE_DIR: f.fake } });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /no DA token/);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { ok: false, error: 'no DA token' });
  assert.ok(!existsSync(join(f.fake, 'sync-argv.log')));
});
test('da_resolve_token honours DA_TOKEN first', () => {
  const r = spawnSync('bash', ['-c', `. ${skillDir}/../../lib/da-token.sh; da_resolve_token`], { encoding: 'utf8', env: { PATH: process.env.PATH, DA_TOKEN: 'a', ADOBE_IMS_TOKEN: 'b' } });
  assert.equal(r.stdout.trim(), 'a');
});
test('check 6: uses proxied tenant host; OF1_GENERATE_BASE_URL overrides', () => {
  const f = fixture(); withHub(f);
  writeFileSync(join(f.fake, 'gen.ndjson'), '{"type":"section"}\n{"type":"section"}\n');
  const r = f.run('checks.sh', ['6']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(f.fake, 'gen-urls.log'), 'utf8').trim(), 'https://prev--main--r--o.of1.live/api/generate\nhttps://main--r--o.of1.live/api/generate');
  f.run('checks.sh', ['6'], { OF1_GENERATE_BASE_URL: 'https://dev.example' });
  assert.match(readFileSync(join(f.fake, 'gen-urls.log'), 'utf8'), /https:\/\/dev\.example\/api\/generate/);
});
const pageSection = (blocks) => JSON.stringify({ type: 'section', format: 'html', index: 0, html: Array.from({ length: blocks }, (_, i) => `<div class="b${i}"><div><div>x</div></div></div>`).join('') });
test('check 6: one section carrying a whole page (>=2 blocks) passes — the da-blocks-slots engine emits a single section', () => {
  const f = fixture(); withHub(f);
  writeFileSync(join(f.fake, 'gen.ndjson'), `${pageSection(4)}\n{"type":"done"}\n`);
  const r = f.run('checks.sh', ['6']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /generation returned 1 section with 4 blocks/);
});
test('check 6: a single thin section (<2 blocks) or no section still fails', () => {
  const f = fixture(); withHub(f);
  writeFileSync(join(f.fake, 'gen.ndjson'), `${pageSection(1)}\n`);
  let r = f.run('checks.sh', ['6']);
  assert.equal(r.status, 1); assert.match(r.stderr, /FAIL \(check 6\).*expected >=2 sections or 1 section with >=2 blocks/);
  writeFileSync(join(f.fake, 'gen.ndjson'), '{"type":"done"}\n');
  r = f.run('checks.sh', ['6']);
  assert.equal(r.status, 1); assert.match(r.stderr, /returned 0 sections/);
});
test('check 6: proxy 401/404 fail with explanation; HTML or unreachable only warns', () => {
  const f = fixture(); withHub(f);
  writeFileSync(join(f.fake, 'gen.ndjson'), '{"error":"x"}');
  for (const c of ['401', '404']) {
    writeFileSync(join(f.fake, 'gen-code'), c);
    const r = f.run('checks.sh', ['6']);
    assert.equal(r.status, 1); assert.match(r.stderr, new RegExp(`HTTP ${c}.*edge proxy`));
    assert.match(r.stderr, /prev--main--r--o/);
  }
  writeFileSync(join(f.fake, 'gen-code'), '200');
  writeFileSync(join(f.fake, 'gen.ndjson'), '<!DOCTYPE html><html></html>');
  let r = f.run('checks.sh', ['6']);
  assert.equal(r.status, 0); assert.match(r.stderr, /WARN \(check 6\).*NOT run/);
  rmSync(join(f.fake, 'gen.ndjson'));
  r = f.run('checks.sh', ['6']);
  assert.equal(r.status, 0); assert.match(r.stderr, /WARN \(check 6\)/);
});

const LIVE_CURL = `#!/bin/bash
d="$FAKE_DIR"; url=""
for a in "$@"; do case "$a" in http*) url="$a";; esac; done
echo "$url" >> "$d/live-urls.log"
case "$*" in *-K\\ -*) cat > /dev/null;; esac
case "$url" in
  */list/o/r/of1/knowledge) cat "$d/list-knowledge.json";;
  */list/o/r/templates) cat "$d/list-templates.json";;
  */list/o/r) echo '[]';;
  */source/o/r/*) k=$(echo "\${url##*/source/o/r/}" | tr '/' '_'); if [ -f "$d/probe-$k" ]; then printf '%s' "$(cat "$d/probe-$k")"; else printf 404; fi;;
  *) exit 22;;
esac
`;
const liveFixture = (probes = {}) => {
  const f = fixture({ tracked: [] });
  writeFileSync(join(f.base, 'bin', 'curl'), LIVE_CURL); chmodSync(join(f.base, 'bin', 'curl'), 0o755);
  writeFileSync(join(f.fake, 'list-knowledge.json'), docs('k1')); writeFileSync(join(f.fake, 'list-templates.json'), docs('t1'));
  for (const [k, v] of Object.entries(probes)) writeFileSync(join(f.fake, `probe-${k}`), v);
  const w = join(f.base, 'daw.sh');
  writeFileSync(w, '#!/bin/bash\necho "$@" >> "$FAKE_DIR/daw.log"\ncase "$*" in *FAILME*) exit 1;; esac\n'); chmodSync(w, 0o755);
  return { ...f, env: { OF1_DA_WRITE: w } };
};
test('04b: publishes present sheets/pages (200), skips 404, summary written', () => {
  const f = liveFixture({ 'of1_config_config.json': '200', 'of1.html': '200' });
  const r = f.run('04b-publish-live.sh', [], f.env);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const log = readFileSync(join(f.fake, 'daw.log'), 'utf8').trim().split('\n');
  assert.ok(log.some((l) => /live .*--path of1\/config\/config\.json$/.test(l)));
  assert.ok(log.some((l) => /live .*--path of1$/.test(l)));
  assert.ok(log.some((l) => /--path of1\/knowledge\/k1$/.test(l)) && log.some((l) => /--path templates\/t1$/.test(l)));
  assert.ok(!log.some((l) => /cta-template/.test(l)));
  assert.deepEqual(JSON.parse(readFileSync(join(f.state, 'hub/publish-live.json'), 'utf8')), { ok: true, published: 4, failed: [] });
});
test('04b: 401 probe and a failed publish are counted, exit non-zero, check 2 fails on them', () => {
  const f = liveFixture({ 'of1_config_config.json': '401', 'of1.html': '200' });
  writeFileSync(join(f.fake, 'list-knowledge.json'), docs('FAILME'));
  const r = f.run('04b-publish-live.sh', [], f.env);
  assert.equal(r.status, 1);
  const j = JSON.parse(readFileSync(join(f.state, 'hub/publish-live.json'), 'utf8'));
  assert.equal(j.ok, false); assert.equal(j.failed.length, 2);
  assert.match(j.failed.join('\n'), /of1\/config\/config\.json: probe HTTP 401/); assert.match(j.failed.join('\n'), /FAILME/);
  pubSync(f, { ok: true, synced: [], errors: [], content: null });
  const c = f.run('checks.sh', ['2']);
  assert.equal(c.status, 1); assert.match(c.stderr, /publish live failed/);
});
test('04-sync with OF1_PUBLISH_LIVE=1: preview sync -> 04b -> publish sync, still syncs after 04b failure', () => {
  const f = syncFixture('200', '{"ok":true,"synced":[],"errors":[],"content":null}');
  const w = join(f.base, 'daw.sh');
  writeFileSync(w, '#!/bin/bash\necho "live $*" >> "$FAKE_DIR/order.log"\nexit 1\n'); chmodSync(w, 0o755);
  writeFileSync(join(f.base, 'bin', 'curl'), SYNC_CURL.replace('case "$*" in *-o\\ *) printf 200; exit 0;; esac', 'case "$*" in *"/sync"*) echo "$*" | grep -o "stage=[a-z]*" >> "$d/order.log";; esac\ncase "$*" in *-o\\ *) printf 200; exit 0;; esac'));
  const r = f.run('04-sync.sh', [], { OF1_DA_WRITE: w, OF1_PUBLISH_LIVE: '1' });
  assert.equal(r.status, 0, r.stderr);
  const order = readFileSync(join(f.fake, 'order.log'), 'utf8').trim().split('\n');
  const first = order.findIndex((l) => l === 'stage=preview'), live = order.findIndex((l) => l.startsWith('live ')), pub = order.findIndex((l) => l === 'stage=publish');
  assert.ok(first >= 0 && live > first && pub > live, order.join('|'));
  assert.equal(JSON.parse(readFileSync(join(f.state, 'hub/publish-live.json'), 'utf8')).ok, false);
});
test('check 6: live-host 404 is strict when the publish sync synced something, warning when unpublished', () => {
  const f = fixture({ tracked: [] }); withHub(f);
  writeFileSync(join(f.base, 'bin', 'curl'), FAKE_CURL.replace('*/api/generate) echo "$url" >> "$d/gen-urls.log";', '*/api/generate) echo "$url" >> "$d/gen-urls.log"; case "$url" in https://prev--*) ;; *) printf "x\\n404"; exit 0;; esac;'));
  writeFileSync(join(f.fake, 'gen.ndjson'), '{"type":"section"}\n{"type":"section"}\n');
  writeFileSync(join(f.fake, 'gen-code'), '200');
  hub(f, 'sync-publish.json', { ok: true, synced: [], errors: [], content: null });
  let r = f.run('checks.sh', ['6']);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stderr, /not live yet/);
  hub(f, 'sync-publish.json', { ok: true, synced: [], errors: [], content: { indexed: 0 } });
  r = f.run('checks.sh', ['6']);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stderr, /not live yet/);
  hub(f, 'sync-publish.json', { ok: true, synced: ['config'], errors: [], content: { indexed: 2 } });
  r = f.run('checks.sh', ['6']);
  assert.equal(r.status, 1); assert.match(r.stderr, /HTTP 404/);
});
test('of1_sync: sends no ref even when BRANCH is set', () => {
  const f = syncFixture('200', '{"ok":true}');
  const out = join(f.base, 'o.json');
  spawnSync('bash', ['-c', `. ${skillDir}/../../lib/genweb.sh; DA_TOKEN=t BRANCH='feat/x y' of1_sync https://w o/r ${out} publish`], { encoding: 'utf8', env: { PATH: `${join(f.base, 'bin')}:${process.env.PATH}`, FAKE_DIR: f.fake } });
  assert.match(readFileSync(join(f.fake, 'sync-argv.log'), 'utf8'), /sync\?stage=publish(\s|$)/);
  assert.doesNotMatch(readFileSync(join(f.fake, 'sync-argv.log'), 'utf8'), /ref=/);
});

test('mixed-case org/repo: sync URL path keeps original case, bodies use the lowercase id', () => {
  const f = fixture({ tracked: [] });
  writeFileSync(join(f.state, 'repo-config.json'), JSON.stringify({ owner: 'AdobeDocs', repo: 'Site', branch: 'main', domain: 'x.com' }));
  writeFileSync(join(f.base, 'bin', 'curl'), `#!/bin/bash
echo "$@" >> "$FAKE_DIR/all-argv.log"
case "$*" in *-K\\ -*) cat > /dev/null;; esac
case "$*" in *"/sync"*) printf '{"ok":true,"synced":[],"errors":[],"content":null}\\n200'; exit 0;; esac
case "$*" in *"/api/generate"*) printf '{"type":"section"}\\n{"type":"section"}\\n200'; exit 0;; esac
case "$*" in *-o\\ *) printf 200; exit 0;; esac
exit 22
`); chmodSync(join(f.base, 'bin', 'curl'), 0o755);
  mkdirSync(join(f.state, 'hub'), { recursive: true });
  assert.equal(f.run('04-sync.sh').status, 0);
  const r = f.run('checks.sh', ['6']);
  assert.equal(r.status, 0, r.stderr);
  const argv = readFileSync(join(f.fake, 'all-argv.log'), 'utf8');
  assert.match(argv, /tenants\/AdobeDocs\/Site\/sync\?stage=preview/);
  assert.doesNotMatch(argv, /tenants\/adobedocs\/site\/sync/);
  assert.match(argv, /"id":"adobedocs\/site"/);
  assert.match(argv, /prev--main--site--adobedocs\.of1\.live/);
});
test('409 (legacy gen-web data): publish 04-sync stops with the admin message, check 2 names legacy-tenant-present', () => {
  const f = syncFixture('409', '{"error":"Tenant not migrated"}');
  const r = f.run('04-sync.sh');
  assert.equal(r.status, 3);
  assert.match(r.stderr, /Legacy gen-web data exists for o\/r\. An admin must either delete the legacy tenant \(DELETE \/api\/admin\/tenants\/<legacy id>\).*migrate-tenants\?tenant=o\/r/);
  const j = JSON.parse(readFileSync(join(f.state, 'hub', 'sync-publish.json'), 'utf8'));
  assert.equal(j.code, 'legacy-tenant-present');
  hub(f, 'sync-preview.json', { ok: true, errors: [], content: { indexed: 3 } });
  const c = f.run('checks.sh', ['2']);
  assert.equal(c.status, 1); assert.match(c.stderr, /legacy-tenant-present/);
});
test('of1_sync: token outside the allowed charset is refused, never sent', () => {
  const f = syncFixture('200', '{"ok":true}');
  const out = join(f.base, 'o.json');
  spawnSync('bash', ['-c', `. ${skillDir}/../../lib/genweb.sh; DA_TOKEN='bad token"' of1_sync https://w o/r ${out}`], { encoding: 'utf8', env: { PATH: `${join(f.base, 'bin')}:${process.env.PATH}`, FAKE_DIR: f.fake } });
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).ok, false);
  assert.ok(!existsSync(join(f.fake, 'sync-argv.log')));
});

test('off main: publish stops with the main-branch message', () => {
  const f = fixture();
  sh('git checkout -qb feat', f.repo);
  const r = f.run('01-assert-git-config.sh');
  assert.equal(r.status, 1); assert.match(r.stderr, /OF1 setup runs from the main branch \(checkout main\)/);
});
