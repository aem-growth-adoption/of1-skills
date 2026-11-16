#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repoIdentity, hosts, checkEdsShape } from './site.mjs';
import { crawlOrigin, discoverPaths, proposePages, checkLive, navPathsFrom } from './pages.mjs';
import { parsePagesInput } from './inputs.mjs';
import { checkCommands } from './check.mjs';
import { deliver } from './deliver.mjs';
import { docCommands } from './doc.mjs';
import { blockCommands } from './blocks.mjs';
import { resolveToken, daList, TOKEN_HINT } from './da-client.mjs';
import { planTemplates } from './templates/plan.mjs';
import fs from 'node:fs';

export async function identity({ exec = execFileSync, cwd = process.cwd() } = {}) {
  const url = String(exec('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' })).trim();
  const { org, repo } = repoIdentity(url);
  return { org, repo, site: `${org}/${repo}`, hosts: hosts({ org, repo }) };
}

export async function prereqs({ exec = execFileSync, cwd = process.cwd(), fetchImpl = globalThis.fetch, resolve = resolveToken } = {}) {
  const missing = checkEdsShape(cwd).missing.filter((m) => m !== 'fragment-block');
  let id = null;
  try { id = await identity({ exec, cwd }); } catch (e) { missing.push(`repo: ${e.message}`); }
  let token = null;
  try { token = await resolve({}); } catch { missing.push('da-token'); }
  if (token && id) {
    try {
      await daList({ org: id.org, repo: id.repo, path: '', token, fetchImpl });
    } catch (e) {
      missing.push(/HTTP 40[13]\b/.test(e.message) ? `da-token-invalid: ${TOKEN_HINT}` : `da-unreachable: ${e.message}`);
    }
  }
  return { ok: missing.length === 0, missing };
}

export async function pages(args, { fetchImpl = globalThis.fetch, ...idDeps } = {}) {
  const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const { org, repo } = await identity(idDeps);
  const origin = crawlOrigin({ domain: opt('domain'), org, repo });
  const input = parsePagesInput(opt('pages'));
  let source = 'input';
  let paths = [];
  if (!input) ({ paths, source } = await discoverPaths(origin, { fetchImpl }));
  const navPaths = await navPathsFrom(origin, { fetchImpl });
  const proposed = proposePages({ paths, navPaths, input });
  const { live, skipped } = await checkLive(origin, proposed.map((p) => p.path), { fetchImpl });
  const liveSet = new Set(live);
  return { origin, source, proposal: proposed.filter((p) => liveSet.has(p.path)), skipped };
}

export const commands = {
  identity: async (args) => ({ result: await identity() }),
  pages: async (args) => ({ result: await pages(args) }),
  prereqs: async () => {
    const result = await prereqs();
    return { result, code: result.ok ? 0 : 1 };
  },
  deliver: async (args) => {
    const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
    const dash = args.indexOf('--');
    const result = await deliver({ repoDir: process.cwd(), paths: dash >= 0 ? args.slice(dash + 1) : [], message: opt('message'), mode: opt('mode'), branch: opt('branch') });
    return { result, code: result.ok ? 0 : 1 };
  },
  'templates-plan': async ([file]) => {
    if (!file?.startsWith('@')) throw new Error('Usage: templates-plan @registered.json');
    const registered = JSON.parse(fs.readFileSync(file.slice(1), 'utf8'));
    const { org, repo } = await identity();
    let daPaths = [];
    try { daPaths = (await daList({ org, repo, path: 'templates', token: await resolveToken({}) })).map((i) => i.path); } catch (e) { if (!/HTTP 404/.test(e.message)) throw e; }
    return { result: planTemplates({ registered, daPaths }) };
  },
  ...checkCommands,
  ...docCommands(identity),
  ...blockCommands,
};

export async function run(argv, table = commands, out = process.stdout, err = process.stderr) {
  const [cmd, ...rest] = argv.filter((a) => a !== '--json');
  if (!table[cmd]) {
    err.write(`Unknown command: ${cmd ?? ''}\nCommands: ${Object.keys(table).join(', ')}\n`);
    return 2;
  }
  try {
    const { result, code = 0 } = await table[cmd](rest);
    out.write(`${JSON.stringify(result, null, 2)}\n`);
    return code;
  } catch (e) {
    err.write(`${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await run(process.argv.slice(2));
