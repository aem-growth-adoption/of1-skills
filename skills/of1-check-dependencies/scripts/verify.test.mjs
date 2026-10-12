import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const verify = join(here, 'verify.sh');
const root = join(here, '..', '..', '..');
const SKILLS = ['of1-integration', 'of1-extract-design', 'of1-build-templates', 'of1-style-generative-block',
  'of1-extract-brand-voice', 'of1-extract-content', 'of1-build-quick-suggestions', 'of1-build-cta-template',
  'of1-publish', 'stardust', 'impeccable', 'extract', 'prototype', 'snowflake'];

function tmp() { return realpathSync(mkdtempSync(join(tmpdir(), 'of1-verify-'))); }
function write(p, c = '') { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

function fixture() {
  const base = tmp();
  const repo = join(base, 'repo');
  mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  for (const f of ['scripts/aem.js', 'scripts/scripts.js', 'styles/styles.css']) write(join(repo, f));
  const home = join(base, 'home');
  for (const s of SKILLS) write(join(home, '.claude/skills', s, 'SKILL.md'), '# x\n');
  const bin = join(base, 'bin');
  mkdirSync(bin);
  for (const t of ['node', 'python3', 'jq', 'git', 'curl']) {
    const real = spawnSync('bash', ['-c', `command -v ${t}`]).stdout.toString().trim();
    write(join(bin, t), `#!/bin/sh\nexec "${real}" "$@"\n`); chmodSync(join(bin, t), 0o755);
  }
  write(join(bin, 'playwright-cli'), '#!/bin/sh\necho "  open  open a page"\n'); chmodSync(join(bin, 'playwright-cli'), 0o755);
  return { base, repo, home, bin };
}

function run(cwd, { home, bin }, extra = {}) {
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin`, ...extra };
  return spawnSync('/bin/bash', [verify], { cwd, env, encoding: 'utf8' });
}

test('defaults state dir and repo from cwd; no runtime line', () => {
  const f = fixture();
  const r = run(f.repo, f, { ADOBE_IMS_TOKEN: 'x' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const setup = join(f.repo, '.of1/state/setup.json');
  assert.ok(existsSync(setup));
  assert.equal(JSON.parse(readFileSync(setup, 'utf8')).of1Repo, f.repo);
  assert.doesNotMatch(r.stdout, /Runtime:/);
});

test('outside a git repo without OF1_DEMO_REPO fails naming it', () => {
  const f = fixture();
  const outside = join(f.base, 'outside');
  mkdirSync(outside);
  const r = run(outside, f, { ADOBE_IMS_TOKEN: 'x' });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /OF1_DEMO_REPO/);
});

test('no SLICC remnants in skills/docs-excluded tree', () => {
  const r = spawnSync('rg', ['-n', '-i', 'slicc|/workspace/|oauth-token|upskill|sprinkle|scoop',
    'skills', 'README.md', 'AGENTS.md', '.claude-plugin', '--glob', '!verify.test.mjs'],
  { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout);
});
