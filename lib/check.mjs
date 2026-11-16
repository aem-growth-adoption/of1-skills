import { readFileSync } from 'node:fs';

export function readIsland(html) {
  const m = /<script\b[^>]*\bid=["']of1-context["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

export async function checkPage(url, { fetchImpl = globalThis.fetch } = {}) {
  const u = new URL(url);
  u.searchParams.set('of1-region', 'us');
  const problems = [];
  let html;
  let res;
  try {
    res = await fetchImpl(u.toString());
    html = await res.text();
  } catch {
    return { ok: false, generative: 0, decisions: [], problems: ['fetch-failed'] };
  }
  if (!(res.status >= 200 && res.status < 300)) return { ok: false, generative: 0, decisions: [], problems: [`http-${res.status}`] };
  const island = readIsland(html);
  let generative = 0;
  let decisions = [];
  if (!island) {
    problems.push('no-island');
    if (!u.hostname.includes('prev--')) problems.push('not-preview-host');
  }
  else {
    generative = island.generative?.applied ?? 0;
    decisions = (island.decision?.points ?? []).map((p) => ({ id: p.id, choice: p.choice, fallback: p.fallback === true }));
    if (!generative) problems.push('no-generated-slot');
    if (!decisions.length) problems.push('no-decision');
    if (island.decision?.invalid?.length) problems.push('decision-invalid');
  }
  if (html.includes('{{generate:')) problems.push('raw-marker');
  return { ok: problems.length === 0, generative, decisions, problems };
}

export async function checkSearch(proxyOrigin, query, { fetchImpl = globalThis.fetch } = {}) {
  const base = proxyOrigin.replace(/\/+$/, '');
  const problems = [];
  const status = {};
  const probe = async (name, path, init, test) => {
    try {
      const res = await fetchImpl(`${base}${path}`, init);
      const body = await res.text();
      status[name] = res.status;
      if (!(res.status >= 200 && res.status < 300) || !test(body)) problems.push(`${name}-failed`);
    } catch {
      status[name] = 0;
      problems.push(`${name}-failed`);
    }
  };
  await probe('page', '/of1', {}, (b) => b.includes('class="of1'));
  await probe('sdk', '/sdk/of1-client.js', {}, () => true);
  await probe('generate', '/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) }, (b) => b.trim().length > 0);
  return { ok: problems.length === 0, status, problems };
}

export function pagesReady(status) {
  const entries = Object.entries(status?.pages ?? {});
  const pending = entries.filter(([, p]) => p?.state !== 'ready' && p?.state !== 'live').map(([path]) => path);
  if (!entries.length) return { ready: false, reason: 'no-pages', total: 0, pending };
  return { ready: entries.length - pending.length, total: entries.length, pending };
}

export async function waitFor(fn, { timeoutMs = 20 * 60_000, everyMs = 60_000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const start = now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (now() - start + everyMs > timeoutMs) return null;
    await sleep(everyMs);
  }
}

export const checkCommands = {
  'check-page': async (args) => { const result = await checkPage(args[0]); return { result, code: result.ok ? 0 : 1 }; },
  'check-search': async (args) => { const result = await checkSearch(args[0], args.slice(1).join(' ')); return { result, code: result.ok ? 0 : 1 }; },
  'pages-ready': async (args) => {
    const file = args[0]?.replace(/^@/, '');
    const result = pagesReady(JSON.parse(readFileSync(file, 'utf8')));
    return { result, code: result.reason || result.pending.length ? 1 : 0 };
  },
};
