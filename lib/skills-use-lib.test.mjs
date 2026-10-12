import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = (n) => readFileSync(new URL(`../skills/${n}/SKILL.md`, import.meta.url), 'utf8');
const ALL = ['of1-extract-design','of1-build-templates','of1-extract-brand-voice','of1-extract-content','of1-build-quick-suggestions','of1-style-generative-block','of1-publish','of1-check-dependencies'];
const NEED = {
  'da-token.sh': ['of1-extract-brand-voice','of1-extract-content','of1-build-quick-suggestions','of1-build-templates','of1-style-generative-block','of1-publish'],
  'git_push_rebased': ['of1-extract-design','of1-build-templates','of1-style-generative-block','of1-publish','of1-check-dependencies'],
  'pw.sh': ['of1-extract-content','of1-style-generative-block','of1-publish'],
};

test('no inline duplicates', () => {
  for (const n of ALL) {
    const s = rd(n);
    assert.ok(!s.includes('DA_PROBE='), `${n}: DA_PROBE=`);
    assert.ok(!/git pull --rebase --autostash/.test(s), `${n}: pull --rebase`);
    assert.ok(!/pw\(\) \{/.test(s), `${n}: pw() {`);
  }
});

test('skills source the helpers they need', () => {
  for (const [needle, names] of Object.entries(NEED)) {
    for (const n of names) assert.ok(rd(n).includes(needle), `${n} lacks ${needle}`);
  }
});
