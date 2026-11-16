import fs from 'node:fs';
function enumOf(name, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be ${allowed.slice(0, -1).join(', ')} or ${allowed.at(-1)}`);
  }
  return value;
}

export function parsePagesInput(value, readFile = (f) => fs.readFileSync(f, 'utf8')) {
  if (!value) return null;
  let raw = value;
  if (raw.startsWith('@')) {
    try { raw = readFile(raw.slice(1)); } catch (e) { throw new Error(`pages: cannot read ${raw.slice(1)}: ${e.message}`); }
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`pages must be JSON or @file with JSON: ${e.message}`); }
  if (!Array.isArray(parsed)) throw new Error('pages must be a JSON array');
  return parsed.map((p) => (typeof p === 'string' ? { path: p } : p));
}

export function parseInputs(argv = [], env = {}, { readFile } = {}) {
  const args = {};
  let autonomous = false;
  for (const a of argv) {
    if (a === 'autonomous') { autonomous = true; continue; }
    const i = a.indexOf('=');
    if (i > 0) args[a.slice(0, i)] = a.slice(i + 1);
  }
  if (args.autonomous !== undefined) {
    autonomous = !['0', 'false', ''].includes(args.autonomous.toLowerCase());
  }
  const on = (v) => v && !['0', 'false', ''].includes(String(v).toLowerCase());
  autonomous = autonomous || Boolean(on(env.OF1_AUTONOMOUS));

  const pages = parsePagesInput(args.pages ?? env.OF1_PAGES ?? null, readFile);

  return {
    autonomous,
    pages,
    pageMode: enumOf('page-mode', args['page-mode'] ?? env.OF1_PAGE_MODE ?? 'copy', ['copy', 'real']),
    codeDelivery: enumOf('code-delivery', args['code-delivery'] ?? env.OF1_CODE_DELIVERY ?? 'main', ['main', 'branch', 'pr']),
  };
}
