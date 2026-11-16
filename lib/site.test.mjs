import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoIdentity, hosts, checkEdsShape } from './site.mjs';

test('repoIdentity handles SSH, HTTPS, case', () => {
  const want = { org: 'aem-growth-adoption', repo: 'wknd' };
  assert.deepEqual(repoIdentity('git@github.com:Aem-Growth-Adoption/WKND.git'), want);
  assert.deepEqual(repoIdentity('https://github.com/Aem-Growth-Adoption/wknd'), want);
  assert.deepEqual(repoIdentity('https://github.com/aem-growth-adoption/wknd.git'), want);
  assert.throws(() => repoIdentity('https://gitlab.com/o/r.git'), /origin is not a GitHub repo: https:\/\/gitlab.com\/o\/r.git/);
});

test('hosts', () => {
  const h = hosts({ org: 'o', repo: 'r', ref: 'of1-integrate' });
  assert.equal(h.proxyPreview, 'https://prev--of1-integrate--r--o--dev.of1.live');
  assert.equal(h.page, 'https://of1-integrate--r--o.aem.page');
  assert.equal(hosts({ org: 'o', repo: 'r' }).live, 'https://main--r--o.aem.live');
  assert.equal(hosts({ org: 'o', repo: 'r', suffix: '' }).proxy, 'https://main--r--o.of1.live');
});

function tmp(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'eds-'));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), c);
  }
  return d;
}

test('checkEdsShape ok and missing', () => {
  const good = tmp({
    'scripts/aem.js': 'export async function loadSections(){}\nexport function readBlockConfig(){}',
    'scripts/scripts.js': 'export function decorateMain(){}',
    'blocks/fragment/fragment.js': '',
  });
  assert.deepEqual(checkEdsShape(good), { ok: true, missing: [] });
  const bad = tmp({
    'scripts/aem.js': 'export { loadSections, readBlockConfig };',
    'scripts/scripts.js': 'function decorateMain(){}',
  });
  const r = checkEdsShape(bad);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['scripts/scripts.js:decorateMain', 'fragment-block']);
  assert.equal(checkEdsShape(tmp({})).ok, false);
});
