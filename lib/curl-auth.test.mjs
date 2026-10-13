import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOK = 'SECRET-TOK_1.2~3+4/5=';
const AEM = 'AEM-SECRET-9';

// Stub curl: argv (one arg per line) -> $FAKE_DIR/argv.log, stdin config (only when -K -) -> stdin.log.
const STUB = `#!/bin/bash
d="$FAKE_DIR"; printf '%s\\n' "$@" >> "$d/argv.log"; echo "--" >> "$d/argv.log"
for a in "$@"; do last="$a"; case "$a" in -K) cfg=1;; -w) hasw=1;; esac; done
[ -n "$cfg" ] && cat >> "$d/stdin.log"
case "$last" in *plain.html) printf '<div>engine</div>\\n200';; *) if [ -n "$hasw" ]; then printf 'ok\\n200'; else printf '[]'; fi;; esac
`;
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of1-ca-')));
  const [state, repo, bin, fake] = ['state', 'repo', 'bin', 'fake'].map((d) => join(base, d));
  [state, repo, bin, fake].forEach((p) => mkdirSync(p));
  writeFileSync(join(bin, 'curl'), STUB); chmodSync(join(bin, 'curl'), 0o755);
  writeFileSync(join(state, 'repo-config.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', domain: 'x.com' }));
  writeFileSync(join(state, 'setup.json'), JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', of1Repo: repo, tokenFromEnv: true }));
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: base, OF1_STATE_DIR: state, OF1_DEMO_REPO: repo, FAKE_DIR: fake };
  const log = (n) => (existsSync(join(fake, n)) ? readFileSync(join(fake, n), 'utf8') : '');
  return { base, state, repo, fake, env, log };
}
const bash = (f, cmd, more = {}) => spawnSync('bash', ['-c', cmd], { encoding: 'utf8', cwd: f.repo, env: { ...f.env, ...more } });
const clean = (f, r, secrets = [TOK]) => {
  const all = f.log('argv.log') + r.stdout + r.stderr;
  for (const s of secrets) assert.ok(!all.includes(s), `secret leaked: ${s}`);
};
const lib = join(root, 'lib/curl-auth.sh');

test('helper: auth mode sends one Authorization header on stdin config, argv clean', () => {
  const f = fixture();
  const r = bash(f, `. ${lib}; TK="${TOK}"; of1_curl_auth TK auth -- -s https://x/y`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.log('stdin.log'), `header = "Authorization: Bearer ${TOK}"\n`);
  assert.match(f.log('argv.log'), /^-K\n-\n-s\nhttps:\/\/x\/y\n--\n$/);
  clean(f, r);
});
test('helper: auth+source mode adds x-content-source-authorization', () => {
  const f = fixture();
  bash(f, `. ${lib}; TK="${TOK}"; of1_curl_auth TK auth+source -- -s https://x/y`);
  assert.equal(f.log('stdin.log'), `header = "Authorization: Bearer ${TOK}"\nheader = "x-content-source-authorization: Bearer ${TOK}"\n`);
});
test('helper: rejects a non-identifier variable name', () => {
  const f = fixture();
  const r = bash(f, `. ${lib}; of1_curl_auth 'a;b' auth -- -s https://x`);
  assert.equal(r.status, 2);
  assert.equal(f.log('argv.log'), '');
});
test('helper: refuses tokens with quotes, backslashes, newlines, spaces, empty; no curl call, no echo', () => {
  for (const bad of ['a"b', 'a\\b', 'a\nheader = "X: y"', 'a b', '', "a'b", 'a$b']) {
    const f = fixture();
    const r = spawnSync('bash', ['-c', `. ${lib}; of1_curl_auth T auth -- -s https://x`], { encoding: 'utf8', env: { ...f.env, T: bad } });
    assert.equal(r.status, 2, JSON.stringify(bad));
    assert.match(r.stderr, /refusing token/);
    assert.equal(f.log('argv.log'), '');
    if (bad.length > 2) assert.ok(!(r.stdout + r.stderr).includes(bad));
  }
});
test('helper: propagates curl exit code and keeps xtrace from leaking the token', () => {
  const f = fixture();
  writeFileSync(join(f.base, 'bin', 'curl'), '#!/bin/bash\ncat >/dev/null; exit 22\n'); chmodSync(join(f.base, 'bin', 'curl'), 0o755);
  const r = bash(f, `. ${lib}; set -x; of1_curl_auth TK auth -- -s https://x; echo rc=$?; case $- in *x*) echo xtrace-restored;; esac`, { TK: TOK });
  assert.match(r.stdout, /rc=22/);
  assert.match(r.stdout, /xtrace-restored/);
  assert.ok(!r.stderr.includes(TOK), r.stderr);
});

// --- converted call sites: token absent from argv, delivered through stdin config
test('da-api.sh: da_put/da_delete/da_list/aem_preview keep signatures; tokens only via stdin', () => {
  const f = fixture();
  writeFileSync(join(f.repo, 'd.html'), '<p>x</p>');
  const r = bash(f, `. ${join(root, 'skills/of1-build-templates/assets/da-api.sh')}
    da_put d.html templates/a.html; da_delete templates/a.html; da_list templates; aem_preview templates/a`,
  { DA_TOKEN: TOK, AEM_TOKEN: AEM, ORG: 'o', REPO: 'r' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /aem_preview OK for templates\/a/);
  clean(f, r, [TOK, AEM]);
  const argv = f.log('argv.log');
  assert.match(argv, /https:\/\/admin\.da\.live\/source\/o\/r\/templates\/a\.html/);
  assert.match(argv, /data=@d\.html;type=text\/html/);
  assert.match(argv, /https:\/\/admin\.hlx\.page\/preview\/o\/r\/main\/templates\/a/);
  const stdin = f.log('stdin.log');
  assert.equal((stdin.match(new RegExp(`Authorization: Bearer ${TOK.replace(/[+/.]/g, '\\$&')}`, 'g')) || []).length, 3);
  assert.equal((stdin.match(/x-content-source-authorization/g) || []).length, 1);
  assert.match(stdin, /Authorization: Bearer AEM-SECRET-9/);
});
test('da-api.sh: refuses an unsafe token instead of sending it', () => {
  const f = fixture();
  const r = bash(f, `. ${join(root, 'skills/of1-build-templates/assets/da-api.sh')}; da_list templates`, { DA_TOKEN: 'a"b', ORG: 'o', REPO: 'r' });
  assert.notEqual(r.status, 0);
  assert.equal(f.log('argv.log'), '');
});
test('06-da-listings.sh: token only via stdin config', () => {
  const f = fixture();
  const r = spawnSync('bash', [join(root, 'skills/of1-publish/scripts/06-da-listings.sh')], { encoding: 'utf8', env: { ...f.env, ADOBE_IMS_TOKEN: TOK } });
  assert.equal(r.status, 0, r.stderr);
  clean(f, r);
  assert.match(f.log('argv.log'), /https:\/\/admin\.da\.live\/list\/o\/r\/of1\/knowledge/);
  assert.match(f.log('stdin.log'), /x-content-source-authorization: Bearer SECRET-TOK/);
});
test('upload-of1-page.sh: PUT + preview send tokens only via stdin config', () => {
  const f = fixture();
  const r = spawnSync('bash', [join(root, 'skills/of1-style-generative-block/scripts/upload-of1-page.sh')], { encoding: 'utf8', env: { ...f.env, ADOBE_IMS_TOKEN: TOK } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  clean(f, r);
  const argv = f.log('argv.log');
  assert.match(argv, /-X\nPUT\n/);
  assert.match(argv, /Content-Type: text\/html/);
  assert.match(argv, /admin\.hlx\.page\/preview\/o\/r\/main\/of1/);
  assert.equal((f.log('stdin.log').match(/Authorization: Bearer/g) || []).length, 3);
});
test('05-aem-preview-auth.sh: token only via stdin config', () => {
  const f = fixture();
  const r = spawnSync('bash', [join(root, 'skills/of1-check-dependencies/scripts/05-aem-preview-auth.sh')], { encoding: 'utf8', env: { ...f.env, ADOBE_IMS_TOKEN: TOK, AEM_TOKEN: AEM } });
  assert.notEqual(r.stdout + r.stderr, '');
  clean(f, r, [TOK, AEM]);
  assert.match(f.log('argv.log'), /admin\.hlx\.page\/status\/o\/r\/main\/index/);
  assert.match(f.log('stdin.log'), /Authorization: Bearer AEM-SECRET-9/);
});

// --- regression guard
function shFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'docs') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) shFiles(p, out); else if (e.name.endsWith('.sh')) out.push(p);
  }
  return out;
}
test('guard: no secret-carrying header/user flags in any shell script (use of1_curl_auth)', () => {
  const bad = [/-H\s+["']?(Authorization|x-content-source-authorization|x-auth-token|Cookie)/i, /--header\b/, /\bcurl\b[^\n|]*\s(-u|--user)\s/, /\bcurl\b[^\n|]*\s(-v|--verbose|--trace\S*)(\s|$)/, /^\s*set\s+-\w*x/m];
  for (const p of shFiles(root)) {
    if (p === lib) continue;
    const s = readFileSync(p, 'utf8');
    for (const re of bad) assert.ok(!re.test(s), `${relative(root, p)} matches ${re}`);
  }
});
test('guard: .mjs files never pass credentials to curl argv', () => {
  const walk = (d, o = []) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git', 'docs'].includes(e.name)) continue; const p = join(d, e.name); e.isDirectory() ? walk(p, o) : /\.mjs$/.test(e.name) && !/\.test\.mjs$/.test(e.name) && o.push(p); } return o; };
  for (const p of walk(root)) assert.ok(!/['"`]curl['"`]/.test(readFileSync(p, 'utf8')), `${relative(root, p)} spawns curl`);
});
