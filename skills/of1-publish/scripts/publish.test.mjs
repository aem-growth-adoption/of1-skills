import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, chmodSync, existsSync } from 'node:fs';
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
  */query-index.json) cat "$d/qi.json" 2>/dev/null || exit 22;;
  */api/generate) cat "$d/gen.ndjson" 2>/dev/null || exit 22;;
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

test('02b: index covers both -> unchanged, stale templates.names removed', () => {
  const f = fixture({ cfg: { domain: 'x.com', templates: { names: ['old'] } } });
  writeFileSync(join(f.fake, 'qi.json'), qi('/templates/a', '/of1/knowledge/k'));
  const r = f.run('02b-index-overrides.sh');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(f.cfgNow().templates, undefined);
  assert.match(r.stdout, /templates\(\/templates\)=true knowledge=true/);
});
test('02b: index lacks templates -> templates.names set sorted', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'qi.json'), qi('/of1/knowledge/k'));
  writeFileSync(join(f.fake, 'da-list.json'), docs('zeta', 'alpha'));
  const r = f.run('02b-index-overrides.sh');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(f.cfgNow().templates.names, ['alpha', 'zeta']);
});
test('02b: DA listing 403 -> exit 1 with token message', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'qi.json'), qi('/of1/knowledge/k'));
  writeFileSync(join(f.fake, 'da-code'), '403');
  const r = f.run('02b-index-overrides.sh');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DA token expired or lacks access/);
});
test('02b: daPath without slash -> warning, names untouched', () => {
  const f = fixture({ cfg: { domain: 'x.com', templates: { daPath: 'templates', names: ['keep'] } } });
  writeFileSync(join(f.fake, 'qi.json'), qi('/of1/knowledge/k'));
  const r = f.run('02b-index-overrides.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /no leading '\/'/);
  assert.deepEqual(f.cfgNow().templates.names, ['keep']);
});
test('02b: user-set indexPath untouched', () => {
  const f = fixture({ cfg: { domain: 'x.com', contentIngestion: { indexPath: '/query-index.json?limit=2000' } } });
  writeFileSync(join(f.fake, 'qi.json'), qi('/templates/a'));
  const r = f.run('02b-index-overrides.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.cfgNow().contentIngestion.indexPath, '/query-index.json?limit=2000');
  assert.match(r.stdout, /user-set/);
});

test('01: extra tracked file fails and is listed; config.json only passes', () => {
  const bad = fixture({ tracked: ['of1/config/config.json', 'of1/config/personas.json'] });
  const r = bad.run('01-assert-git-config.sh');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /of1\/config\/personas\.json/);
  const ok = fixture();
  const r2 = ok.run('01-assert-git-config.sh');
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(JSON.parse(readFileSync(join(ok.state, 'of1-publish-status.json'), 'utf8')).status, 'running');
});
test('01: cta-template.json required only with OF1_CTA_TEMPLATE=1', () => {
  const f = fixture();
  assert.equal(f.run('01-assert-git-config.sh').status, 0);
  const r = f.run('01-assert-git-config.sh', [], { OF1_CTA_TEMPLATE: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cta-template\.json missing/);
  const g = fixture({ tracked: ['of1/config/config.json', 'of1/config/cta-template.json'] });
  assert.equal(g.run('01-assert-git-config.sh', [], { OF1_CTA_TEMPLATE: '1' }).status, 0);
});

const hub = (f, name, o) => { mkdirSync(join(f.state, 'hub'), { recursive: true }); writeFileSync(join(f.state, 'hub', name), JSON.stringify(o)); };
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
  const f = fixture();
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
  assert.match(r.stdout, /Tenant: main--r--o/);
  const remote = sh(`git --git-dir=${f.base}/origin.git log --format=%s main`, f.repo).stdout;
  assert.ok((remote.match(/demo hub/g) || []).length >= 1);
});

test('bash -n on every script', () => {
  const scripts = readdirSync(here).filter((n) => n.endsWith('.sh'));
  assert.ok(scripts.length >= 12, scripts.join());
  for (const s of scripts) assert.equal(spawnSync('bash', ['-n', join(here, s)]).status, 0, s);
});
