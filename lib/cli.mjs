#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repoIdentity, hosts, checkEdsShape } from './site.mjs';
import { resolveToken, daGet } from './da-client.mjs';

export async function identity({ exec = execFileSync, cwd = process.cwd() } = {}) {
  const url = String(exec('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' })).trim();
  const { org, repo } = repoIdentity(url);
  return { org, repo, site: `${org}/${repo}`, hosts: hosts({ org, repo }) };
}

export async function prereqs({ exec = execFileSync, cwd = process.cwd(), fetchImpl = globalThis.fetch, resolve = resolveToken } = {}) {
  const missing = checkEdsShape(cwd).missing.filter((m) => m !== 'fragment-block');
  let token = null;
  try { token = await resolve({}); } catch { missing.push('da-token'); }
  if (token) {
    try {
      const { org, repo } = await identity({ exec, cwd });
      const r = await daGet({ org, repo, path: '', token, fetchImpl });
      if (r.status === 401) missing.push('da-token-invalid');
    } catch (e) { missing.push(`da-access: ${e.message}`); }
  }
  return { ok: missing.length === 0, missing };
}

export const commands = {
  identity: async (args) => ({ result: await identity() }),
  prereqs: async () => {
    const result = await prereqs();
    return { result, code: result.ok ? 0 : 1 };
  },
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
