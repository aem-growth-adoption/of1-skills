import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sh = (cmd, cwd) => spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8' });
function fixture(files) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-des-')));
  const state = join(base, 'state'), repo = join(base, 'repo');
  mkdirSync(state); mkdirSync(repo);
  writeFileSync(join(state, 'repo-config.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', domain: 'x.com' }));
  sh(`git init -q --bare -b main ${base}/origin.git && git init -q -b main . && git config user.email a@b && git config user.name t && git remote add origin ${base}/origin.git && git commit -q --allow-empty -m init && git push -q origin main`, repo);
  for (const f of files) { mkdirSync(dirname(join(repo, f)), { recursive: true }); writeFileSync(join(repo, f), 'x'); }
  const run = (s) => spawnSync('bash', [join(here, s)], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: base, OF1_STATE_DIR: state, OF1_DEMO_REPO: repo } });
  return { repo, run };
}
const ALL = ['stardust/current/DESIGN.json', 'stardust/current/DESIGN.md', 'stardust/current/assets/logo.svg',
  'stardust/current/assets/screenshots/a.png', 'stardust/current/pages/a.json', 'PRODUCT.md', 'deliverables/brand-review.html'];

test('verify-outputs: passes with all outputs, fails naming the missing one', () => {
  assert.equal(fixture(ALL).run('verify-outputs.sh').status, 0);
  const r = fixture(ALL.filter((f) => !f.endsWith('logo.svg'))).run('verify-outputs.sh');
  assert.equal(r.status, 1); assert.match(r.stdout, /logo\.svg missing/);
  assert.match(fixture(ALL.filter((f) => !f.includes('pages/'))).run('verify-outputs.sh').stdout, /no pages/);
});
test('commit-design: commits and pushes, incl. gitignored stardust/', () => {
  const f = fixture(ALL);
  writeFileSync(join(f.repo, '.gitignore'), 'stardust/\n');
  const r = f.run('commit-design.sh');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(sh('git show --stat --format=%s HEAD', f.repo).stdout, /design tokens and brand identity for x\.com[\s\S]*DESIGN\.json/);
  assert.equal(sh('git status -sb', f.repo).stdout.includes('ahead'), false);
});
test('commit-design: nothing to commit still succeeds and pushes', () => {
  const f = fixture(ALL);
  assert.equal(f.run('commit-design.sh').status, 0);
  const r = f.run('commit-design.sh');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /nothing to commit/);
});
test('bash -n', () => {
  for (const s of ['verify-outputs.sh', 'commit-design.sh']) assert.equal(spawnSync('bash', ['-n', join(here, s)]).status, 0, s);
});
