import fs from 'node:fs';
import path from 'node:path';
import { PROXY_SUFFIX } from './target.mjs';

export function repoIdentity(remoteUrl) {
  const m = String(remoteUrl).trim().match(/^(?:git@github\.com:|(?:https?|ssh):\/\/(?:[^@/]+@)?github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!m) throw new Error(`origin is not a GitHub repo: ${remoteUrl}`);
  return { org: m[1].toLowerCase(), repo: m[2].toLowerCase() };
}

export function hosts({ org, repo, ref = 'main', suffix = PROXY_SUFFIX }) {
  const base = `${ref}--${repo}--${org}`;
  return {
    page: `https://${base}.aem.page`,
    live: `https://${base}.aem.live`,
    proxy: `https://${base}${suffix}.of1.live`,
    proxyPreview: `https://prev--${base}${suffix}.of1.live`,
  };
}

function exportsName(src, name) {
  const re = new RegExp(`export\\s+(?:async\\s+)?(?:function\\s*\\*?|const|let|var|class)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`);
  return re.test(src);
}

export function checkEdsShape(repoDir) {
  const missing = [];
  const read = (rel) => {
    try { return fs.readFileSync(path.join(repoDir, rel), 'utf8'); } catch { return null; }
  };
  const aem = read('scripts/aem.js');
  if (aem === null) missing.push('scripts/aem.js');
  else for (const n of ['loadSections', 'readBlockConfig']) if (!exportsName(aem, n)) missing.push(`scripts/aem.js:${n}`);
  const scripts = read('scripts/scripts.js');
  if (scripts === null) missing.push('scripts/scripts.js');
  else if (!exportsName(scripts, 'decorateMain')) missing.push('scripts/scripts.js:decorateMain');
  if (read('blocks/fragment/fragment.js') === null) missing.push('fragment-block');
  return { ok: missing.filter((m) => m !== 'fragment-block').length === 0, missing };
}
