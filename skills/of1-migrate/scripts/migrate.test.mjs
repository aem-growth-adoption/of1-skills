import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, chmodSync, existsSync } from 'node:fs';
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
  */api/generate) cat "$d/gen.ndjson"; [ "$hasw" = 1 ] && printf '\\n200';;
  *) exit 22;;
esac
`;
const OK_SYNC = '{"ok":true,"synced":["config"],"errors":[],"content":{"indexed":3}}';
const PUB_SYNC = '{"ok":true,"synced":[],"errors":[],"content":null}';

function fixture({ legacy = true } = {}) {
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
    writeFileSync(join(repo, 'of1/config/config.json'), JSON.stringify({ domain: 'x.com', contentIngestion: { indexPath: '/sitemap.json' } }));
    writeFileSync(join(repo, 'of1/config/cta-template.json'), JSON.stringify({ html: '<p>x</p>', fallback: { title: 't', description: 'd', buttonText: 'b' } }));
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

test('legacy repo: sheets written, both syncs with ref, git config removed last, migrated', () => {
  const f = fixture();
  const r = f.full();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const res = f.result();
  assert.equal(res.status, 'migrated'); assert.equal(res.tenant, 'o/r'); assert.equal(res.ref, 'main');
  assert.deepEqual(res.checks, { 2: true, 3: true, 6: true });
  const daw = readFileSync(join(f.fake, 'daw.log'), 'utf8');
  assert.match(daw, /--path of1\/config\/config /); assert.match(daw, /--path of1\/config\/cta-template /);
  assert.deepEqual(JSON.parse(readFileSync(join(f.fake, 'rows-config.json'), 'utf8')), [{ key: 'domain', value: 'x.com' }, { key: 'contentIngestion.indexPath', value: '/sitemap.json' }]);
  const urls = readFileSync(join(f.fake, 'urls.log'), 'utf8');
  assert.match(urls, /tenants\/o\/r\/sync\?stage=preview&ref=main/); assert.match(urls, /tenants\/o\/r\/sync\?stage=publish&ref=main/);
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
test('bash -n on every migrate script', () => {
  for (const s of ['common', '01-detect', '02-config-to-da', '03-remove-git-config', '04-sync', '05-verify', '06-report'])
    assert.equal(spawnSync('bash', ['-n', join(here, `${s}.sh`)]).status, 0, s);
});
