#!/usr/bin/env node
// Structural "shape" capture + diff for OF1 integration output. Shapes keep
// structure (keys, block names, counts) and drop content, so two runs of the
// same skill can be compared without noise.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const DEFAULT_WORKER = 'https://of1-gen-web-service.franklin-prod.workers.dev';

const sorted = (a) => [...a].sort();

export function shapeOfConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  return {
    keys: sorted(Object.keys(cfg)),
    templateNames: Array.isArray(cfg.templates?.names) ? cfg.templates.names.length : 0,
    hasIndexPath: Boolean(cfg.contentIngestion?.indexPath),
  };
}

export function shapeOfSheet(json) {
  if (!json || typeof json !== 'object') return null;
  const data = Array.isArray(json.data) ? json.data : [];
  return { columns: data[0] ? sorted(Object.keys(data[0])) : [], rows: data.length };
}

// Returns the inner HTML of each balanced <div ...> whose opening tag matches openRe.
function divBlocks(html, openRe) {
  const out = [];
  const re = new RegExp(openRe.source, 'g');
  let m;
  while ((m = re.exec(html))) {
    let depth = 1;
    const tag = /<(\/?)div\b[^>]*>/g;
    tag.lastIndex = m.index + m[0].length;
    let t;
    while ((t = tag.exec(html))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) break;
    }
    out.push(html.slice(m.index + m[0].length, t ? t.index : html.length));
  }
  return out;
}

const numAttr = (html, name) => {
  const m = html.match(new RegExp(`data-template-${name}="(\\d+)"`));
  return m ? Number(m[1]) : null;
};

export function shapeOfTemplate(plainHtml) {
  if (typeof plainHtml !== 'string') return null;
  const blocks = [];
  let depth = 0;
  for (const t of plainHtml.matchAll(/<(\/?)div\b([^>]*)>/g)) {
    if (t[1]) { depth -= 1; continue; }
    depth += 1;
    if (depth !== 2) continue; // direct child of a top-level section div
    const cls = t[2].match(/\sclass="\s*([^"\s]+)/);
    if (cls && cls[1] !== 'section-metadata' && cls[1] !== 'metadata') blocks.push(cls[1]);
  }
  const intent = plainHtml.match(/data-template-intent="([^"]*)"/);
  return { blocks, intent: intent ? intent[1] : null, minItems: numAttr(plainHtml, 'min-items'), maxItems: numAttr(plainHtml, 'max-items') };
}

export function shapeOfOf1Page(plainHtml) {
  if (typeof plainHtml !== 'string') return null;
  const [block] = divBlocks(plainHtml, /<div\s+class="of1"[^>]*>/);
  if (block === undefined) return { rows: [] };
  const topRows = [];
  const tag = /<(\/?)div\b[^>]*>/g;
  let depth = 0; let start = -1; let t;
  while ((t = tag.exec(block))) {
    if (!t[1]) { if (depth === 0) start = t.index + t[0].length; depth += 1; }
    else { depth -= 1; if (depth === 0) topRows.push(block.slice(start, t.index)); }
  }
  return { rows: topRows.map((r) => {
    const [cell] = divBlocks(r, /<div[^>]*>/);
    return (cell ?? '').replace(/<[^>]+>/g, '').trim();
  }) };
}

export function shapeOfBrandVoice(plainHtml) {
  if (typeof plainHtml !== 'string') return null;
  return {
    headings: [...plainHtml.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()),
    listItems: (plainHtml.match(/<li\b/g) || []).length,
  };
}

export function shapeOfStatus(status) {
  if (!status || typeof status !== 'object') return null;
  const flags = {};
  for (const [k, v] of Object.entries(status.config || {})) {
    if (typeof v === 'boolean') flags[k] = v;
    else if (typeof v === 'number') flags[k] = v > 0;
  }
  return { ready: Boolean(status.ready), flags };
}

export function shapeOfGenerate(ndjson) {
  const types = new Set();
  let sections = 0; let errors = 0;
  for (const line of String(ndjson ?? '').split('\n')) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!ev || typeof ev.type !== 'string') continue;
    types.add(ev.type);
    if (ev.type === 'section') sections += 1;
    if (ev.type === 'error') errors += 1;
  }
  return { eventTypes: sorted(types), sections, errors };
}

function flatten(v, prefix, out) {
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) out[prefix] = Array.isArray(v) ? '[]' : '{}';
    for (const k of keys) flatten(v[k], prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = v;
  }
  return out;
}

export const OWNED_PATHSPECS = ['blocks/of1', 'of1', 'deliverables', 'helix-query.yaml', '.hlxignore'];

export function filterOwnedPaths(files) {
  return files.filter((f) => OWNED_PATHSPECS.some((p) => f === p || f.startsWith(`${p}/`)));
}

export function diffShapes(a, b) {
  const fa = flatten(a, '', {});
  const fb = flatten(b, '', {});
  const fmt = (x) => (x === undefined ? '(absent)' : JSON.stringify(x) ?? String(x));
  const lines = [];
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    if (fa[k] !== fb[k]) lines.push(`${k}: ${typeof fa[k] === 'string' ? fa[k] : fmt(fa[k])} -> ${typeof fb[k] === 'string' ? fb[k] : fmt(fb[k])}`);
  }
  return lines.sort();
}

export async function captureShape({ base, worker, tenantId, gitFiles, fetchImpl = fetch }) {
  const get = async (url, opts) => {
    try {
      const r = await fetchImpl(url, opts);
      return r.ok ? r : null;
    } catch { return null; }
  };
  const getJson = async (url) => { const r = await get(url); if (!r) return null; try { return await r.json(); } catch { return null; } };
  const getText = async (url) => { const r = await get(url); if (!r) return null; try { return await r.text(); } catch { return null; } };

  const config = await getJson(`${base}/of1/config/config.json`);
  const index = await getJson(`${base}${config?.contentIngestion?.indexPath || '/query-index.json'}`);
  const paths = (index?.data || []).map((d) => d.path).filter((p) => typeof p === 'string');

  let names = Array.isArray(config?.templates?.names) ? config.templates.names : null;
  if (!names) names = paths.filter((p) => p.startsWith('/templates/')).map((p) => p.slice('/templates/'.length)).filter(Boolean);
  const templates = {};
  for (const n of names) templates[n] = shapeOfTemplate(await getText(`${base}/templates/${n}.plain.html`));

  let status = null; let generate = null;
  if (worker) {
    status = shapeOfStatus(await getJson(`${worker}/api/tenants/${tenantId}/status`));
    const r = await get(`${worker}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: tenantId, query: 'show me your best products', followUp: false, context: { browsing: [], conversationHistory: [] } }),
    });
    if (r) { try { generate = shapeOfGenerate(await r.text()); } catch { generate = null; } }
  }

  return {
    config: shapeOfConfig(config),
    of1Page: shapeOfOf1Page(await getText(`${base}/of1.plain.html`)),
    brandVoice: shapeOfBrandVoice(await getText(`${base}/of1/brand-voice.plain.html`)),
    personas: shapeOfSheet(await getJson(`${base}/of1/config/personas.json`)),
    suggestions: shapeOfSheet(await getJson(`${base}/of1/config/suggestions.json`)),
    templates,
    knowledgePages: paths.filter((p) => p.startsWith('/of1/knowledge/')).length,
    status,
    generate,
    gitFiles: sorted(gitFiles || []),
  };
}

export function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`flag ${argv[i]} needs a value`);
      o[argv[i].slice(2)] = v; i += 1;
    } else o._.push(argv[i]);
  }
  return o;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const [cmd, ...rest] = args._;
  if (cmd === 'capture') {
    if (!args.tenant || !args['repo-dir'] || !args.out) throw new Error('capture needs --tenant, --repo-dir, --out');
    const gitFiles = execFileSync('git', ['ls-files', '--', ...OWNED_PATHSPECS], { cwd: args['repo-dir'], encoding: 'utf8' }).split('\n').filter(Boolean);
    const shape = await captureShape({ base: `https://${args.tenant}.aem.page`, worker: args.worker ?? DEFAULT_WORKER, tenantId: args.tenant, gitFiles });
    fs.writeFileSync(args.out, `${JSON.stringify(shape, null, 2)}\n`);
    return 0;
  }
  if (cmd === 'diff') {
    if (rest.length !== 2) throw new Error('diff needs <a.json> <b.json>');
    const [a, b] = rest.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
    const lines = diffShapes(a, b);
    if (lines.length) { console.log(lines.join('\n')); return 1; }
    return 0;
  }
  throw new Error('usage: baseline.mjs capture|diff ...');
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().then((c) => process.exit(c), (e) => { console.error(`FATAL: ${e.message}`); process.exit(2); });
}
