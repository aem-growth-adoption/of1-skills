import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTemplates, TARGETS } from './plan.mjs';

const reg = (paths) => paths.map((path) => ({ path, intent: 'discovery', description: 'd' }));

test('7 registered + 3 unregistered DA pages: 7 keep, 3 register, 5 build', () => {
  const registered = reg(TARGETS.slice(0, 7).map((t) => t.path));
  const daPaths = [...TARGETS.slice(0, 7), ...TARGETS.slice(7, 10)].map((t) => `/org/repo${t.path}.html`);
  const r = planTemplates({ registered, daPaths });
  assert.equal(r.keep.length, 7);
  assert.deepEqual(r.register, TARGETS.slice(7, 10).map((t) => t.path));
  assert.deepEqual(r.build, TARGETS.slice(10).map((t) => ({ path: t.path, intent: t.intent })));
  assert.equal(r.build.length, 5);
});

test('15 registered: nothing to build', () => {
  const r = planTemplates({ registered: reg(TARGETS.map((t) => t.path)), daPaths: [] });
  assert.deepEqual(r, { keep: TARGETS.map((t) => t.path), register: [], build: [] });
});

test('a registered /templates/old outside the 15 is kept and counted', () => {
  const r = planTemplates({ registered: reg(['/templates/old']), daPaths: [] });
  assert.deepEqual(r.keep, ['/templates/old']);
  assert.equal(r.build.length, 14);
  assert.ok(!r.build.some((b) => b.path === '/templates/old'));
});

test('empty: builds all 15, 3 per intent', () => {
  const r = planTemplates({ registered: [], daPaths: ['/org/repo/templates'] });
  assert.equal(r.build.length, 15);
  assert.equal(r.build[0].path, '/templates/comparison-1');
  assert.equal(r.build[0].intent, 'comparison');
});

test('more than 30 keep+register is capped and reported as overflow', () => {
  const registered = Array.from({ length: 28 }, (_, i) => ({ path: `/templates/x${i}` }));
  const daPaths = ['/templates/a', '/templates/b', '/templates/c'];
  const r = planTemplates({ registered, daPaths });
  assert.equal(r.keep.length + r.register.length, 30);
  assert.deepEqual(r.overflow, ['/templates/c']);
  assert.deepEqual(r.build, []);
});

test('null registered is treated as empty', () => {
  assert.equal(planTemplates({ registered: null, daPaths: null }).build.length, 15);
});
