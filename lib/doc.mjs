import fs from 'node:fs';
import { resolveToken, daGet, daList, aemAction } from './da-client.mjs';
import { writeDa } from './da-write.mjs';

const wrap = (inner) => `<body><header></header><main>${inner}</main><footer></footer></body>`;
const cells = (row) => `<div>${row.map((c) => `<div>${c}</div>`).join('')}</div>`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function of1PageHtml({ title } = {}) {
  const head = title ? `<h1>${esc(title)}</h1>` : '';
  return wrap(`<div>${head}<div class="of1">${cells([''])}</div></div>`);
}

export function sectionMetadataHtml(entries) {
  const rows = Object.entries(entries).map(([k, v]) => cells([esc(k), esc(v)])).join('');
  return `<div class="section-metadata">${rows}</div>`;
}

function mainInner(html) {
  const m = html.match(/<main>([\s\S]*)<\/main>/);
  return m ? { before: html.slice(0, m.index + 6), inner: m[1], after: html.slice(m.index + m[0].length - 7) } : null;
}

export function sections(html) {
  const main = mainInner(html);
  const inner = main ? main.inner : html;
  const out = [];
  let depth = 0;
  let start = -1;
  const re = /<(\/?)div\b[^>]*>/g;
  let m;
  while ((m = re.exec(inner))) {
    if (m[1]) {
      depth -= 1;
      if (depth === 0) out.push(inner.slice(start, m.index + m[0].length));
    } else {
      if (depth === 0) start = m.index;
      depth += 1;
    }
  }
  return out;
}

export function replaceSection(html, index, newSectionHtml) {
  const secs = sections(html);
  if (index < 0 || index >= secs.length) throw new Error(`No section ${index}`);
  const main = mainInner(html);
  const inner = main ? main.inner : html;
  const rebuilt = secs.map((s, i) => (i === index ? newSectionHtml : s)).join('');
  const prefix = inner.slice(0, inner.indexOf(secs[0]));
  const out = prefix + rebuilt;
  return main ? main.before + out + main.after : out;
}

export function heroGenerative(html, instruction) {
  const secs = sections(html);
  const i = secs.findIndex((s) => /<h1\b/i.test(s));
  if (i < 0) return html;
  const entries = { 'generative-scope': 'h1', 'generative-instruction': instruction };
  let sec = secs[i];
  const sm = sec.match(/<div class="section-metadata">[\s\S]*<\/div>\s*(?=<\/div>$)/);
  if (sm) {
    const kept = sm[0].replace(/<div>\s*<div>\s*generative-(scope|instruction)\s*<\/div>[\s\S]*?<\/div>\s*<\/div>/g, '');
    const merged = kept.replace(/<\/div>\s*$/, '') + Object.entries(entries).map(([k, v]) => cells([k, esc(v)])).join('') + '</div>';
    sec = sec.replace(sm[0], merged);
  } else {
    sec = sec.replace(/<\/div>$/, `${sectionMetadataHtml(entries)}</div>`);
  }
  return replaceSection(html, i, sec);
}

export function marker(instruction, fallback) {
  if (/[}]/.test(`${instruction}${fallback}`)) throw new Error('marker text must not contain "}"');
  return `{{generate: ${instruction}}}{{default: ${fallback}}}`;
}

export function decisionBlockHtml({ id, hint, candidates }) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id || '')) throw new Error(`Invalid decision id "${id}" (letters, digits, - and _, max 64)`);
  if (typeof hint !== 'string' || hint.length > 500) throw new Error('Decision hint must be a string of at most 500 characters');
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 10) throw new Error('Decision needs 2 to 10 candidates');
  const rows = [cells(['id', esc(id)]), cells(['hint', esc(hint)])];
  for (const c of candidates) rows.push(cells(['candidate', `<a href="${esc(c)}">${esc(c)}</a>`]));
  return `<div class="decision">${rows.join('')}</div>`;
}

export function copyPath(path, prefix = '/of1-demo') {
  const p = `/${String(path).replace(/^\/+|\/+$/g, '')}`;
  return p === '/' ? `${prefix}/home` : `${prefix}${p}`;
}

export function findHero(html) {
  return sections(html).findIndex((s) => /<h1\b/i.test(s));
}

export function ctaSectionHtml({ block, heading, text, button }) {
  const m = ([instruction, fallback]) => marker(instruction, fallback);
  const rows = [cells([`<h2>${m(heading)}</h2>`]), cells([`<p>${m(text)}</p>`]), cells([`<p><a href="${esc(button.href)}">${m(button.label)}</a></p>`])];
  return `<div><div class="${esc(block)}">${rows.join('')}</div></div>`;
}

export function hasOf1Cta(html) {
  return sections(html).slice(findHero(html) + 1).some((s) => s.includes('{{generate:'));
}

export function pickDecisionSection(html, heroIndex) {
  const secs = sections(html);
  for (let i = heroIndex + 1; i < secs.length; i += 1) {
    const m = secs[i].match(/<div class="[^"]*\b(promo|teaser|banner|cards|columns)\b/);
    if (m) return { index: i, reason: `${m[1]} block` };
  }
  return { index: -1, reason: 'no promo or teaser section' };
}

export function hasDecision(html) {
  return /<div class="decision"/.test(html);
}

export async function prepareDoc({ org, repo, path, mode, token, fetchImpl = globalThis.fetch }) {
  const clean = `/${String(path).replace(/^\/+|\/+$/g, '').replace(/\.html$/, '')}`;
  if (mode !== 'copy') return { target: clean, created: 'exists' };
  const src = await daGet({ org, repo, path: `${clean === '/' ? 'index' : clean.slice(1)}.html`, token, fetchImpl });
  if (src.status !== 200) throw new Error(`Source page ${clean} not found in DA (HTTP ${src.status})`);
  const target = copyPath(clean);
  const status = await ensureDoc({ org, repo, path: target, html: src.text, token, fetchImpl });
  return { target, created: status === 'exists' ? 'exists' : 'created' };
}

export async function ensureDoc({ org, repo, path, html, token, overwrite = false, fetchImpl = globalThis.fetch }) {
  const p = String(path).replace(/^\/+/, '').replace(/\.html$/, '');
  const { status } = await daGet({ org, repo, path: `${p}.html`, token, fetchImpl });
  if (status !== 200 && status !== 404) throw new Error(`daGet ${p} HTTP ${status}`);
  const exists = status === 200;
  if (exists && !overwrite) return 'exists';
  const r = await writeDa({ kind: 'doc', org, repo, path: p, content: html, token, fetchImpl });
  if (!r.ok) throw new Error(r.message);
  return exists ? 'overwritten' : 'created';
}

export function docCommands(identity) {
  const target = async () => { const { org, repo } = await identity(); return { org, repo, token: await resolveToken({}) }; };
  const clean = (p) => String(p).replace(/^\/+/, '');
  return {
    'da-get': async ([path]) => {
      const t = await target();
      const r = await daGet({ ...t, path: `${clean(path).replace(/\.html$/, '')}.html` });
      return { result: r, code: r.status === 200 ? 0 : 1 };
    },
    'da-put': async ([path, file, ...flags]) => {
      if (!file?.startsWith('@')) throw new Error('Usage: da-put <path> @file [--overwrite]');
      const t = await target();
      const html = fs.readFileSync(file.slice(1), 'utf8');
      return { result: { path, status: await ensureDoc({ ...t, path, html, overwrite: flags.includes('--overwrite') }) } };
    },
    'prepare-page': async ([path, ...flags]) => {
      const i = flags.indexOf('--mode');
      const mode = i >= 0 ? flags[i + 1] : 'copy';
      if (!['copy', 'real'].includes(mode)) throw new Error('Usage: prepare-page <path> --mode copy|real');
      return { result: await prepareDoc({ ...(await target()), path, mode }) };
    },
    preview: async (paths) => {
      const t = await target();
      const results = [];
      for (const p of paths) {
        const err = await aemAction({ action: 'preview', ...t, path: clean(p).replace(/\.html$/, ''), });
        results.push(err ? { path: p, ok: false, error: err } : { path: p, ok: true });
      }
      return { result: results, code: results.every((r) => r.ok) ? 0 : 1 };
    },
    'da-list': async ([path = '']) => {
      const t = await target();
      return { result: await daList({ ...t, path: clean(path) }) };
    },
  };
}
