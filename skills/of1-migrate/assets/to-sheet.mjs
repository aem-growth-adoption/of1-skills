#!/usr/bin/env node
// to-sheet.mjs — bare of1/config JSON (signals, llmquestions, context-endpoints) -> DA sheet rows.
//   node to-sheet.mjs <signals|llmquestions|context-endpoints> <file.json>   # rows JSON on stdout; exit 1 + message on stderr when not representable
// The rowsTo* functions are the reverse (tests only): they prove the rows round-trip to the bare shape the edge proxy reads.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const COLUMNS = {
  signals: ['param', 'value', 'source', 'context'],
  llmquestions: ['url', 'question'],
  'context-endpoints': ['name', 'description', 'url', 'method', 'timeoutMs', 'inputs', 'outputDescription', 'outputFields'],
};
const INPUT_ALLOWLIST = ['account.accountId', 'account.domain', 'url', 'tenantId', 'entrySource'];
const MAX_ENDPOINTS = 2;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function fail(path, msg) { throw new Error(`${path}: ${msg}`); }
function noExtra(o, allowed, path) { for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${path}.${k}`, 'unsupported key (a sheet cannot hold it)'); }
// A cell must be a string, or a finite number/boolean that stringifies; objects, arrays and null are refused.
function cell(v, path, { required = false } = {}) {
  if (v === undefined) { if (required) fail(path, 'required'); return ''; }
  if (typeof v === 'string') { if (required && v === '') fail(path, 'must not be empty'); return v; }
  if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return String(v);
  return fail(path, `cannot be stored in a sheet cell (${v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v})`);
}
function pairText(v, path) {
  if (typeof v !== 'string') fail(path, 'must be a string');
  if (/[;=]/.test(v)) fail(path, 'contains ";" or "=" (the pair syntax cannot hold it)');
  return v;
}

export function signalsToRows(bare) {
  const f = 'signals.json';
  if (!Array.isArray(bare)) fail(f, 'must be an array of {param,value,source?,context?}');
  return bare.map((s, i) => {
    const p = `${f}[${i}]`;
    if (!isObj(s)) fail(p, 'must be an object');
    noExtra(s, COLUMNS.signals, p);
    return { param: cell(s.param, `${p}.param`, { required: true }), value: cell(s.value, `${p}.value`, { required: true }),
      source: cell(s.source, `${p}.source`), context: cell(s.context, `${p}.context`) };
  });
}
export function rowsToSignals(rows) {
  return rows.map((r) => ({ param: r.param, value: r.value, ...(r.source ? { source: r.source } : {}), ...(r.context ? { context: r.context } : {}) }));
}

export function llmquestionsToRows(bare) {
  const f = 'llmquestions.json';
  if (!Array.isArray(bare)) fail(f, 'must be an array of {url,questions[]}');
  const seen = new Set(), rows = [];
  bare.forEach((e, i) => {
    const p = `${f}[${i}]`;
    if (!isObj(e)) fail(p, 'must be an object');
    noExtra(e, ['url', 'questions'], p);
    const url = cell(e.url, `${p}.url`, { required: true });
    if (seen.has(url)) fail(`${p}.url`, `duplicate url ${url} (the proxy only reads the first entry)`);
    seen.add(url);
    if (!Array.isArray(e.questions) || !e.questions.length) fail(`${p}.questions`, 'must be a non-empty array of strings');
    e.questions.forEach((q, j) => {
      if (typeof q !== 'string' || q === '') fail(`${p}.questions[${j}]`, 'must be a non-empty string');
      rows.push({ url, question: q });
    });
  });
  return rows;
}
export function rowsToLlmquestions(rows) {
  const by = new Map();
  for (const r of rows) { if (!by.has(r.url)) by.set(r.url, []); by.get(r.url).push(r.question); }
  return [...by].map(([url, questions]) => ({ url, questions }));
}

export function contextEndpointsToRows(bare) {
  const f = 'context-endpoints.json';
  if (!isObj(bare) || !Array.isArray(bare.endpoints)) fail(f, 'must be {"endpoints": [...]}');
  noExtra(bare, ['endpoints'], f);
  if (bare.endpoints.length > MAX_ENDPOINTS) fail(`${f}.endpoints`, `more than ${MAX_ENDPOINTS} endpoints (the proxy ignores the rest)`);
  return bare.endpoints.map((e, i) => {
    const p = `${f}.endpoints[${i}]`;
    if (!isObj(e)) fail(p, 'must be an object');
    noExtra(e, ['name', 'description', 'url', 'method', 'timeoutMs', 'inputs', 'output'], p);
    if (e.timeoutMs !== undefined && typeof e.timeoutMs !== 'number') fail(`${p}.timeoutMs`, 'must be a number');
    const inputs = [];
    if (e.inputs !== undefined && !Array.isArray(e.inputs)) fail(`${p}.inputs`, 'must be an array');
    (e.inputs || []).forEach((inp, j) => {
      const q = `${p}.inputs[${j}]`;
      if (!isObj(inp)) fail(q, 'must be an object');
      noExtra(inp, ['name', 'from', 'required'], q);
      if (typeof inp.name !== 'string' || !inp.name) fail(`${q}.name`, 'must be a non-empty string');
      pairText(inp.name, `${q}.name`);
      if (!INPUT_ALLOWLIST.includes(inp.from)) fail(`${q}.from`, `"${inp.from}" is not an allowed input key (${INPUT_ALLOWLIST.join(', ')})`);
      if (inp.required !== undefined && typeof inp.required !== 'boolean') fail(`${q}.required`, 'must be a boolean');
      inputs.push(`${inp.name}=${inp.from}${inp.required ? '*' : ''}`);
    });
    const out = e.output;
    if (out !== undefined && !isObj(out)) fail(`${p}.output`, 'must be an object');
    if (out) noExtra(out, ['description', 'fields'], `${p}.output`);
    if (out?.fields !== undefined && !isObj(out.fields)) fail(`${p}.output.fields`, 'must be an object of field=description');
    const fields = Object.entries(out?.fields || {}).map(([k, v]) => `${pairText(k, `${p}.output.fields.${k}`)}=${pairText(v, `${p}.output.fields.${k}`)}`);
    return { name: cell(e.name, `${p}.name`, { required: true }), description: cell(e.description, `${p}.description`),
      url: cell(e.url, `${p}.url`, { required: true }), method: cell(e.method, `${p}.method`), timeoutMs: cell(e.timeoutMs, `${p}.timeoutMs`),
      inputs: inputs.join('; '), outputDescription: cell(out?.description, `${p}.output.description`), outputFields: fields.join('; ') };
  });
}
export function rowsToContextEndpoints(rows) {
  const split = (s) => (s ? s.split('; ') : []);
  return { endpoints: rows.map((r) => {
    const e = { name: r.name };
    if (r.description) e.description = r.description;
    e.url = r.url;
    if (r.method) e.method = r.method;
    if (r.timeoutMs) e.timeoutMs = Number(r.timeoutMs);
    if (r.inputs) e.inputs = split(r.inputs).map((x) => { const [name, from] = x.split('='); const req = from.endsWith('*'); return { name, from: req ? from.slice(0, -1) : from, ...(req ? { required: true } : {}) }; });
    if (r.outputDescription || r.outputFields) {
      e.output = {};
      if (r.outputDescription) e.output.description = r.outputDescription;
      if (r.outputFields) e.output.fields = Object.fromEntries(split(r.outputFields).map((x) => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)]; }));
    }
    return e;
  }) };
}

const CONVERT = { signals: signalsToRows, llmquestions: llmquestionsToRows, 'context-endpoints': contextEndpointsToRows };
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [kind, file] = process.argv.slice(2);
  try {
    if (!CONVERT[kind] || !file) throw new Error('usage: to-sheet.mjs <signals|llmquestions|context-endpoints> <file.json>');
    let bare;
    try { bare = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${kind}.json: not valid JSON (${e.message})`); }
    process.stdout.write(JSON.stringify(CONVERT[kind](bare)));
  } catch (e) { console.error(e.message); process.exit(1); }
}
