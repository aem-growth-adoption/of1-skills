import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = join(here, '..');
const FAKE_CURL = `#!/bin/bash
for a in "$@"; do case "$a" in -o) printf 200; exit 0;; esac; done
exit 22
`;
const FAKE_NODE = (real) => `#!/bin/bash
if [ "$1" = -e ]; then exec ${real} "$@"; fi
echo "$@" >> "$FAKE_DIR/node.log"
`;
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-qs-')));
  const [state, repo, bin, fake] = ['state', 'repo', 'bin', 'fake'].map((d) => join(base, d));
  [state, repo, bin, fake].forEach((p) => mkdirSync(p));
  writeFileSync(join(state, 'repo-config.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'main' }));
  writeFileSync(join(bin, 'curl'), FAKE_CURL); chmodSync(join(bin, 'curl'), 0o755);
  writeFileSync(join(bin, 'node'), FAKE_NODE(process.execPath)); chmodSync(join(bin, 'node'), 0o755);
  const run = (script) => spawnSync('bash', [join(here, script)], { encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: base, OF1_STATE_DIR: state, OF1_DEMO_REPO: repo,
      ADOBE_IMS_TOKEN: 't', SKILL_DIR: skillDir, FAKE_DIR: fake } });
  return { state, fake, run };
}

test('write-sheet calls da-write sheet with suggestions columns/rows', () => {
  const f = fixture();
  const r = f.run('write-sheet.sh');
  assert.equal(r.status, 0, r.stderr);
  const log = readFileSync(join(f.fake, 'node.log'), 'utf8');
  assert.match(log, /da-write\.mjs sheet --owner o --repo r --path of1\/config\/suggestions --columns label,query --rows .*suggestions-rows\.json/);
});

test('read-inputs prints titles, personas, falls back to local brand voice', () => {
  const f = fixture();
  writeFileSync(join(f.state, 'knowledge-pages.json'), JSON.stringify([{ title: 'Home', blocks: [{ tag: 'h2', text: 'Beans' }, { tag: 'p', text: 'no' }] }]));
  writeFileSync(join(f.state, 'personas-rows.json'), JSON.stringify([{ name: 'Pat', description: 'buyer' }]));
  writeFileSync(join(f.state, 'brand-voice.html'), 'LOCAL-VOICE');
  const r = f.run('read-inputs.sh');
  assert.match(r.stdout, /Home\n {2}Beans\nPat: buyer\nLOCAL-VOICE/);
});

test('bash -n', () => {
  for (const s of ['common.sh', 'write-sheet.sh', 'read-inputs.sh'])
    assert.equal(spawnSync('bash', ['-n', join(here, s)]).status, 0, s);
});
