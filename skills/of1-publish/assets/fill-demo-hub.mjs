#!/usr/bin/env node
// Fill the demo-hub.html template with data from the OF1 pipeline.
//
// Usage (always cd into repo first):
//   node fill-demo-hub.mjs <repo-dir> <domain>
//
// Args:
//   repo-dir: Path to repo root (use "." when already cd'd in)
//   domain:   The demo domain name
//
// Reads ($OF1_STATE_DIR, default /shared/of1-demo-orchestrator):
//   repo-config.json                 owner/repo/branch (required)
//   of1-discovery-output.md          demo focus + narrative (optional)
//   pipeline-audit.json              audit panel (optional)
//   of1-*-status.json                per-skill status ("what worked" panel)
//   hub/sync.json                    saved POST /api/tenants/<id>/sync response
//   hub/status.json                  saved GET  /api/tenants/<id>/status response
//   hub/da-pages.txt                 DA root listing, one "<name>.html" per line
//   hub/da-templates.txt             DA /templates listing, one name per line
//   hub/da-knowledge.txt             DA /of1/knowledge listing, one slug per line
// Plus, from <repo-dir>: deliverables/{discovery,prototype-*}.html, content/*.html
// (EDS pages fallback when hub/da-pages.txt is absent).
//
// Writes: <repo-dir>/deliverables/index.html
//
// Exports renderConfigLinks / renderStatusPanel / formatSyncError / buildHub for tests.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function htmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function titleCase(s) {
  return String(s ?? '').replace(/[A-Za-z]+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function loadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return {};
  }
}

// Like loadJson but distinguishes "absent/unparseable" (null) from "{}".
function loadJsonOrNull(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function loadText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    return '';
  }
}

// One entry per non-empty line; [] when the file is absent.
function loadLines(p) {
  return loadText(p)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Authored config lives in DA (documents + sheets); only config.json is in git.
// One "edit in DA" link per authored item.
export function renderConfigLinks({ owner, repo, previewBase }) {
  const da = `${owner}/${repo}`;
  const links = [
    [`https://da.live/edit#/${da}/of1/brand-voice`, 'DA doc', 'Brand voice'],
    [`https://da.live/sheet#/${da}/of1/config/personas`, 'DA sheet', 'Personas'],
    [`https://da.live/sheet#/${da}/of1/config/suggestions`, 'DA sheet', 'Suggestion chips'],
    [`https://da.live/edit#/${da}/of1`, 'DA doc', 'OF1 page (title / subtitle / placeholder)'],
    [`https://da.live/#/${da}/templates`, 'DA folder', 'Templates'],
    [`https://da.live/#/${da}/of1/knowledge`, 'DA folder', 'Knowledge pages'],
    [`${previewBase}/of1/config/config.json`, 'Git', 'config.json'],
  ];
  return links
    .map(([href, badge, label]) => {
      const cls = badge === 'Git' ? 'badge--blue' : 'badge--orange';
      return `  <a href="${htmlEscape(href)}"><span class="badge ${cls}">${badge}</span> ${htmlEscape(label)}</a>`;
    })
    .join('\n');
}

// Sync `errors[]` entries come in several worker shapes: {file,error},
// {file,status}, {content,status}, {content,error}. Label = file/content path;
// message = error text, else "HTTP <status>", else the raw entry.
export function formatSyncError(e) {
  if (!e || typeof e !== 'object') return { label: 'error', msg: String(e) };
  const label = e.file ?? e.content ?? e.path ?? 'error';
  let msg;
  if (e.error != null && e.error !== '') msg = typeof e.error === 'string' ? e.error : JSON.stringify(e.error);
  else if (e.status != null) msg = `HTTP ${e.status}`;
  else if (e.message != null) msg = String(e.message);
  else msg = JSON.stringify(e);
  return { label: String(label), msg };
}

function statusColor(status) {
  if (status === 'done' || status === true) return 'var(--accent)';
  if (status === 'failed' || status === false) return 'var(--orange)';
  return 'var(--dim)';
}

// "What worked" panel: per-skill status files, the saved sync response
// ({ok,synced,errors,content:{indexed}}) and the saved /status response
// ({ready,config:{has*…}}). Every input is optional.
export function renderStatusPanel({ statuses = [], sync = null, status = null } = {}) {
  let html = '<h2>What worked</h2>\n';

  // Per-skill status
  if (statuses.length) {
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:16px;">\n';
    html += '<tr style="text-align:left;color:var(--dim);border-bottom:1px solid var(--border);"><th style="padding:6px 8px;">Skill</th><th>Status</th><th>Summary</th></tr>\n';
    for (const s of statuses) {
      const st = s.status ?? '?';
      html += '<tr style="border-bottom:1px solid var(--border);">';
      const label = s.phase ? `${s.skill ?? '?'} · ${s.phase}` : (s.skill ?? '?');
      html += `<td style="padding:6px 8px;">${htmlEscape(label)}</td>`;
      html += `<td style="color:${statusColor(st)};">${htmlEscape(st)}</td>`;
      html += `<td style="color:var(--dim);">${htmlEscape(s.summary ?? s.error ?? '')}</td>`;
      html += '</tr>\n';
    }
    html += '</table>\n';
  } else {
    html += '<p style="font-size:12px;color:var(--dim);margin-bottom:16px;">No per-skill status files found.</p>\n';
  }

  // Sync
  html += '<div style="font-size:12px;margin-bottom:12px;">\n';
  if (sync && typeof sync === 'object') {
    const synced = Array.isArray(sync.synced) ? sync.synced : [];
    const errors = Array.isArray(sync.errors) ? sync.errors : [];
    const indexed = sync.content && typeof sync.content === 'object' ? (sync.content.indexed ?? 0) : 'n/a';
    html += `  <div>Sync: <span style="color:${statusColor(sync.ok === true)};">ok: ${htmlEscape(String(sync.ok))}</span>`;
    html += ` &bull; synced: ${htmlEscape(synced.join(', ') || '—')}`;
    html += ` &bull; content indexed: ${htmlEscape(String(indexed))}</div>\n`;
    for (const e of errors) {
      const { label, msg } = formatSyncError(e);
      html += `  <div style="color:var(--orange);">✗ ${htmlEscape(label)}: ${htmlEscape(msg)}</div>\n`;
    }
  } else {
    html += '  <div style="color:var(--dim);">Sync: not synced (no hub/sync.json)</div>\n';
  }
  html += '</div>\n';

  // Tenant status / ready gate
  html += '<div style="font-size:12px;margin-bottom:16px;">\n';
  if (status && typeof status === 'object') {
    html += `  <div>Tenant ready: <span style="color:${statusColor(status.ready === true)};">${htmlEscape(String(status.ready))}</span></div>\n`;
    const cfg = status.config && typeof status.config === 'object' ? status.config : {};
    const entries = Object.entries(cfg);
    if (entries.length) {
      html += '  <div style="color:var(--dim);">';
      html += entries
        .map(([k, v]) => {
          const ok = v === true || (typeof v === 'number' && v > 0);
          const mark = typeof v === 'boolean' ? (v ? '✓' : '✗') : htmlEscape(String(v));
          return `<span style="color:${ok ? 'var(--accent)' : 'var(--orange)'};">${htmlEscape(k)} ${mark}</span>`;
        })
        .join(' &bull; ');
      html += '</div>\n';
    }
  } else {
    html += '  <div style="color:var(--dim);">Tenant status: unknown (no hub/status.json)</div>\n';
  }
  html += '</div>\n';
  return html;
}

// Per-skill status files written by each skill to $OF1_STATE_DIR/of1-<skill>-status.json.
function loadStatuses(stateDir) {
  let files = [];
  try {
    files = fs.readdirSync(stateDir).filter((f) => /^of1-.+-status\.json$/.test(f)).sort();
  } catch {
    return [];
  }
  return files
    .map((f) => {
      const j = loadJsonOrNull(path.join(stateDir, f));
      if (!j || typeof j !== 'object') return null;
      return {
        skill: j.skill ?? f.replace(/-status\.json$/, ''),
        ...(j.phase ? { phase: j.phase } : {}),
        status: j.status,
        summary: j.summary ?? j.error,
      };
    })
    .filter(Boolean);
}

// da-blocks-slots: templates are DA documents. One "edit in DA" + preview link each.
function renderDaTemplates(names, owner, repo, previewBase) {
  if (!names.length) return '  <!-- no DA templates listed -->';
  return names
    .map((name) => {
      const edit = `https://da.live/edit#/${owner}/${repo}/templates/${htmlEscape(name)}`;
      const preview = `${previewBase}/templates/${htmlEscape(name)}.plain.html`;
      return (
        `  <a href="${edit}"><span class="badge badge--orange">Edit</span> ${htmlEscape(name)}</a>\n` +
        `  <a href="${preview}"><span class="badge badge--green">Preview</span> ${htmlEscape(name)}.plain.html</a>`
      );
    })
    .join('\n');
}

// Knowledge pages (DA /of1/knowledge/<slug>) the worker indexes for RAG.
function renderDaKnowledge(slugs, owner, repo, previewBase) {
  if (!slugs.length) return '  <span style="color:var(--dim)">No knowledge pages listed</span>';
  return slugs
    .map((slug) => {
      const edit = `https://da.live/edit#/${owner}/${repo}/of1/knowledge/${htmlEscape(slug)}`;
      const preview = `${previewBase}/of1/knowledge/${htmlEscape(slug)}`;
      return (
        `  <a href="${edit}"><span class="badge badge--orange">Edit</span> ${htmlEscape(slug)}</a>\n` +
        `  <a href="${preview}"><span class="badge badge--green">Preview</span> /of1/knowledge/${htmlEscape(slug)}</a>`
      );
    })
    .join('\n');
}

function renderAudit(stateDir) {
  const auditPath = path.join(stateDir, 'pipeline-audit.json');
  const audit = loadJson(auditPath);
  if (!audit || Object.keys(audit).length === 0) return ''; // no audit written — fine

  // Orchestrators write `stages`; accept legacy `steps` too.
  const stages = Array.isArray(audit.stages) ? audit.stages
    : Array.isArray(audit.steps) ? audit.steps
      : null;
  if (!stages || stages.length === 0) {
    console.error(`WARN: ${auditPath} exists but has no 'stages' (or legacy 'steps') array — audit section omitted from the hub.`);
    return '';
  }

  // Orchestrators sometimes leave the top-level summary fields unset/zero
  // even though every per-stage record carries real totalTokens/durationMs —
  // derive from the records rather than trust the top-level field blindly.
  const sumStageTokens = stages.reduce((sum, s) => sum + (s.totalTokens || 0), 0);
  const totalTokens = audit.totalTokens || sumStageTokens;

  // Wall-clock must span the earliest dispatch to the latest return, not the
  // sum of per-stage durations (stages 3's skills dispatch in parallel, so
  // summing would double-count and wildly overstate the real elapsed time).
  const stageWindows = stages
    .map((s) => {
      const startedAt = Date.parse(s.startedAt ?? '');
      if (!Number.isFinite(startedAt)) return null;
      return { start: startedAt, end: startedAt + (s.durationMs || 0) };
    })
    .filter(Boolean);
  const derivedSpanMs = stageWindows.length
    ? Math.max(...stageWindows.map((w) => w.end)) - Math.min(...stageWindows.map((w) => w.start))
    : 0;
  const topLevelSpanMs = (() => {
    const start = Date.parse(audit.startedAt ?? '');
    const end = Date.parse(audit.completedAt ?? '');
    return Number.isFinite(start) && Number.isFinite(end) ? end - start : 0;
  })();
  const totalDuration = audit.totalDurationMs || topLevelSpanMs || derivedSpanMs;
  const totalMins = totalDuration / 60000;
  const stageCount = audit.stageCount ?? audit.stepCount ?? stages.length;

  const skillVersion = audit.skillVersion ?? 'unknown';
  const skillBranch = audit.skillBranch ?? 'unknown';

  let html = '<h2>Pipeline Audit</h2>\n';
  html += `<p style="font-size:11px;color:var(--dim);margin-bottom:12px;">Skills: ${htmlEscape(skillBranch)}@${htmlEscape(skillVersion)}</p>\n`;
  html += '<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px;">\n';
  html += `  <div style="font-size:12px;color:var(--dim);">Total tokens<br><span style="font-size:20px;color:var(--fg);">${totalTokens.toLocaleString('en-US')}</span></div>\n`;
  html += `  <div style="font-size:12px;color:var(--dim);">Wall clock<br><span style="font-size:20px;color:var(--fg);">${totalMins.toFixed(1)} min</span></div>\n`;
  html += `  <div style="font-size:12px;color:var(--dim);">Dispatches<br><span style="font-size:20px;color:var(--fg);">${stageCount}</span></div>\n`;
  html += '</div>\n';

  html += '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:24px;">\n';
  html += '<tr style="text-align:left;color:var(--dim);border-bottom:1px solid var(--border);">';
  html += '<th style="padding:6px 8px;">Stage</th><th>Name</th><th>Model</th>';
  html += '<th style="text-align:right;">Tokens</th><th style="text-align:right;">Duration</th>';
  html += '<th>Status</th></tr>\n';

  for (const s of stages) {
    const durS = (s.durationMs || 0) / 1000;
    const tokens = s.totalTokens || 0;
    const status = s.status ?? '?';
    const statusColor = status === 'done' ? 'var(--accent)' : status === 'failed' ? 'var(--orange)' : 'var(--dim)';
    const retries = s.retries ?? 0;
    const retryBadge = retries > 0 ? ` <span style="color:var(--orange);">↻${retries}</span>` : '';

    html += '<tr style="border-bottom:1px solid var(--border);">';
    // {stage,skill} is canonical; s.step is the retired legacy shape (older audits).
    const stageLabel = s.skill ? `${s.stage ?? '?'} · ${s.skill}` : (s.stage ?? s.step ?? '?');
    html += `<td style="padding:6px 8px;">${htmlEscape(String(stageLabel))}</td>`;
    html += `<td>${htmlEscape(s.name ?? '')}</td>`;
    html += `<td>${htmlEscape(s.model ?? '')}</td>`;
    html += `<td style="text-align:right;">${tokens.toLocaleString('en-US')}</td>`;
    html += `<td style="text-align:right;">${durS.toFixed(0)}s</td>`;
    html += `<td style="color:${statusColor};">${status}${retryBadge}</td>`;
    html += '</tr>\n';
  }

  html += '</table>\n';

  const improvements = audit.improvements ?? [];
  if (improvements.length) {
    html += '<h2>Improvements</h2>\n';
    html += '<div style="display:flex;flex-direction:column;gap:12px;">\n';
    for (const imp of improvements) {
      html += '<div style="padding:12px 16px;border:1px solid var(--border);border-radius:6px;font-size:12px;">\n';
      const impLabel = imp.skill ? `${imp.stage ?? '?'} · ${imp.skill}` : (imp.stage ?? imp.step ?? '?');
      html += `  <div style="color:var(--orange);margin-bottom:4px;">Stage ${htmlEscape(String(impLabel))} — ${htmlEscape(imp.issue ?? '')}</div>\n`;
      html += `  <div style="color:var(--dim);">${htmlEscape(imp.suggestion ?? '')}</div>\n`;
      html += '</div>\n';
    }
    html += '</div>\n';
  }

  return html;
}

// Extract the body of a `## <heading>` section from of1-discovery-output.md — the lines
// after the heading, up to the next heading or EOF. Returns '' if not found.
function extractSection(discoveryOutput, heading) {
  const lines = discoveryOutput.split('\n');
  const body = [];
  let inSection = false;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      // A heading line. If it's ours, start collecting; otherwise stop if we were.
      if (line.replace(/^#{1,6}\s+/, '').trim().toLowerCase() === heading.toLowerCase()) {
        inSection = true;
        continue;
      }
      if (inSection) break;
      continue;
    }
    if (inSection) body.push(line.trim());
  }
  return body.join(' ').replace(/\s+/g, ' ').trim();
}

function extractNarrative(discoveryOutput) {
  return extractSection(discoveryOutput, 'Narrative') || 'Demo narrative not available.';
}

function extractFocus(discoveryOutput) {
  return extractSection(discoveryOutput, 'Demo Focus') || 'AI-Powered Experience';
}

function findEdsPages(repoDir, pagesFile, previewBase) {
  const pages = [];

  for (const line of loadLines(pagesFile)) {
    const name = path.basename(line, path.extname(line));
    if (name === 'nav' || name === 'footer') continue;
    const label = titleCase(name.replace(/-/g, ' ').replace('prototype ', ''));
    const url = name === 'index' ? previewBase : `${previewBase}/${name}`;
    pages.push({ url, label });
  }

  if (!pages.length) {
    const contentDir = path.join(repoDir, 'content');
    if (fs.existsSync(contentDir)) {
      const files = fs
        .readdirSync(contentDir)
        .filter((f) => f.endsWith('.html'))
        .sort();
      for (const file of files) {
        const slug = path.basename(file, '.html');
        if (slug === 'nav' || slug === 'footer') continue;
        const label = titleCase(slug.replace(/-/g, ' ').replace('prototype ', ''));
        const url = slug === 'index' ? previewBase : `${previewBase}/${slug}`;
        pages.push({ url, label });
      }
    }
  }

  return pages;
}

function renderEdsPages(pages) {
  let html = '';
  for (const p of pages) {
    html += `  <a href="${p.url}"><span class="badge badge--green">AEM Preview</span> ${htmlEscape(p.label)}</a>\n`;
  }
  return html || '  <span style="color:var(--dim)">No pages published yet</span>';
}

// Discovery & Extraction section — only link deliverables that actually exist.
// discovery.html is produced by the full e2e pipeline (Stage 1) but NOT by the
// of1-integration flow; brand-review.html is produced by NO current path, so
// it is never linked. An empty section shows a dim placeholder instead of a 404 link.
function renderDiscovery(repoDir, previewBase) {
  let html = '';
  const discoveryPath = path.join(repoDir, 'deliverables', 'discovery.html');
  if (fs.existsSync(discoveryPath)) {
    html += `  <a href="${previewBase}/deliverables/discovery.html"><span class="badge badge--orange">Standalone</span> Discovery</a>\n`;
  }
  return html || '  <span style="color:var(--dim)">No discovery report for this flow</span>';
}

// Prototypes are the standalone HTML redesign pages. Stage 2b (of1-prototype, wrapping
// stardust:prototype) copies them into `deliverables/prototype-<slug>.html` and commits them;
// EDS serves that dir. This renderer links those deployed copies directly. We read from
// `deliverables/` (the committed, served location) rather than `stardust/prototypes/`, which may
// be gitignored — and whose basenames already start with `prototype-`, so prefixing them again
// produced broken `deliverables/prototype-prototype-<slug>.html` links.
function renderPrototypes(repoDir, previewBase) {
  let html = '';
  const delivDir = path.join(repoDir, 'deliverables');

  if (fs.existsSync(delivDir)) {
    const files = fs
      .readdirSync(delivDir)
      .filter((f) => f.startsWith('prototype-') && f.endsWith('.html'))
      .sort();
    for (const file of files) {
      const stem = path.basename(file, '.html');
      const label = titleCase(stem.replace('prototype-', '').replace(/-/g, ' ').replace('proposed', '')).trim();
      html += `  <a href="${previewBase}/deliverables/${file}"><span class="badge badge--orange">Standalone</span> ${htmlEscape(label)}</a>\n`;
    }
  }

  return html || '  <span style="color:var(--dim)">No prototypes yet</span>';
}

function hasPrototypes(repoDir) {
  try {
    return fs.readdirSync(path.join(repoDir, 'deliverables')).some((f) => f.startsWith('prototype-') && f.endsWith('.html'));
  } catch {
    return false;
  }
}

export function buildHub({ repoConfig, domain, stateDir, repoDir, template, now = new Date() }) {
  const { owner, repo, branch } = repoConfig;
  const previewBase = `https://${branch}--${repo}--${owner}.aem.page`;
  const hubDir = path.join(stateDir, 'hub');

  const discovery = loadText(path.join(stateDir, 'of1-discovery-output.md'));
  const daTemplateNames = loadLines(path.join(hubDir, 'da-templates.txt'));
  const daKnowledge = loadLines(path.join(hubDir, 'da-knowledge.txt'));
  const edsPages = findEdsPages(repoDir, path.join(hubDir, 'da-pages.txt'), previewBase);
  const dateStr = `${MONTH_NAMES[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')}, ${now.getFullYear()}`;

  const replacements = {
    '{{DOMAIN}}': htmlEscape(domain),
    '{{FOCUS}}': htmlEscape(extractFocus(discovery)),
    '{{NARRATIVE}}': htmlEscape(extractNarrative(discovery)),
    '{{OF1_URL}}': `${previewBase}/of1`,
    '{{DA_TEMPLATES_URL}}': `https://da.live/#/${owner}/${repo}/templates`,
    '{{DA_TEMPLATES}}': renderDaTemplates(daTemplateNames, owner, repo, previewBase),
    '{{DA_KNOWLEDGE}}': renderDaKnowledge(daKnowledge, owner, repo, previewBase),
    '{{CONFIG_LINKS}}': renderConfigLinks({ owner, repo, previewBase }),
    '{{STATUS_PANEL}}': renderStatusPanel({
      statuses: loadStatuses(stateDir),
      sync: loadJsonOrNull(path.join(hubDir, 'sync.json')),
      status: loadJsonOrNull(path.join(hubDir, 'status.json')),
    }),
    '{{PREVIEW_BASE}}': previewBase,
    '{{DISCOVERY}}': renderDiscovery(repoDir, previewBase),
    '{{PROTOTYPES}}': renderPrototypes(repoDir, previewBase),
    '{{EDS_PAGES}}': renderEdsPages(edsPages),
    '{{OWNER}}': htmlEscape(owner),
    '{{REPO}}': htmlEscape(repo),
    '{{BRANCH}}': htmlEscape(branch),
    '{{DATE}}': dateStr,
    '{{PIPELINE_AUDIT}}': renderAudit(stateDir),
  };

  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }
  return html;
}

function main() {
  if (process.argv.length < 4) {
    console.log('Usage: fill-demo-hub.mjs <repo-dir> <domain>');
    return 1;
  }

  const repoDir = process.argv[2];
  const domain = process.argv[3];

  const stateDir = process.env.OF1_STATE_DIR || '/shared/of1-demo-orchestrator';
  const repoConfigPath = path.join(stateDir, 'repo-config.json');
  const repoConfig = loadJson(repoConfigPath);
  if (!repoConfig || Object.keys(repoConfig).length === 0) {
    console.error(
      `ERROR: ${repoConfigPath} is missing or empty. Run of1-check-dependencies first to write it.`,
    );
    return 1;
  }
  const missing = ['owner', 'repo', 'branch'].filter((k) => !repoConfig[k]);
  if (missing.length) {
    console.error(`ERROR: ${repoConfigPath} is missing required field(s): [${missing.map((m) => `'${m}'`).join(', ')}]`);
    return 1;
  }

  // Discovery output is optional (standalone / content-only runs have none). Only
  // warn when the full pipeline evidently ran (prototypes exist) yet it's missing.
  const discoveryPath = path.join(stateDir, 'of1-discovery-output.md');
  if (!loadText(discoveryPath) && hasPrototypes(repoDir)) {
    console.error(`WARN: ${discoveryPath} not found or empty — demo focus/narrative will fall back to defaults.`);
  }
  const hubDir = path.join(stateDir, 'hub');
  for (const f of ['sync.json', 'status.json', 'da-pages.txt', 'da-templates.txt', 'da-knowledge.txt']) {
    if (!fs.existsSync(path.join(hubDir, f))) console.error(`WARN: ${path.join(hubDir, f)} not found — that hub section will be empty.`);
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const template = fs.readFileSync(path.join(scriptDir, 'demo-hub.html'), 'utf8');
  const html = buildHub({ repoConfig, domain, stateDir, repoDir, template });

  const outDir = path.join(repoDir, 'deliverables');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'index.html');
  fs.writeFileSync(outPath, html);

  console.log(`✓ Demo hub written to ${outPath}`);
  return 0;
}

// Compare against the realpath: Node resolves import.meta.url through
// symlinks, but argv[1] keeps the symlinked path (symlinked installs are common).
function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.exit(main());
}
