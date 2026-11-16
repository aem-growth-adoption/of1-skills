import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliver } from './deliver.mjs';

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'of1-deliver-'));
  const origin = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  const clone = (n) => {
    const d = join(root, n);
    execFileSync('git', ['clone', '-q', origin, d]);
    sh(d, 'config', 'user.email', 't@t'); sh(d, 'config', 'user.name', 't');
    return d;
  };
  const a = clone('a');
  writeFileSync(join(a, 'shared.txt'), 'base\n');
  writeFileSync(join(a, 'other.txt'), 'base\n');
  sh(a, 'add', '.'); sh(a, 'commit', '-qm', 'init'); sh(a, 'push', '-q', 'origin', 'HEAD:main');
  const b = clone('b');
  return { a, b, origin };
}
const recorder = (calls, gh) => (cmd, args, opts) => {
  calls.push([cmd, ...args]);
  if (cmd === 'gh') return gh(args);
  return String(execFileSync(cmd, args, { ...opts, encoding: 'utf8' }));
};
const clean = (calls) => calls.every((c) => !c.includes('--force') && !c.includes('-f') && !(c[1] === 'add' && c.includes('-A')));

test('scoped commit leaves unrelated changes uncommitted', async () => {
  const { a } = setup();
  writeFileSync(join(a, 'new.txt'), 'x\n');
  writeFileSync(join(a, 'other.txt'), 'changed\n');
  const calls = [];
  const r = await deliver({ repoDir: a, paths: ['new.txt'], message: 'add', mode: 'main', run: recorder(calls) });
  assert.equal(r.ok, true); assert.equal(r.ref, 'main');
  assert.match(sh(a, 'status', '--porcelain'), / M other\.txt/);
  assert.equal(sh(a, 'show', '--name-only', '--format=', 'HEAD').trim(), 'new.txt');
  assert.ok(clean(calls));
});

test('nothing staged: no commit', async () => {
  const { a } = setup();
  const before = sh(a, 'rev-parse', 'HEAD');
  const r = await deliver({ repoDir: a, paths: ['shared.txt'], message: 'm', mode: 'main' });
  assert.deepEqual(r, { ok: false, ref: 'main', reason: 'nothing' });
  assert.equal(sh(a, 'rev-parse', 'HEAD'), before);
});

test('origin moved without conflict: rebased and pushed', async () => {
  const { a, b, origin } = setup();
  writeFileSync(join(b, 'other.txt'), 'theirs\n');
  sh(b, 'commit', '-qam', 'theirs'); sh(b, 'push', '-q', 'origin', 'HEAD:main');
  writeFileSync(join(a, 'new.txt'), 'x\n');
  const r = await deliver({ repoDir: a, paths: ['new.txt'], message: 'add', mode: 'main' });
  assert.equal(r.ok, true);
  assert.equal(sh(origin, 'log', '--format=%s', 'main').trim().split('\n')[0], 'add');
  assert.equal(sh(origin, 'log', '--format=%s', 'main').trim().split('\n')[1], 'theirs');
});

test('conflict: rebase aborted, no push', async () => {
  const { a, b, origin } = setup();
  writeFileSync(join(b, 'shared.txt'), 'theirs\n');
  sh(b, 'commit', '-qam', 'theirs'); sh(b, 'push', '-q', 'origin', 'HEAD:main');
  const tip = sh(origin, 'rev-parse', 'main');
  writeFileSync(join(a, 'shared.txt'), 'mine\n');
  const calls = [];
  const r = await deliver({ repoDir: a, paths: ['shared.txt'], message: 'mine', mode: 'main', run: recorder(calls) });
  assert.equal(r.ok, false); assert.equal(r.reason, 'conflict');
  assert.doesNotMatch(sh(a, 'status'), /rebase in progress/);
  assert.equal(sh(origin, 'rev-parse', 'main'), tip);
  assert.ok(clean(calls));
});

test('branch mode pushes the branch, main unchanged', async () => {
  const { a, origin } = setup();
  const tip = sh(origin, 'rev-parse', 'main');
  writeFileSync(join(a, 'new.txt'), 'x\n');
  const r = await deliver({ repoDir: a, paths: ['new.txt'], message: 'add', mode: 'branch' });
  assert.equal(r.ok, true); assert.equal(r.ref, 'of1-integrate');
  assert.equal(sh(origin, 'rev-parse', 'main'), tip);
  assert.ok(sh(origin, 'rev-parse', '--verify', 'of1-integrate'));
});

test('pr mode calls gh pr create', async () => {
  const { a } = setup();
  writeFileSync(join(a, 'new.txt'), 'x\n');
  const calls = [];
  const gh = (args) => { if (args[1] === 'view') throw new Error('none'); return 'https://github.com/o/r/pull/1\n'; };
  const r = await deliver({ repoDir: a, paths: ['new.txt'], message: 'add', mode: 'pr', run: recorder(calls, gh) });
  assert.equal(r.prUrl, 'https://github.com/o/r/pull/1');
  assert.ok(calls.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'create' && c.includes('--base')));
  assert.ok(clean(calls));
});

test('pr mode reuses an open PR', async () => {
  const { a } = setup();
  writeFileSync(join(a, 'new.txt'), 'x\n');
  const calls = [];
  const r = await deliver({ repoDir: a, paths: ['new.txt'], message: 'add', mode: 'pr', run: recorder(calls, () => 'https://github.com/o/r/pull/7\n') });
  assert.equal(r.prUrl, 'https://github.com/o/r/pull/7');
  assert.ok(!calls.some((c) => c[2] === 'create'));
});

test('gh missing', async () => {
  const { a } = setup();
  writeFileSync(join(a, 'new.txt'), 'x\n');
  const r = await deliver({ repoDir: a, paths: ['new.txt'], message: 'add', mode: 'pr', run: recorder([], () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); }) });
  assert.equal(r.reason, 'gh-missing');
});

test('conflict with an unrelated dirty file: HEAD and dirty file restored', async () => {
  const { a, b } = setup();
  writeFileSync(join(b, 'shared.txt'), 'theirs\n');
  sh(b, 'commit', '-qam', 'theirs'); sh(b, 'push', '-q', 'origin', 'HEAD:main');
  const head = sh(a, 'rev-parse', 'HEAD');
  writeFileSync(join(a, 'shared.txt'), 'mine\n');
  writeFileSync(join(a, 'other.txt'), 'dirty\n');
  const r = await deliver({ repoDir: a, paths: ['shared.txt'], message: 'mine', mode: 'main' });
  assert.equal(r.reason, 'conflict');
  assert.equal(sh(a, 'rev-parse', 'HEAD'), head);
  assert.match(sh(a, 'status', '--porcelain'), / M other\.txt/);
  assert.equal(readFileSync(join(a, 'other.txt'), 'utf8'), 'dirty\n');
  assert.equal(readFileSync(join(a, 'shared.txt'), 'utf8'), 'mine\n');
});

test('pull failure that is not a conflict: pull-failed, HEAD restored', async () => {
  const { a } = setup();
  writeFileSync(join(a, 'new.txt'), 'x\n');
  const head = sh(a, 'rev-parse', 'HEAD');
  const run = (cmd, args, opts) => {
    if (args[0] === 'pull') throw new Error('network');
    return String(execFileSync(cmd, args, { ...opts, encoding: 'utf8' }));
  };
  const r = await deliver({ repoDir: a, paths: ['new.txt'], message: 'm', mode: 'main', run });
  assert.equal(r.reason, 'pull-failed');
  assert.equal(sh(a, 'rev-parse', 'HEAD'), head);
});

test('push rejected', async () => {
  const { a } = setup();
  writeFileSync(join(a, 'new.txt'), 'x\n');
  const run = (cmd, args, opts) => {
    if (args[0] === 'push') throw new Error('rejected');
    return String(execFileSync(cmd, args, { ...opts, encoding: 'utf8' }));
  };
  assert.equal((await deliver({ repoDir: a, paths: ['new.txt'], message: 'm', mode: 'main', run })).reason, 'push-rejected');
});

test('main mode refuses off main', async () => {
  const { a } = setup();
  sh(a, 'checkout', '-qb', 'feature');
  writeFileSync(join(a, 'new.txt'), 'x\n');
  const r = await deliver({ repoDir: a, paths: ['new.txt'], message: 'm', mode: 'main' });
  assert.equal(r.reason, 'not-on-main');
  assert.equal(sh(a, 'log', '--format=%s', '-1').trim(), 'init');
});

test('branch mode returns to the original branch', async () => {
  const { a } = setup();
  writeFileSync(join(a, 'new.txt'), 'x\n');
  await deliver({ repoDir: a, paths: ['new.txt'], message: 'm', mode: 'branch' });
  assert.equal(sh(a, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
});

test('checkout failure', async () => {
  const { a } = setup();
  writeFileSync(join(a, 'new.txt'), 'x\n');
  const run = (cmd, args, opts) => {
    if (args[0] === 'checkout') throw new Error('no');
    return String(execFileSync(cmd, args, { ...opts, encoding: 'utf8' }));
  };
  assert.equal((await deliver({ repoDir: a, paths: ['new.txt'], message: 'm', mode: 'branch', run })).reason, 'checkout-failed');
});

test('gh failure other than ENOENT is gh-failed', async () => {
  const { a } = setup();
  writeFileSync(join(a, 'new.txt'), 'x\n');
  const r = await deliver({ repoDir: a, paths: ['new.txt'], message: 'm', mode: 'pr', run: recorder([], () => { throw new Error('auth'); }) });
  assert.equal(r.reason, 'gh-failed');
});

test('missing path: no commit', async () => {
  const { a } = setup();
  const head = sh(a, 'rev-parse', 'HEAD');
  const r = await deliver({ repoDir: a, paths: ['nope.txt'], message: 'm', mode: 'main' });
  assert.equal(r.reason, 'missing-path');
  assert.equal(sh(a, 'rev-parse', 'HEAD'), head);
});

test('bad branch names are rejected before any git change', async () => {
  const { a } = setup();
  writeFileSync(join(a, 'new.txt'), 'x\n');
  for (const branch of ['Bad_Name', 'a/b', 'x'.repeat(70)]) {
    const r = await deliver({ repoDir: a, paths: ['new.txt'], message: 'm', mode: 'branch', branch });
    assert.equal(r.ok, false); assert.equal(r.reason, 'bad-branch');
  }
  assert.equal(sh(a, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
});
