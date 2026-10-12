import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKILLS = ['of1-integration', 'of1-check-dependencies', 'of1-extract-design', 'of1-build-templates',
  'of1-style-generative-block', 'of1-extract-brand-voice', 'of1-extract-content',
  'of1-build-quick-suggestions', 'of1-build-cta-template', 'of1-publish'];
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');

function walk(p, out = []) {
  const full = join(ROOT, p);
  if (!existsSync(full)) return out;
  if (statSync(full).isDirectory()) {
    for (const e of readdirSync(full)) if (e !== 'node_modules') walk(join(p, e), out);
  } else out.push(p);
  return out;
}

test('no removed pipeline/caller references', () => {
  const files = [...walk('skills'), ...walk('lib'), 'docs/contract.md', 'README.md', 'AGENTS.md']
    .filter((f) => !f.endsWith('contract.test.mjs'));
  const re = /OF1_PIPELINE_MODE|OF1_STAGE2_DONE_FILE|of1-demo-orchestrator|of1-demo-skills|of1-labs/;
  for (const f of files) {
    rd(f).split('\n').forEach((l, i) => assert.ok(!re.test(l), `${f}:${i + 1}: ${l}`));
  }
});

test('every AskUserQuestion is guarded by OF1_NON_INTERACTIVE within 12 lines before', () => {
  for (const n of SKILLS) {
    const lines = rd(`skills/${n}/SKILL.md`).split('\n');
    lines.forEach((l, i) => {
      if (!l.includes('AskUserQuestion')) return;
      const win = lines.slice(Math.max(0, i - 12), i + 1);
      assert.ok(win.some((w) => w.includes('OF1_NON_INTERACTIVE')), `${n}:${i + 1} unguarded AskUserQuestion`);
    });
  }
});

test('contract.md names the ten skills and the result file', () => {
  const c = rd('docs/contract.md');
  assert.equal(SKILLS.length, 10);
  for (const n of SKILLS) assert.ok(c.includes(n), `contract.md lacks ${n}`);
  assert.ok(c.includes('of1-integration-result.json'));
});

test('status file names in SKILL.md match the skill or a build-templates phase', () => {
  for (const n of SKILLS) {
    const s = rd(`skills/${n}/SKILL.md`);
    for (const m of s.matchAll(/of1-[a-z-]+?-status\.json/g)) {
      const name = m[0].replace(/-status\.json$/, '');
      if (name === n) continue;
      if (/^of1-build-templates-[a-z-]+$/.test(name) && n === 'of1-build-templates') continue;
      // cross-references (hub reads, gates) are allowed to name any known skill
      assert.ok(SKILLS.includes(name) || /^of1-build-templates-[a-z-]+$/.test(name) || name === 'of1-*',
        `${n}: unknown status file ${m[0]}`);
    }
  }
  // Each producing skill must write its own file name.
  for (const n of SKILLS.filter((x) => x !== 'of1-integration' && x !== 'of1-build-templates')) {
    assert.ok(rd(`skills/${n}/SKILL.md`).includes(`${n}-status.json`), `${n} never writes ${n}-status.json`);
  }
});

test('verify.sh requires exactly the ten base skills', () => {
  const s = rd('skills/of1-check-dependencies/scripts/verify.sh');
  const block = /REQUIRED_SKILLS=\(([\s\S]*?)\)/.exec(s)[1];
  const names = block.split('\n').filter((l) => !l.trim().startsWith('#')).join(' ').split(/\s+/).filter(Boolean);
  const expected = [...SKILLS].sort();
  assert.deepEqual(names.sort(), expected);
  assert.ok(!/of1-demo-orchestrator|of1-discovery|of1-prototype|of1-snowflake/.test(s));
});
