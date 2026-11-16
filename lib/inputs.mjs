import fs from 'node:fs';
function enumOf(name, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be ${allowed.slice(0, -1).join(', ')} or ${allowed.at(-1)}`);
  }
  return value;
}

export function parseInputs(argv = [], env = {}, { readFile } = {}) {
  const args = {};
  let autonomous = false;
  for (const a of argv) {
    if (a === 'autonomous') { autonomous = true; continue; }
    const i = a.indexOf('=');
    if (i > 0) args[a.slice(0, i)] = a.slice(i + 1);
  }
  const on = (v) => v && !['0', 'false', ''].includes(String(v).toLowerCase());
  autonomous = autonomous || Boolean(on(env.OF1_AUTONOMOUS));

  let pages = args.pages ?? env.OF1_PAGES ?? null;
  if (pages) {
    let raw = pages;
    if (raw.startsWith('@')) {
      raw = (readFile ?? ((f) => fs.readFileSync(f, 'utf8')))(raw.slice(1));
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error('pages must be JSON or @file'); }
    if (!Array.isArray(parsed)) throw new Error('pages must be a JSON array');
    pages = parsed.map((p) => (typeof p === 'string' ? { path: p } : p));
  } else pages = null;

  return {
    autonomous,
    pages,
    pageMode: enumOf('page-mode', args['page-mode'] ?? env.OF1_PAGE_MODE ?? 'copy', ['copy', 'real']),
    codeDelivery: enumOf('code-delivery', args['code-delivery'] ?? env.OF1_CODE_DELIVERY ?? 'main', ['main', 'branch', 'pr']),
  };
}
