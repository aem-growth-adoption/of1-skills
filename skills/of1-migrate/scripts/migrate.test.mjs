import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = join(here, '..');
const sh = (cmd, cwd) => spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8' });
const FAKE_CURL = `#!/bin/bash
d="$FAKE_DIR"; url=""; hasw=0
for a in "$@"; do case "$a" in http*) url="$a";; -w) hasw=1;; esac; done
echo "$url" >> "$d/urls.log"
case "$*" in *"-o /dev/null"*) printf 200; exit 0;; esac
case "$url" in
  */sync\\?*) cat > /dev/null; case "$url" in *stage=publish*) f=sync-publish;; *) f=sync-preview;; esac
     cat "$d/$f.body"; printf '\\n%s' "$(cat "$d/$f.code" 2>/dev/null || echo 200)";;
  */status\\?*) cat "$d/status.json";;
  */of1/config/*.json) n=$(basename "$url" .json); [ -f "$d/rows-$n.json" ] || exit 22; jq '{data: .}' "$d/rows-$n.json";;
  */api/generate) cat "$d/gen.ndjson"; [ "$hasw" = 1 ] && printf '\\n200';;
  *) exit 22;;
esac
`;
const OK_SYNC = '{"ok":true,"synced":["config"],"errors":[],"content":{"indexed":3}}';
const PUB_SYNC = '{"ok":true,"synced":[],"errors":[],"content":null}';

function fixture({ extra = {}, legacy = true, cfg = { domain: 'x.com', contentIngestion: { indexPath: '/sitemap.json' } } } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-mig-')));
  const state = join(base, 'state'), repo = join(base, 'o-r'), bin = join(base, 'bin'), fake = join(base, 'fake');
  [state, repo, bin, fake].forEach((p) => mkdirSync(p, { recursive: true }));
  writeFileSync(join(bin, 'curl'), FAKE_CURL); chmodSync(join(bin, 'curl'), 0o755);
  const w = join(base, 'daw.sh');
  writeFileSync(w, '#!/bin/bash\necho "$@" >> "$FAKE_DIR/daw.log"\nwhile [ $# -gt 0 ]; do case "$1" in --path) n=$(basename "$2");; --rows) cp "$2" "$FAKE_DIR/rows-$n.json";; esac; shift; done\n');
  chmodSync(w, 0o755);
  writeFileSync(join(fake, 'sync-preview.body'), OK_SYNC);
  writeFileSync(join(fake, 'sync-publish.body'), PUB_SYNC);
  writeFileSync(join(fake, 'status.json'), '{"ready":true,"config":{"hasTemplates":true,"hasContent":true}}');
  writeFileSync(join(fake, 'gen.ndjson'), '{"type":"section"}\n{"type":"section"}\n');
  sh(`git init -q --bare -b main ${base}/origin.git && git init -q -b main . && git config user.email a@b && git config user.name t && git remote add origin ${base}/origin.git`, repo);
  writeFileSync(join(state, 'repo-config.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', domain: 'x.com' }));
  if (legacy) {
    mkdirSync(join(repo, 'of1/config'), { recursive: true });
    writeFileSync(join(repo, 'of1/config/config.json'), JSON.stringify(cfg));
    writeFileSync(join(repo, 'of1/config/cta-template.json'), JSON.stringify({ html: '<p>x</p>', fallback: { title: 't', description: 'd', buttonText: 'b' } }));
    for (const [n, c] of Object.entries(extra)) writeFileSync(join(repo, 'of1/config', n), c);
  } else writeFileSync(join(repo, 'README.md'), 'x');
  sh('git add -A && git commit -qm init && git push -q origin main', repo);
  const run = (script, more = {}) => spawnSync('bash', [join(here, script)], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: base, OF1_STATE_DIR: state, OF1_DEMO_REPO: repo, ADOBE_IMS_TOKEN: 't',
      SKILL_DIR: skillDir, FAKE_DIR: fake, OF1_DA_WRITE: w, ...more },
  });
  const result = () => JSON.parse(readFileSync(join(state, 'of1-migrate-result.json'), 'utf8'));
  const tracked = () => sh('git ls-files of1/config', repo).stdout.trim();
  const full = () => { for (const s of ['01-detect.sh', '02-config-to-da.sh', '04-sync.sh', '05-verify.sh', '03-remove-git-config.sh']) { const r = run(s); if (process.env.MIG_DEBUG) console.error(new Date().toISOString(), s, r.status, r.stderr.slice(0, 400)); if (r.status !== 0) break; if (s === '01-detect.sh' && existsSync(join(state, 'of1-migrate-result.json')) && result().status === 'already-new') break; } return run('06-report.sh'); };
  return { base, state, repo, fake, run, result, tracked, full };
}

test('legacy repo: sheets written, both syncs without ref, git config removed last, migrated', () => {
  const f = fixture();
  const r = f.full();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const res = f.result();
  assert.equal(res.status, 'migrated'); assert.equal(res.tenant, 'o/r'); assert.ok(!('ref' in res));
  assert.deepEqual(res.checks, { 2: true, 3: true, 6: true });
  const daw = readFileSync(join(f.fake, 'daw.log'), 'utf8');
  assert.match(daw, /--path of1\/config\/config /); assert.match(daw, /--path of1\/config\/cta-template /);
  assert.deepEqual(JSON.parse(readFileSync(join(f.fake, 'rows-config.json'), 'utf8')), [{ key: 'domain', value: 'x.com' }, { key: 'contentIngestion.indexPath', value: '/sitemap.json' }]);
  const urls = readFileSync(join(f.fake, 'urls.log'), 'utf8');
  assert.match(urls, /tenants\/o\/r\/sync\?stage=preview$/m); assert.match(urls, /tenants\/o\/r\/sync\?stage=publish$/m); assert.doesNotMatch(urls, /ref=/);
  assert.equal(f.tracked(), '');
  assert.match(sh(`git --git-dir=${f.base}/origin.git log -1 --format=%s main`, f.repo).stdout, /move OF1 config to DA/);
});
test('already-new repo: no writes, no syncs', () => {
  const f = fixture({ legacy: false });
  const r = f.run('01-detect.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.result().status, 'already-new');
  assert.ok(!existsSync(join(f.fake, 'daw.log')));
  assert.equal(f.full().status, 0);
  assert.ok(!existsSync(join(f.fake, 'daw.log'))); assert.ok(!/sync/.test(existsSync(join(f.fake, 'urls.log')) ? readFileSync(join(f.fake, 'urls.log'), 'utf8').replace(/admin\.da\.live[^\n]*/g, '') : ''));
});
test('failing sync: failed, git config stays, repeat succeeds', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'sync-preview.body'), '{"ok":true,"errors":[{"file":"brand-voice","error":"HTTP 502"}],"content":{"indexed":3}}');
  const r = f.full();
  assert.equal(r.status, 1);
  assert.equal(f.result().status, 'failed');
  assert.ok(f.result().errors.length > 0);
  assert.match(f.tracked(), /of1\/config\/config\.json/);
  writeFileSync(join(f.fake, 'sync-preview.body'), OK_SYNC);
  const again = f.full();
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(f.result().status, 'migrated'); assert.equal(f.tracked(), '');
});
test('failing check 3 (not ready): failed, config stays; 03 refuses without verification', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'status.json'), '{"ready":false,"config":{"hasTemplates":false}}');
  assert.equal(f.full().status, 1);
  assert.equal(f.result().status, 'failed'); assert.equal(f.result().checks['3'], false);
  assert.match(f.tracked(), /config\.json/);
  const direct = f.run('03-remove-git-config.sh');
  assert.equal(direct.status, 1); assert.match(direct.stderr, /refusing/);
});
test('batch dry-run lists repos without writes', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-batch-')));
  const mk = (name, legacy) => {
    const d = join(base, 'orgs', `${name}.git`); mkdirSync(d, { recursive: true });
    sh(`git init -q -b main . && git config user.email a@b && git config user.name t && ${legacy ? 'mkdir -p of1/config && echo {} > of1/config/config.json' : 'echo x > a'} && git add -A && git commit -qm i`, d);
  };
  mk('old', true); mk('new', false);
  writeFileSync(join(base, 'repos.txt'), 'old\nnew\n');
  const r = spawnSync('node', [join(skillDir, 'assets/batch.mjs'), '--org', 'acme', '--repos', join(base, 'repos.txt')], { encoding: 'utf8', env: { ...process.env, OF1_BATCH_CLONE_BASE: join(base, 'orgs'), ADOBE_IMS_TOKEN: 'SECRET-TOK' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /acme\/old\twould-migrate/); assert.match(r.stdout, /acme\/new\talready-new/);
  assert.match(r.stdout, /summary \(dry-run\): would-migrate=1 already-new=1/);
  assert.ok(!(r.stdout + r.stderr).includes('SECRET-TOK'));
  assert.ok(sh('git ls-files of1/config', join(base, 'orgs', 'old.git')).stdout.includes('of1/config/config.json'));
});
const DIRS = ['01-detect.sh', '02-config-to-da.sh'];
test('push rejected: local removal undone, remote still legacy, re-run is not already-new', () => {
  const f = fixture();
  writeFileSync(join(f.base, 'origin.git/hooks/pre-receive'), '#!/bin/sh\necho rejected >&2\nexit 1\n'); chmodSync(join(f.base, 'origin.git/hooks/pre-receive'), 0o755);
  assert.equal(f.full().status, 1);
  assert.equal(f.result().status, 'failed');
  assert.match(f.tracked(), /of1\/config\/config\.json/);
  assert.equal(sh('git log --format=%s -1', f.repo).stdout.trim(), 'init');
  assert.ok(f.result().errors.some((e) => e.step === '03'));
  assert.equal(f.run('01-detect.sh').status, 0);
  assert.ok(!existsSync(join(f.state, 'of1-migrate-result.json')));
});
test('01 treats config still on origin/<branch> as legacy; warns on untracked of1/config', () => {
  const f = fixture();
  sh('git rm -rq of1/config && git commit -qm local-only', f.repo); // local removal, remote still has it
  mkdirSync(join(f.repo, 'of1/config'), { recursive: true }); writeFileSync(join(f.repo, 'of1/config/stray.json'), '{}');
  const r = f.run('01-detect.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /untracked files under of1\/config/);
  assert.match(r.stdout, /legacy setup found/);
  assert.ok(!existsSync(join(f.state, 'of1-migrate-result.json')));
});
test('detached HEAD fails early', () => {
  const f = fixture();
  sh('git checkout -q --detach', f.repo);
  const r = f.run('01-detect.sh');
  assert.equal(r.status, 1); assert.match(r.stderr, /detached HEAD/);
});
test('02: list keys comma-joined, nested config written losslessly', () => {
  const f = fixture({ cfg: { domain: 'x.com', templates: { names: ['a', 'b'] }, contentIngestion: { includePaths: ['/x/**', '/y'], indexPath: '/s.json' }, flag: true, n: 3 } });
  assert.equal(f.run('01-detect.sh').status, 0);
  const r = f.run('02-config-to-da.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(f.fake, 'rows-config.json'), 'utf8')), [
    { key: 'domain', value: 'x.com' }, { key: 'templates.names', value: 'a,b' },
    { key: 'contentIngestion.includePaths', value: '/x/**,/y' }, { key: 'contentIngestion.indexPath', value: '/s.json' },
    { key: 'flag', value: 'true' }, { key: 'n', value: '3' }]);
});
for (const [name, cfg, key] of [
  ['other array', { domain: 'x.com', tags: ['a'] }, 'tags'],
  ['null', { domain: 'x.com', gone: null }, 'gone'],
  ['empty object', { domain: 'x.com', o: {} }, 'o'],
  ['numeric string', { domain: 'x.com', code: '123' }, 'code'],
  ['boolean string', { domain: 'x.com', flag: 'true' }, 'flag'],
  ['dotted key', { domain: 'x.com', 'a.b': 'x' }, 'a.b'],
  ['list key with comma item', { domain: 'x.com', templates: { names: ['a,b'] } }, 'templates.names'],
]) {
  test(`02: lossy shape rejected (${name}), nothing written`, () => {
    const f = fixture({ cfg });
    f.run('01-detect.sh');
    const r = f.run('02-config-to-da.sh');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(key), r.stderr);
    assert.ok(!existsSync(join(f.fake, 'daw.log')));
  });
}
const fakeGh = (base, out) => { mkdirSync(join(base, 'ghbin'), { recursive: true }); writeFileSync(join(base, 'ghbin/gh'), `#!/bin/bash\necho "$@" > ${base}/gh.args\nprintf '${out}'\n`); chmodSync(join(base, 'ghbin/gh'), 0o755); };
const batchEnv = (base, extra = {}) => ({ ...process.env, PATH: `${join(base, 'ghbin')}:${process.env.PATH}`, OF1_BATCH_CLONE_BASE: join(base, 'orgs'), ...extra });
test('batch --repos auto excludes forks/archived, prints the list; --no-dry-run needs --yes', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-batch-')));
  const d = join(base, 'orgs', 'a.git'); mkdirSync(d, { recursive: true });
  sh('git init -q -b main . && git config user.email a@b && git config user.name t && echo x > a && git add -A && git commit -qm i', d);
  fakeGh(base, 'a\n');
  const bin = join(skillDir, 'assets/batch.mjs');
  let r = spawnSync('node', [bin, '--org', 'acme', '--repos', 'auto'], { encoding: 'utf8', env: batchEnv(base) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /resolved repos \(1, forks and archived excluded\): a/);
  const args = readFileSync(join(base, 'gh.args'), 'utf8');
  assert.match(args, /--no-archived/); assert.match(args, /isFork/);
  r = spawnSync('node', [bin, '--org', 'acme', '--repos', 'auto', '--no-dry-run'], { encoding: 'utf8', env: batchEnv(base) });
  assert.equal(r.status, 2); assert.match(r.stderr, /needs --yes/);
});
test('batch --no-dry-run migrates, keeps per-repo result with errors in --out', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-batch-')));
  const f = fixture({ legacy: false });
  const d = join(base, 'orgs', 'old.git'); mkdirSync(d, { recursive: true });
  sh(`git init -q -b main . && git config user.email a@b && git config user.name t && mkdir -p of1/config && echo '{"domain":"x.com","gone":null}' > of1/config/config.json && git add -A && git commit -qm i`, d);
  writeFileSync(join(base, 'repos.txt'), 'old\n');
  const out = join(base, 'out');
  const r = spawnSync('node', [join(skillDir, 'assets/batch.mjs'), '--org', 'acme', '--repos', join(base, 'repos.txt'), '--no-dry-run', '--out', out],
    { encoding: 'utf8', env: batchEnv(base, { PATH: `${join(f.base, 'bin')}:${process.env.PATH}`, ADOBE_IMS_TOKEN: 't', OF1_DA_WRITE: join(f.base, 'daw.sh'), FAKE_DIR: f.fake, SKILL_DIR: skillDir }) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /acme\/old\tfailed/);
  assert.match(r.stdout, /02: .*gone/);
  const j = JSON.parse(readFileSync(join(out, 'old.json'), 'utf8'));
  assert.equal(j.status, 'failed'); assert.ok(j.errors.length > 0);
});
test('push rejected: uncommitted edit to an unrelated tracked file survives the rollback', () => {
  const f = fixture();
  writeFileSync(join(f.repo, 'keep.txt'), 'v1'); sh('git add keep.txt && git commit -qm keep && git push -q origin main', f.repo);
  writeFileSync(join(f.base, 'origin.git/hooks/pre-receive'), '#!/bin/sh\nexit 1\n'); chmodSync(join(f.base, 'origin.git/hooks/pre-receive'), 0o755);
  for (const s of ['01-detect.sh', '02-config-to-da.sh', '04-sync.sh', '05-verify.sh']) assert.equal(f.run(s).status, 0, s);
  writeFileSync(join(f.repo, 'keep.txt'), 'LOCAL WORK');
  const r = f.run('03-remove-git-config.sh');
  assert.equal(r.status, 1);
  assert.equal(readFileSync(join(f.repo, 'keep.txt'), 'utf8'), 'LOCAL WORK');
  assert.match(f.tracked(), /of1\/config\/config\.json/);
  assert.ok(!existsSync(join(f.state, 'migrate-removed')));
});
test('03: no migrate-removed marker when local is behind origin (config gone locally, still on origin)', () => {
  const f = fixture();
  for (const s of ['01-detect.sh', '02-config-to-da.sh', '04-sync.sh', '05-verify.sh']) assert.equal(f.run(s).status, 0, s);
  sh('git rm -rq of1/config && git commit -qm local-only', f.repo);
  const r = f.run('03-remove-git-config.sh');
  assert.equal(r.status, 1); assert.match(r.stderr, /pull first/);
  assert.ok(!existsSync(join(f.state, 'migrate-removed')));
});
test('409 legacy gen-web tenant: failed with code legacy-tenant-present, git config kept, repeatable', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'sync-publish.body'), '{"error":"Tenant not migrated"}'); writeFileSync(join(f.fake, 'sync-publish.code'), '409');
  assert.equal(f.full().status, 1);
  const res = f.result();
  assert.equal(res.status, 'failed');
  assert.ok(res.errors.some((e) => e.code === 'legacy-tenant-present' && /Legacy gen-web data exists for o\/r\. Ask the OF1 team to clear or migrate it, then re-run\./.test(e.error)));
  assert.match(f.tracked(), /of1\/config\/config\.json/);
  writeFileSync(join(f.fake, 'sync-publish.body'), PUB_SYNC); writeFileSync(join(f.fake, 'sync-publish.code'), '200');
  assert.equal(f.full().status, 0);
  assert.equal(f.result().status, 'migrated');
});
test('02 reads cta-template.json from origin when only origin has it', () => {
  const f = fixture();
  sh('git rm -rq of1/config && git commit -qm local-only', f.repo);
  assert.equal(f.run('01-detect.sh').status, 0);
  const r = f.run('02-config-to-da.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(f.fake, 'daw.log'), 'utf8'), /of1\/config\/cta-template/);
  assert.deepEqual(JSON.parse(readFileSync(join(f.fake, 'rows-cta-template.json'), 'utf8')).map((x) => x.key), ['html', 'fallback.title', 'fallback.description', 'fallback.buttonText']);
});
const verified = (f) => { for (const s of ['01-detect.sh', '02-config-to-da.sh', '04-sync.sh', '05-verify.sh']) assert.equal(f.run(s).status, 0, s); };
const hook = (f, body) => { const h = join(f.base, 'origin.git/hooks/pre-receive'); writeFileSync(h, `#!/bin/sh\n${body}\nexit 1\n`); chmodSync(h, 0o755); };
test('rollback: reset --keep refusal falls back to restoring only of1/config, local work survives', () => {
  const f = fixture();
  writeFileSync(join(f.repo, 'keep.txt'), 'v1'); sh('git add keep.txt && git commit -qm keep && git push -q origin main', f.repo);
  hook(f, `mkdir -p ${f.repo}/of1/config; echo '{"local":1}' > ${f.repo}/of1/config/config.json`);
  verified(f);
  writeFileSync(join(f.repo, 'keep.txt'), 'LOCAL WORK');
  const r = f.run('03-remove-git-config.sh');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /could not drop the local commit/);
  assert.equal(readFileSync(join(f.repo, 'keep.txt'), 'utf8'), 'LOCAL WORK');
  assert.match(f.tracked(), /of1\/config\/config\.json/);
});
test('rollback: HEAD moved during the failed push -> migration commit is reverted by subject', () => {
  const f = fixture();
  hook(f, `unset GIT_DIR GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES; git -C ${f.repo} -c user.email=a@b -c user.name=t commit -q --allow-empty -m moved`);
  verified(f);
  const r = f.run('03-remove-git-config.sh');
  assert.equal(r.status, 1);
  assert.match(f.tracked(), /of1\/config\/config\.json/);
  assert.match(sh('git log --format=%s -3', f.repo).stdout, /Revert "chore: move OF1 config to DA/);
});
test('batch: always clones the default branch; no --branch option', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-batch-')));
  const d = join(base, 'orgs', 'site.git'); mkdirSync(d, { recursive: true });
  sh(`git init -q -b main . && git config user.email a@b && git config user.name t && echo x > a && git add -A && git commit -qm i && git checkout -qb dev && mkdir -p of1/config && echo {} > of1/config/config.json && git add -A && git commit -qm legacy && git checkout -q main`, d);
  const bin = join(skillDir, 'assets/batch.mjs');
  writeFileSync(join(base, 'repos.txt'), 'site\n');
  let r = spawnSync('node', [bin, '--org', 'acme', '--repos', join(base, 'repos.txt')], { encoding: 'utf8', env: { ...process.env, OF1_BATCH_CLONE_BASE: join(base, 'orgs') } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /acme\/site\talready-new/);
  r = spawnSync('node', [bin, '--org', 'acme', '--repos', join(base, 'repos.txt'), '--branch', 'dev'], { encoding: 'utf8', env: { ...process.env, OF1_BATCH_CLONE_BASE: join(base, 'orgs') } });
  assert.equal(r.status, 2); assert.match(r.stderr, /Unknown argument: --branch/);
  fakeGh(base, 'site\n');
  r = spawnSync('node', [bin, '--org', 'acme', '--repos', 'auto'], { encoding: 'utf8', env: batchEnv(base) });
  assert.match(r.stdout, /note: only each default branch is examined; repos are expected to have OF1 on main/);
});
test('off main: stops with the main-branch message; detached HEAD keeps its own guard', () => {
  const f = fixture();
  sh('git checkout -qb feat', f.repo);
  const r = f.run('01-detect.sh');
  assert.equal(r.status, 1); assert.match(r.stderr, /OF1 setup runs from the main branch \(checkout main\)/);
  sh('git checkout -q --detach', f.repo);
  assert.match(f.run('01-detect.sh').stderr, /detached HEAD/);
});
test('bash -n on every migrate script', () => {
  for (const s of ['common', '01-detect', '02-config-to-da', '03-remove-git-config', '04-sync', '05-verify', '06-report'])
    assert.equal(spawnSync('bash', ['-n', join(here, `${s}.sh`)]).status, 0, s);
});

const SIGNALS = [{ param: 'utm_x', value: 'a', source: 'ai', context: 'ctx' }];
const LLMQ = [{ url: '/a', questions: ['q1', 'q2'] }];
const CEP = { endpoints: [{ name: 'acct', url: 'https://e.example/a', inputs: [{ name: 'id', from: 'account.accountId', required: true }], output: { fields: { f: 'd' } } }] };
const EXTRA = { 'signals.json': JSON.stringify(SIGNALS), 'llmquestions.json': JSON.stringify(LLMQ), 'context-endpoints.json': JSON.stringify(CEP), 'brand-voice.json': '{}' };
const ALL = ['of1/config/brand-voice.json', 'of1/config/config.json', 'of1/config/context-endpoints.json', 'of1/config/cta-template.json', 'of1/config/llmquestions.json', 'of1/config/signals.json'];
const KEPT = ['of1/config/brand-voice.json'];
const rowsOf = (f, n) => JSON.parse(readFileSync(join(f.fake, `rows-${n}.json`), 'utf8'));
test('five files converted and removed, brand-voice kept; sheets written with exact columns; result lists both', () => {
  const f = fixture({ extra: EXTRA });
  const det = f.run('01-detect.sh');
  assert.match(det.stdout, /convert\s+of1\/config\/signals\.json/); assert.match(det.stdout, /keep\s+of1\/config\/brand-voice\.json/);
  const r = f.full();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(f.tracked().split('\n'), KEPT);
  const res = f.result();
  assert.equal(res.status, 'migrated'); assert.deepEqual(res.keptInGit, KEPT);
  assert.deepEqual(res.converted, ['of1/config/config.json', 'of1/config/cta-template.json', 'of1/config/signals.json', 'of1/config/llmquestions.json', 'of1/config/context-endpoints.json']);
  assert.equal(res.warnings.length, 1); assert.match(res.warnings[0], /brand-voice\.json.*no longer reads.*deleted by hand/);
  const daw = readFileSync(join(f.fake, 'daw.log'), 'utf8');
  assert.match(daw, /--path of1\/config\/signals --columns param,value,source,context /);
  assert.match(daw, /--path of1\/config\/llmquestions --columns url,question /);
  assert.match(daw, /--path of1\/config\/context-endpoints --columns name,description,url,method,timeoutMs,inputs,outputDescription,outputFields /);
  assert.deepEqual(rowsOf(f, 'signals'), [{ param: 'utm_x', value: 'a', source: 'ai', context: 'ctx' }]);
  assert.deepEqual(rowsOf(f, 'llmquestions'), [{ url: '/a', question: 'q1' }, { url: '/a', question: 'q2' }]);
  assert.equal(rowsOf(f, 'context-endpoints')[0].inputs, 'id=account.accountId*');
  assert.equal(sh(`git --git-dir=${f.base}/origin.git ls-tree -r --name-only main of1/config`, f.repo).stdout.trim(), 'of1/config/brand-voice.json');
});
test('re-run after migration with only kept files is already-new', () => {
  const f = fixture({ extra: EXTRA });
  assert.equal(f.full().status, 0);
  assert.equal(f.run('01-detect.sh').status, 0);
  const res = f.result();
  assert.equal(res.status, 'already-new'); assert.deepEqual(res.keptInGit, KEPT); assert.deepEqual(res.converted, []);
  assert.equal(f.full().status, 0);
});
test('rejected push restores only the removed files; kept file untouched', () => {
  const f = fixture({ extra: EXTRA });
  hook(f, 'echo rejected >&2');
  assert.equal(f.full().status, 1);
  assert.deepEqual(f.tracked().split('\n'), ALL);
  assert.equal(sh('git log --format=%s -1', f.repo).stdout.trim(), 'init');
  assert.equal(sh('git status --porcelain', f.repo).stdout.trim(), '');
});
test('05: a converted sheet that does not serve the written rows fails verification, nothing removed', () => {
  const f = fixture({ extra: EXTRA });
  for (const s of ['01-detect.sh', '02-config-to-da.sh', '04-sync.sh']) assert.equal(f.run(s).status, 0, s);
  writeFileSync(join(f.fake, 'rows-signals.json'), '[]');
  const r = f.run('05-verify.sh');
  assert.equal(r.status, 1); assert.match(r.stderr, /signals/);
  assert.equal(f.run('03-remove-git-config.sh').status, 1);
  assert.deepEqual(f.tracked().split('\n'), ALL);
});
test('02 reads signals/llmquestions/context-endpoints from origin when only origin has them', () => {
  const f = fixture({ extra: EXTRA });
  sh('git rm -rq of1/config && git commit -qm local-only', f.repo);
  assert.equal(f.run('01-detect.sh').status, 0);
  const r = f.run('02-config-to-da.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(rowsOf(f, 'signals')[0].param, 'utm_x'); assert.equal(rowsOf(f, 'llmquestions').length, 2);
});
for (const [file, content, needle] of [
  ['signals.json', [{ param: 'p' }], 'signals.json[0].value'],
  ['signals.json', {}, 'signals.json'],
  ['llmquestions.json', [{ url: '/a', questions: [] }], 'llmquestions.json[0].questions'],
  ['context-endpoints.json', { endpoints: [{ name: 'a', url: 'u' }, { name: 'b', url: 'u' }, { name: 'c', url: 'u' }] }, 'more than 2'],
  ['context-endpoints.json', { endpoints: [{ name: 'a', url: 'u', inputs: [{ name: 'x', from: 'cookie.s' }] }] }, 'endpoints[0].inputs[0].from'],
  ['context-endpoints.json', { endpoints: [{ name: 'a', url: 'u', output: { fields: { f: 'a; b' } } }] }, 'output.fields.f'],
]) {
  test(`02: unrepresentable ${file} refused (${needle}), nothing written`, () => {
    const f = fixture({ extra: { [file]: JSON.stringify(content) } });
    f.run('01-detect.sh');
    const r = f.run('02-config-to-da.sh');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(needle), r.stderr);
    assert.ok(r.stderr.includes(file), r.stderr);
    assert.ok(!existsSync(join(f.fake, 'daw.log')));
  });
}
test('02: invalid JSON in signals.json is refused', () => {
  const f = fixture({ extra: { 'signals.json': '{nope' } });
  f.run('01-detect.sh');
  const r = f.run('02-config-to-da.sh');
  assert.equal(r.status, 1); assert.match(r.stderr, /signals\.json/); assert.ok(!existsSync(join(f.fake, 'daw.log')));
});
test('batch dry-run: lists converted sheets-to-be and the kept file', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-batch-')));
  const d = join(base, 'orgs', 's.git'); mkdirSync(d, { recursive: true });
  sh('git init -q -b main . && git config user.email a@b && git config user.name t && mkdir -p of1/config && echo [] > of1/config/signals.json && echo [] > of1/config/llmquestions.json && echo {} > of1/config/context-endpoints.json && echo {} > of1/config/brand-voice.json && git add -A && git commit -qm i', d);
  writeFileSync(join(base, 'repos.txt'), 's\n');
  const r = spawnSync('node', [join(skillDir, 'assets/batch.mjs'), '--org', 'acme', '--repos', join(base, 'repos.txt')], { encoding: 'utf8', env: { ...process.env, OF1_BATCH_CLONE_BASE: join(base, 'orgs') } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /acme\/s\twould-migrate\tconvert=3\tkeptInGit=1/);
  assert.match(r.stdout, /summary \(dry-run\): would-migrate=1 keptInGit=1/);
});
test('batch dry-run: kept-only repo is already-new and prints keptInGit count', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-batch-')));
  const d = join(base, 'orgs', 'k.git'); mkdirSync(d, { recursive: true });
  sh('git init -q -b main . && git config user.email a@b && git config user.name t && mkdir -p of1/config && echo {} > of1/config/brand-voice.json && git add -A && git commit -qm i', d);
  writeFileSync(join(base, 'repos.txt'), 'k\n');
  const r = spawnSync('node', [join(skillDir, 'assets/batch.mjs'), '--org', 'acme', '--repos', join(base, 'repos.txt')], { encoding: 'utf8', env: { ...process.env, OF1_BATCH_CLONE_BASE: join(base, 'orgs') } });
  assert.match(r.stdout, /acme\/k\talready-new\tkeptInGit=1/); assert.match(r.stdout, /keptInGit=1$/m);
});
test('publish-live: the three converted proxy sheets are published live (edge proxy reads them from the publish host)', () => {
  const f = fixture({ extra: EXTRA });
  for (const s of ['01-detect.sh', '02-config-to-da.sh']) assert.equal(f.run(s).status, 0, s);
  const r = f.run('04-sync.sh', { OF1_PUBLISH_LIVE: '1' });
  assert.equal(r.status, 0, r.stderr);
  const daw = readFileSync(join(f.fake, 'daw.log'), 'utf8');
  for (const n of ['signals', 'llmquestions', 'context-endpoints']) {
    assert.match(daw, new RegExp(`^sheet .*--path of1/config/${n} `, 'm'), `${n} written + previewed`);
    assert.match(daw, new RegExp(`^live .*--path of1/config/${n}\\.json$`, 'm'), `${n} published`);
  }
});
