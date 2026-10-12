#!/usr/bin/env node
// Writes $STATE_DIR/of1-integration-result.json (the driver's one result file).
// node write-result.mjs --state-dir <dir> --status done|review|failed --summary <text>
//   [--deliverable <url>=<label> ...] [--checks <passed>/<total>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATUSES = ['done', 'review', 'failed'];

export function buildResult(args) {
  if (!STATUSES.includes(args.status)) throw new Error(`invalid --status: ${args.status}`);
  const deliverables = [].concat(args.deliverable || []).map((d) => {
    const i = d.lastIndexOf('=');
    if (i < 1) throw new Error(`invalid --deliverable (want url=label): ${d}`);
    return { url: d.slice(0, i), label: d.slice(i + 1) };
  });
  let checks = { passed: 0, total: 0 };
  if (args.checks) {
    const m = /^(\d+)\/(\d+)$/.exec(args.checks);
    if (!m) throw new Error(`invalid --checks (want passed/total): ${args.checks}`);
    checks = { passed: Number(m[1]), total: Number(m[2]) };
  }
  return { status: args.status, summary: args.summary || '', deliverables, checks };
}

function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k.startsWith('--') || i + 1 >= argv.length) throw new Error(`bad argument: ${k}`);
    const key = k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key === 'deliverable') (out.deliverable ||= []).push(argv[i + 1]);
    else out[key] = argv[i + 1];
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const a = parseArgv(process.argv.slice(2));
    if (!a.stateDir) throw new Error('--state-dir required');
    const r = buildResult(a);
    mkdirSync(a.stateDir, { recursive: true });
    writeFileSync(join(a.stateDir, 'of1-integration-result.json'), JSON.stringify(r, null, 2) + '\n');
  } catch (e) {
    console.error(`write-result: ${e.message}`);
    process.exit(1);
  }
}
