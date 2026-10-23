import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = join(here, '..');
const sh = (cmd, cwd) => spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8' });

function fixture({ files = {}, env = {} } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-dep-')));
  const state = join(base, 'state'), repo = join(base, 'repo'), bin = join(base, 'bin');
  [state, repo, bin].forEach((p) => mkdirSync(p, { recursive: true }));
  writeFileSync(join(bin, 'curl'), '#!/bin/bash\nexit 22\n'); chmodSync(join(bin, 'curl'), 0o755);
  writeFileSync(join(state, 'setup.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', of1Repo: repo, tokenFromEnv: true }));
  sh(`git init -q --bare -b main ${base}/origin.git && git init -q -b main . && git config user.email a@b && git config user.name t && git remote add origin ${base}/origin.git`, repo);
  for (const [f, c] of Object.entries({ README: 'x', ...files })) {
    mkdirSync(dirname(join(repo, f)), { recursive: true }); writeFileSync(join(repo, f), c);
  }
  sh('git add -A && git commit -qm init && git push -q origin main', repo);
  const run = (script, args = [], more = {}) => spawnSync('bash', [join(here, script), ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: base, OF1_STATE_DIR: state, ADOBE_IMS_TOKEN: 't', SKILL_DIR: skillDir, ...env, ...more },
  });
  const git = (c) => sh(`git ${c}`, repo).stdout.trim();
  const remote = (c) => sh(`git --git-dir=${base}/origin.git ${c}`, repo).stdout.trim();
  return { base, state, repo, run, git, remote };
}

const stubWriter = (f) => {
  const w = join(f.base, 'writer.sh');
  writeFileSync(w, `#!/bin/bash\necho "$@" >> ${f.base}/writer.log\ncp "\${@: -1}" ${f.base}/rows.json\n`); chmodSync(w, 0o755);
  return w;
};
test('07: uploads the config sheet to DA, no git commit', () => {
  const f = fixture();
  const before = f.git('rev-list --count HEAD');
  const r = f.run('07-config-json.sh', [], { DOMAIN: 'd.com', OF1_DA_WRITE: stubWriter(f) });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(readFileSync(join(f.base, 'writer.log'), 'utf8'), /sheet --owner o --repo r --path of1\/config\/config --columns key,value/);
  assert.deepEqual(JSON.parse(readFileSync(join(f.base, 'rows.json'), 'utf8')), [{ key: 'domain', value: 'd.com' }]);
  assert.equal(existsSync(join(f.repo, 'of1/config/config.json')), false);
  assert.equal(f.git('rev-list --count HEAD'), before);
});
test('07: existing sheet kept, only a missing domain row is added; complete sheet not rewritten', () => {
  const f = fixture();
  const cb = join(f.base, 'cbin'); mkdirSync(cb, { recursive: true });
  const sheet = join(f.base, 'sheet.json');
  writeFileSync(join(cb, 'curl'), `#!/bin/bash\ncat ${sheet}\n`); chmodSync(join(cb, 'curl'), 0o755);
  const path = { PATH: `${cb}:${process.env.PATH}` };
  writeFileSync(sheet, JSON.stringify({ data: [{ key: 'contentIngestion.indexPath', value: '/s.json' }, { key: 'x', value: 'y' }] }));
  let r = f.run('07-config-json.sh', [], { DOMAIN: 'd.com', OF1_DA_WRITE: stubWriter(f), ...path });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(JSON.parse(readFileSync(join(f.base, 'rows.json'), 'utf8')), [{ key: 'contentIngestion.indexPath', value: '/s.json' }, { key: 'x', value: 'y' }, { key: 'domain', value: 'd.com' }]);
  rmSync(join(f.base, 'writer.log'));
  writeFileSync(sheet, JSON.stringify({ data: [{ key: 'domain', value: 'other.com' }, { key: 'x', value: 'y' }] }));
  r = f.run('07-config-json.sh', [], { DOMAIN: 'd.com', OF1_DA_WRITE: stubWriter(f), ...path });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /left untouched/);
  assert.equal(existsSync(join(f.base, 'writer.log')), false);
});
test('cta: write-cta-template.sh uploads key,value rows', () => {
  const f = fixture();
  writeFileSync(join(f.state, 'repo-config.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'main' }));
  const cta = join(f.base, 'cta.json');
  writeFileSync(cta, JSON.stringify({ html: '<div>{{title}}</div>', slots: ['title'], fallback: { title: 'T', description: 'D', buttonText: 'B' } }));
  const script = join(skillDir, '../of1-build-cta-template/scripts/write-cta-template.sh');
  const r = spawnSync('bash', [script, cta], { encoding: 'utf8', env: { PATH: process.env.PATH, OF1_STATE_DIR: f.state, OF1_DA_WRITE: stubWriter(f) } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(f.base, 'writer.log'), 'utf8'), /--path of1\/config\/cta-template --columns key,value/);
  assert.deepEqual(JSON.parse(readFileSync(join(f.base, 'rows.json'), 'utf8')), [{ key: 'html', value: '<div>{{title}}</div>' }, { key: 'fallback.title', value: 'T' }, { key: 'fallback.description', value: 'D' }, { key: 'fallback.buttonText', value: 'B' }]);
});
test('08: creates helix-query.yaml when absent', () => {
  const f = fixture();
  const r = f.run('08-helix-query.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(f.repo, 'helix-query.yaml'), 'utf8'), /\/of1\/knowledge\/\*\*[\s\S]*\/templates\/\*\*/);
  assert.equal(f.remote('ls-tree --name-only main').includes('helix-query.yaml'), true);
});
test('08: customer file untouched, warns on missing /templates/', () => {
  const body = "indices:\n  x:\n    include:\n      - '/of1/knowledge/**'\n";
  const f = fixture({ files: { 'helix-query.yaml': body } });
  const r = f.run('08-helix-query.sh');
  assert.equal(r.status, 0);
  assert.equal(readFileSync(join(f.repo, 'helix-query.yaml'), 'utf8'), body);
  assert.match(r.stderr, /doesn't include \/templates\//);
  assert.doesNotMatch(r.stderr, /doesn't include \/of1\/knowledge\//);
});
test('08: SKIP_HELIX_QUERY=1 skips', () => {
  const f = fixture();
  const r = f.run('08-helix-query.sh', [], { SKIP_HELIX_QUERY: '1' });
  assert.equal(r.status, 0);
  assert.equal(existsSync(join(f.repo, 'helix-query.yaml')), false);
});
const legacy = { 'of1/config/config.json': '{}', 'of1/config/personas.json': '{}', 'of1/config/cta-template.json': '{}', 'of1/config/knowledge.json': '{}' };
test('03b: tracked of1/config stops with exit 3 and the migrate message, no removal even non-interactive', () => {
  const f = fixture({ files: legacy });
  const r = f.run('03b-legacy-config.sh', [], { OF1_NON_INTERACTIVE: '1' });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /^Legacy OF1 setup found: run of1-skills:of1-migrate$/m);
  assert.equal(f.git('ls-files of1/config').split('\n').length, 4);
});
test('03b: only non-migratable of1/config files tracked passes', () => {
  assert.equal(fixture({ files: { 'of1/config/brand-voice.json': '{}' } }).run('03b-legacy-config.sh').status, 0);
});
for (const n of ['signals', 'llmquestions', 'context-endpoints']) {
  test(`03b: tracked ${n}.json is legacy (exit 3)`, () => {
    const r = fixture({ files: { [`of1/config/${n}.json`]: '{}' } }).run('03b-legacy-config.sh');
    assert.equal(r.status, 3); assert.match(r.stderr, new RegExp(`of1/config/${n}\\.json`));
  });
}
test('03b: nothing tracked passes', () => {
  assert.equal(fixture().run('03b-legacy-config.sh').status, 0);
});
test('09: writes documented fields', () => {
  const f = fixture();
  const r = f.run('09-repo-config.sh', [], { DOMAIN: 'd.com' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(f.state, 'repo-config.json'), 'utf8')), {
    owner: 'o', repo: 'r', branch: 'main', contentPrefix: 'main', repoDir: f.repo, domain: 'd.com',
    repoUrl: 'https://github.com/o/r', previewUrl: 'https://main--r--o.aem.page/', daSource: 'da://o/r' });
});
test('02: order env > repo-config > content-source > fstab > fail', () => {
  const f = fixture({ files: { 'fstab.yaml': 'mountpoints:\n  /: https://content.da.live/o/r/\n  x: https://www.shop.com/a\n' } });
  assert.equal(f.run('02-domain.sh', [], { DOMAIN: 'env.com' }).stdout.trim(), 'env.com');
  writeFileSync(join(f.state, 'repo-config.json'), '{"domain":"rc.com"}');
  assert.equal(f.run('02-domain.sh', [], { OF1_CONTENT_SOURCE: 'cs.com' }).stdout.trim(), 'rc.com');
  spawnSync('rm', [join(f.state, 'repo-config.json')]);
  assert.equal(f.run('02-domain.sh', [], { OF1_CONTENT_SOURCE: 'cs.com' }).stdout.trim(), 'cs.com');
  assert.equal(f.run('02-domain.sh').stdout.trim(), 'content.da.live');
});
test('02: nothing found -> non-interactive fails with message; interactive exits 2; arg used', () => {
  const f = fixture();
  const r = f.run('02-domain.sh', [], { OF1_NON_INTERACTIVE: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAIL: cannot determine DOMAIN — set DOMAIN or pass content-source=<domain>/);
  assert.equal(f.run('02-domain.sh').status, 2);
  assert.equal(f.run('02-domain.sh', ['ask.com']).stdout.trim(), 'ask.com');
});
test('01: resets local state files', () => {
  const f = fixture();
  mkdirSync(join(f.state, 'hub')); writeFileSync(join(f.state, 'hub/x'), ''); writeFileSync(join(f.state, 'of1-publish-status.json'), '{}');
  writeFileSync(join(f.state, 'brand-voice.html'), ''); 
  assert.equal(f.run('01-reset-state.sh').status, 0);
  for (const p of ['hub', 'of1-publish-status.json', 'brand-voice.html']) assert.equal(existsSync(join(f.state, p)), false);
  assert.equal(existsSync(join(f.state, 'setup.json')), true);
});
test('07/09: refuse empty domain (never write "domain": "")', () => {
  for (const [s, p] of [['07-config-json.sh', 'config-rows.json'], ['09-repo-config.sh', null]]) {
    const f = fixture();
    const r = f.run(s, [], { DOMAIN: '' });
    assert.equal(r.status, 1, s + r.stderr);
    assert.match(r.stderr, /DOMAIN/);
    assert.equal(existsSync(join(f.state, p || 'repo-config.json')), false);
  }
});
test('07/09: resolve domain themselves (argument, no exported DOMAIN)', () => {
  const f = fixture();
  assert.equal(f.run('07-config-json.sh', ['arg.com'], { OF1_DA_WRITE: stubWriter(f) }).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(f.base, 'rows.json'), 'utf8')), [{ key: 'domain', value: 'arg.com' }]);
  assert.equal(f.run('09-repo-config.sh', ['arg.com']).status, 0);
  assert.equal(JSON.parse(readFileSync(join(f.state, 'repo-config.json'), 'utf8')).domain, 'arg.com');
});
test('01: clears product-urls.txt', () => {
  const f = fixture();
  writeFileSync(join(f.state, 'product-urls.txt'), 'x');
  f.run('01-reset-state.sh');
  assert.equal(existsSync(join(f.state, 'product-urls.txt')), false);
});
test('non-main branch: a write step stops before any write, commit or push', () => {
  const f = fixture();
  f.git('checkout -q -b feature');
  const before = f.git('rev-parse HEAD');
  const r = f.run('08-helix-query.sh');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /OF1 setup runs from the main branch \(checkout main\)/);
  assert.equal(existsSync(join(f.repo, 'helix-query.yaml')), false);
  assert.equal(f.git('rev-parse HEAD'), before);
  assert.equal(f.remote('branch --list feature'), '');
});
test('detached HEAD keeps its own message; main proceeds', () => {
  const f = fixture();
  f.git('checkout -q --detach');
  assert.match(f.run('08-helix-query.sh').stderr, /detached HEAD/);
  f.git('checkout -q main');
  assert.equal(f.run('08-helix-query.sh').status, 0);
});
