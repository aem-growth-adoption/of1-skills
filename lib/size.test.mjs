import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../skills/', import.meta.url).pathname;
const skills = readdirSync(root).filter((d) => existsSync(join(root, d, 'SKILL.md')));

for (const s of skills) {
  const lines = readFileSync(join(root, s, 'SKILL.md'), 'utf8').split('\n');
  test(`${s}/SKILL.md is <= 200 lines`, () => {
    const n = lines.at(-1) === '' ? lines.length - 1 : lines.length;
    assert.ok(n <= 200, `${n} lines`);
  });
  test(`${s}/SKILL.md has no bash block > 25 lines`, () => {
    let open = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (open === null && /^```bash\b/.test(l)) open = i;
      else if (open !== null && l.startsWith('```')) {
        assert.ok(i - open - 1 <= 25, `bash block at line ${open + 1} has ${i - open - 1} lines`);
        open = null;
      }
    }
  });
}
