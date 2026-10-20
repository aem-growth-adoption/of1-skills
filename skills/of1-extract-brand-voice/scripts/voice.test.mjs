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
url=""; hasO=0
for a in "$@"; do case "$a" in http*) url="$a";; -o) hasO=1;; esac; done
if [ "$hasO" = 1 ]; then printf "$(cat "$FAKE_DIR/code" 2>/dev/null || echo 200)"; exit 0; fi
case "$url" in
  */nav.plain.html) printf '<a href="/">h</a><a href="/about">a</a>';;
  *.plain.html) echo "PLAIN $url";;
  *) exit 22;;
esac
`;
const FAKE_NODE = (real) => `#!/bin/bash
if [ "$1" = -e ]; then exec ${real} "$@"; fi
echo "$@" >> "$FAKE_DIR/node.log"
`;
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-bv-')));
  const [state, repo, bin, fake] = ['state', 'repo', 'bin', 'fake'].map((d) => join(base, d));
  [state, repo, bin, fake].forEach((p) => mkdirSync(p));
  writeFileSync(join(state, 'repo-config.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', domain: 'x.com' }));
  writeFileSync(join(bin, 'curl'), FAKE_CURL); chmodSync(join(bin, 'curl'), 0o755);
  writeFileSync(join(bin, 'node'), FAKE_NODE(process.execPath)); chmodSync(join(bin, 'node'), 0o755);
  const run = (script, args = []) => spawnSync('bash', [join(here, script), ...args], { encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: base, OF1_STATE_DIR: state, OF1_DEMO_REPO: repo,
      ADOBE_IMS_TOKEN: 't', SKILL_DIR: skillDir, FAKE_DIR: fake } });
  return { fake, run };
}

test('pick-pages: nav list then plain.html of home + others', () => {
  const r = fixture().run('pick-pages.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /=== \/\n/);
  assert.match(r.stdout, /PLAIN https:\/\/main--r--o\.aem\.page\/index\.plain\.html/);
  assert.match(r.stdout, /PLAIN https:\/\/main--r--o\.aem\.page\/about\.plain\.html/);
});

test('write-doc: check exists/absent, skip writes nothing, overwrite calls da-write doc', () => {
  const f = fixture();
  assert.equal(f.run('write-doc.sh', ['check']).stdout.trim(), 'exists');
  writeFileSync(join(f.fake, 'code'), '404');
  assert.equal(f.run('write-doc.sh', ['check']).stdout.trim(), 'absent');
  assert.equal(f.run('write-doc.sh', ['skip']).status, 0);
  assert.throws(() => readFileSync(join(f.fake, 'node.log')));
  assert.equal(f.run('write-doc.sh', ['overwrite']).status, 0);
  const log = readFileSync(join(f.fake, 'node.log'), 'utf8');
  assert.match(log, /da-write\.mjs doc --owner o --repo r --path of1\/brand-voice --file .*brand-voice\.html/);
  assert.equal(f.run('write-doc.sh', ['bogus']).status, 2);
});

test('bash -n', () => {
  for (const s of ['common.sh', 'pick-pages.sh', 'write-doc.sh'])
    assert.equal(spawnSync('bash', ['-n', join(here, s)]).status, 0, s);
});
