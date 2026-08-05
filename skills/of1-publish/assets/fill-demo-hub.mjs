#!/usr/bin/env node
// Fill the demo-hub.html template with data from the OF1 demo pipeline.
//
// Usage (always cd into repo first):
//   node fill-demo-hub.mjs <repo-dir> <domain>
//
// Args:
//   repo-dir: Path to repo root (use "." when already cd'd in)
//   domain:   The demo domain name
//
// Reads:
//   $OF1_STATE_DIR/repo-config.json (default /shared/of1-demo-orchestrator)
//   $OF1_STATE_DIR/step-3-output.md (first paragraph of narrative)
//   of1/config/{products,personas,suggestions,templates}.json
//   stardust/current/assets/logo.svg (optional)
//   DA content pages (/tmp/da-pages.txt, or content/*.html fallback)
//
// Writes: deliverables/index.html

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function loadText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    return '';
  }
}

function countTemplates(repoDir) {
  const tplDir = path.join(repoDir, 'templates');
  if (!fs.existsSync(tplDir)) return 0;
  return fs.readdirSync(tplDir).filter((f) => f.startsWith('of1-') && f.endsWith('.html')).length;
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

  const totalTokens = audit.totalTokens || 0;
  const totalDuration = audit.totalDurationMs || 0;
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
    html += `<td style="padding:6px 8px;">${s.stage ?? s.step ?? '?'}</td>`;
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
      html += `  <div style="color:var(--orange);margin-bottom:4px;">Stage ${imp.stage ?? imp.step ?? '?'} — ${htmlEscape(imp.issue ?? '')}</div>\n`;
      html += `  <div style="color:var(--dim);">${htmlEscape(imp.suggestion ?? '')}</div>\n`;
      html += '</div>\n';
    }
    html += '</div>\n';
  }

  return html;
}

function extractNarrative(step3Output) {
  const lines = step3Output.split('\n');
  let inNarrative = false;
  const narrativeLines = [];
  for (const line of lines) {
    if (line.includes('**Persona:**') || line.includes('**Journey:**')) {
      inNarrative = true;
      narrativeLines.push(line.replace('**Persona:**', '').replace('**Journey:**', '').trim());
    } else if (inNarrative && line.trim() === '') {
      break;
    } else if (inNarrative) {
      narrativeLines.push(line.trim());
    }
  }
  return narrativeLines.length ? narrativeLines.join(' ') : 'Demo narrative not available.';
}

function extractFocus(step3Output) {
  const lines = step3Output.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    if (lines[idx].includes('## Demo Focus')) {
      if (idx + 1 < lines.length) {
        return lines[idx + 1].trim();
      }
    }
  }
  return 'AI-Powered Experience';
}

function getLogoSvg(repoDir) {
  const logoPath = path.join(repoDir, 'stardust', 'current', 'assets', 'logo.svg');
  if (fs.existsSync(logoPath)) {
    let svg = fs.readFileSync(logoPath, 'utf8').trim();
    if (!svg.includes('height=')) {
      svg = svg.replace('<svg', '<svg height="28"', 1);
    }
    return svg;
  }
  return '';
}

function findEdsPages(repoDir, branch, owner, repo) {
  const previewBase = `https://${branch}--${repo}--${owner}.aem.page`;
  const pages = [];

  const pagesFile = '/tmp/da-pages.txt';
  if (fs.existsSync(pagesFile)) {
    const text = fs.readFileSync(pagesFile, 'utf8').trim();
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const name = path.basename(line, path.extname(line));
      if (name === 'nav' || name === 'footer') continue;
      const label = titleCase(name.replace(/-/g, ' ').replace('prototype ', ''));
      pages.push({ url: `${previewBase}/${name}`, label });
    }
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
        pages.push({ url: `${previewBase}/${slug}`, label });
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

function renderPrototypes(repoDir, previewBase) {
  let html = '';
  const protoDir = path.join(repoDir, 'stardust', 'current', 'prototypes');
  const delivDir = path.join(repoDir, 'deliverables');

  if (fs.existsSync(protoDir)) {
    const files = fs
      .readdirSync(protoDir)
      .filter((f) => f.endsWith('.html'))
      .sort();
    for (const file of files) {
      const stem = path.basename(file, '.html');
      const label = titleCase(stem.replace(/-/g, ' ').replace('prototype ', ''));
      html += `  <a href="${previewBase}/deliverables/prototype-${stem}.html"><span class="badge badge--orange">Standalone</span> ${htmlEscape(label)}</a>\n`;
    }
  }

  if (!html && fs.existsSync(delivDir)) {
    const files = fs
      .readdirSync(delivDir)
      .filter((f) => f.startsWith('prototype-') && f.endsWith('.html'))
      .sort();
    for (const file of files) {
      const stem = path.basename(file, '.html');
      const label = titleCase(stem.replace('prototype-', '').replace(/-/g, ' '));
      html += `  <a href="${previewBase}/deliverables/${file}"><span class="badge badge--orange">Standalone</span> ${htmlEscape(label)}</a>\n`;
    }
  }

  return html || '  <span style="color:var(--dim)">No prototypes yet</span>';
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
  const owner = repoConfig.owner;
  const repo = repoConfig.repo;
  const branch = repoConfig.branch;

  const previewBase = `https://${branch}--${repo}--${owner}.aem.page`;

  let products = loadJson(path.join(repoDir, 'of1', 'config', 'products.json'));
  if (products !== null && typeof products === 'object' && !Array.isArray(products)) {
    products = products.products ?? [];
  }
  let personas = loadJson(path.join(repoDir, 'of1', 'config', 'personas.json'));
  if (personas !== null && typeof personas === 'object' && !Array.isArray(personas)) {
    personas = personas.personas ?? [];
  }
  const suggestions = loadJson(path.join(repoDir, 'of1', 'config', 'suggestions.json'));
  const templatesJson = loadJson(path.join(repoDir, 'of1', 'config', 'templates.json'));

  const step3 = loadText(path.join(stateDir, 'step-3-output.md'));
  const narrative = extractNarrative(step3);
  const focus = extractFocus(step3);
  void narrative;
  void focus;

  const numTemplates = countTemplates(repoDir);
  const numSuggestions =
    suggestions !== null && typeof suggestions === 'object' && !Array.isArray(suggestions)
      ? (suggestions.suggestions ?? []).length
      : 0;

  const edsPages = findEdsPages(repoDir, branch, owner, repo);

  const logoSvg = getLogoSvg(repoDir);
  void logoSvg;

  const of1Url = `${previewBase}/of1`;
  const galleryUrl = `${previewBase}/gallery/index.html`;

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.join(scriptDir, 'demo-hub.html');
  const template = fs.readFileSync(templatePath, 'utf8');

  const prototypesHtml = renderPrototypes(repoDir, previewBase);

  const now = new Date();
  const dateStr = `${MONTH_NAMES[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')}, ${now.getFullYear()}`;

  const replacements = {
    '{{DOMAIN}}': htmlEscape(domain),
    '{{NUM_PRODUCTS}}': String(products.length),
    '{{OF1_URL}}': of1Url,
    '{{GALLERY_URL}}': galleryUrl,
    '{{PREVIEW_BASE}}': previewBase,
    '{{PROTOTYPES}}': prototypesHtml,
    '{{EDS_PAGES}}': renderEdsPages(edsPages),
    '{{OWNER}}': owner,
    '{{REPO}}': repo,
    '{{BRANCH}}': branch,
    '{{DATE}}': dateStr,
    '{{PIPELINE_AUDIT}}': renderAudit(stateDir),
  };

  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }

  const outDir = path.join(repoDir, 'deliverables');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'index.html');
  fs.writeFileSync(outPath, html);

  console.log(`✓ Demo hub written to ${outPath}`);
  console.log(
    `  ${products.length} products, ${numTemplates} templates, ${personas.length} personas, ${numSuggestions} suggestions, ${edsPages.length} EDS pages`,
  );
  return 0;
}

process.exit(main());
