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

test('06: removes of1/config exclusion, keeps others, commits + pushes', () => {
  const f = fixture({ files: { '.hlxignore': 'foo\nof1/config\nof1/knowledge/\n' } });
  const r = f.run('06-hlxignore.sh');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(readFileSync(join(f.repo, '.hlxignore'), 'utf8'), 'foo\nof1/knowledge/\n');
  assert.match(f.remote('log -1 --format=%s main'), /allow of1\/config/);
});
test('06: nothing to do when not blocked', () => {
  const f = fixture({ files: { '.hlxignore': 'foo\n' } });
  const r = f.run('06-hlxignore.sh');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /does not block/);
  assert.equal(f.git('rev-list --count HEAD'), '1');
});
test('07: writes config.json domain, commits only that file', () => {
  const f = fixture();
  writeFileSync(join(f.repo, 'other.txt'), 'staged'); f.git('add other.txt');
  const r = f.run('07-config-json.sh', [], { DOMAIN: 'd.com' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(JSON.parse(readFileSync(join(f.repo, 'of1/config/config.json'), 'utf8')), { domain: 'd.com' });
  assert.equal(f.git('show --name-only --format= HEAD'), 'of1/config/config.json');
  assert.equal(f.remote('rev-parse main'), f.git('rev-parse HEAD'));
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
test('03b remove: removes legacy, keeps config.json (and cta-template only when flagged)', () => {
  let f = fixture({ files: legacy });
  let r = f.run('03b-legacy-config.sh', ['remove']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(f.git('ls-files of1/config'), 'of1/config/config.json');
  f = fixture({ files: legacy });
  r = f.run('03b-legacy-config.sh', ['remove'], { OF1_CTA_TEMPLATE: '1' });
  assert.equal(f.git('ls-files of1/config'), 'of1/config/cta-template.json\nof1/config/config.json'.split('\n').sort().join('\n'));
  assert.equal(f.remote('rev-parse main'), f.git('rev-parse HEAD'));
});
test('03b: keep leaves files; no arg interactive exits 2; non-interactive removes', () => {
  let f = fixture({ files: legacy });
  assert.equal(f.run('03b-legacy-config.sh', ['keep']).status, 0);
  assert.equal(f.git('ls-files of1/config').split('\n').length, 4);
  assert.equal(f.run('03b-legacy-config.sh').status, 2);
  assert.equal(f.run('03b-legacy-config.sh', [], { OF1_NON_INTERACTIVE: '1' }).status, 0);
  assert.equal(f.git('ls-files of1/config'), 'of1/config/config.json');
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
