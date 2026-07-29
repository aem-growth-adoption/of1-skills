// fill-demo-hub.jsh — Fill the demo-hub.html template with data from the OF1 demo pipeline.
//
// Usage:
//   fill-demo-hub.jsh <repo-dir> <domain>
//
// Reads:
//   /shared/of1-demo-orchestrator/repo-config.json
//   /shared/of1-demo-orchestrator/step-3-output.md
//   of1/config/{products,personas,suggestions,templates}.json
//   stardust/current/assets/logo.svg (optional)
//
// Writes: deliverables/index.html

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadJson(path) {
  try {
    const content = await fs.readFile(path);
    return JSON.parse(content);
  } catch (e) { return {}; }
}

async function loadText(path) {
  try { return await fs.readFile(path); } catch (e) { return ''; }
}

async function countTemplates(repoDir) {
  try {
    const { stdout: result } = await exec(`ls ${repoDir}/templates/of1-*.html 2>/dev/null | wc -l`);
    return parseInt(result.trim(), 10) || 0;
  } catch (e) { return 0; }
}

function renderAudit(audit) {
  if (!audit || !audit.steps) return '';

  const totalTokens = audit.totalTokens || 0;
  const totalDuration = audit.totalDurationMs || 0;
  const totalMins = totalDuration / 60000;
  const stepCount = audit.stepCount || audit.steps.length;
  const skillVersion = audit.skillVersion || 'unknown';
  const skillBranch = audit.skillBranch || 'unknown';

  let html = '<h2>Pipeline Audit</h2>\n';
  html += `<p style="font-size:11px;color:var(--dim);margin-bottom:12px;">Skills: ${escapeHtml(skillBranch)}@${escapeHtml(skillVersion)}</p>\n`;
  html += '<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px;">\n';
  html += `  <div style="font-size:12px;color:var(--dim);">Total tokens<br><span style="font-size:20px;color:var(--fg);">${totalTokens.toLocaleString()}</span></div>\n`;
  html += `  <div style="font-size:12px;color:var(--dim);">Wall clock<br><span style="font-size:20px;color:var(--fg);">${totalMins.toFixed(1)} min</span></div>\n`;
  html += `  <div style="font-size:12px;color:var(--dim);">Dispatches<br><span style="font-size:20px;color:var(--fg);">${stepCount}</span></div>\n`;
  html += '</div>\n';

  html += '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:24px;">\n';
  html += '<tr style="text-align:left;color:var(--dim);border-bottom:1px solid var(--border);">';
  html += '<th style="padding:6px 8px;">Step</th><th>Name</th><th>Model</th>';
  html += '<th style="text-align:right;">Tokens</th><th style="text-align:right;">Duration</th>';
  html += '<th>Status</th></tr>\n';

  for (const s of audit.steps) {
    const durS = (s.durationMs || 0) / 1000;
    const tokens = s.totalTokens || 0;
    const status = s.status || '?';
    const statusColor = status === 'done' ? 'var(--accent)' : (status === 'failed' ? 'var(--orange)' : 'var(--dim)');
    const retries = s.retries || 0;
    const retryBadge = retries > 0 ? ` <span style="color:var(--orange);">↻${retries}</span>` : '';

    html += `<tr style="border-bottom:1px solid var(--border);">`;
    html += `<td style="padding:6px 8px;">${s.step || '?'}</td>`;
    html += `<td>${escapeHtml(s.name || '')}</td>`;
    html += `<td>${escapeHtml(s.model || '')}</td>`;
    html += `<td style="text-align:right;">${tokens.toLocaleString()}</td>`;
    html += `<td style="text-align:right;">${durS.toFixed(0)}s</td>`;
    html += `<td style="color:${statusColor};">${status}${retryBadge}</td>`;
    html += '</tr>\n';
  }
  html += '</table>\n';

  const improvements = audit.improvements || [];
  if (improvements.length > 0) {
    html += '<h2>Improvements</h2>\n';
    html += '<div style="display:flex;flex-direction:column;gap:12px;">\n';
    for (const imp of improvements) {
      html += '<div style="padding:12px 16px;border:1px solid var(--border);border-radius:6px;font-size:12px;">\n';
      html += `  <div style="color:var(--orange);margin-bottom:4px;">Step ${imp.step || '?'} — ${escapeHtml(imp.issue || '')}</div>\n`;
      html += `  <div style="color:var(--dim);">${escapeHtml(imp.suggestion || '')}</div>\n`;
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
  return narrativeLines.length > 0 ? narrativeLines.join(' ') : 'Demo narrative not available.';
}

function extractFocus(step3Output) {
  const lines = step3Output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('## Demo Focus') && i + 1 < lines.length) {
      return lines[i + 1].trim();
    }
  }
  return 'AI-Powered Experience';
}

async function getLogoSvg(repoDir) {
  try {
    let svg = (await fs.readFile(`${repoDir}/stardust/current/assets/logo.svg`)).trim();
    if (!svg.includes('height=')) {
      svg = svg.replace('<svg', '<svg height="28"');
    }
    return svg;
  } catch (e) { return ''; }
}

async function findEdsPages(repoDir, branch, owner, repo) {
  const previewBase = `https://${branch}--${repo}--${owner}.aem.page`;
  const pages = [];

  // Try pre-generated page list
  const pagesContent = await loadText('/tmp/da-pages.txt');
  if (pagesContent.trim()) {
    for (const line of pagesContent.trim().split('\n')) {
      if (!line.trim()) continue;
      const name = line.trim().split('/').pop().replace('.html', '');
      if (name === 'nav' || name === 'footer') continue;
      const label = name.replace(/-/g, ' ').replace(/prototype /g, '').replace(/\b\w/g, c => c.toUpperCase());
      pages.push({ url: `${previewBase}/${name}`, label });
    }
  }

  // Fallback: check stardust:deploy's flat content/ directory
  if (pages.length === 0) {
    try {
      const { stdout: result } = await exec(`find ${repoDir}/content -maxdepth 1 -name '*.html' 2>/dev/null || true`);
      for (const line of result.trim().split('\n').filter(Boolean).sort()) {
        const slug = line.split('/').pop().replace('.html', '');
        if (slug === 'nav' || slug === 'footer') continue;
        const label = slug.replace(/-/g, ' ').replace(/prototype /g, '').replace(/\b\w/g, c => c.toUpperCase());
        pages.push({ url: `${previewBase}/${slug}`, label });
      }
    } catch (e) { /* ignore */ }
  }

  return pages;
}

function renderEdsPages(pages) {
  if (pages.length === 0) return '  <span style="color:var(--dim)">No pages published yet</span>';
  return pages.map(p =>
    `  <a href="${p.url}"><span class="badge badge--green">AEM Preview</span> ${escapeHtml(p.label)}</a>`
  ).join('\n');
}

async function renderPrototypes(repoDir, previewBase) {
  let html = '';

  // Check stardust prototypes
  try {
    const { stdout: result } = await exec(`ls ${repoDir}/stardust/current/prototypes/*.html 2>/dev/null || true`);
    for (const line of result.trim().split('\n').filter(Boolean).sort()) {
      const name = line.split('/').pop().replace('.html', '');
      const label = name.replace(/-/g, ' ').replace(/prototype /g, '').replace(/\b\w/g, c => c.toUpperCase());
      html += `  <a href="${previewBase}/deliverables/prototype-${name}.html"><span class="badge badge--orange">Standalone</span> ${escapeHtml(label)}</a>\n`;
    }
  } catch (e) { /* ignore */ }

  // Fallback: check deliverables
  if (!html) {
    try {
      const { stdout: result } = await exec(`ls ${repoDir}/deliverables/prototype-*.html 2>/dev/null || true`);
      for (const line of result.trim().split('\n').filter(Boolean).sort()) {
        const filename = line.split('/').pop();
        const label = filename.replace('prototype-', '').replace('.html', '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        html += `  <a href="${previewBase}/deliverables/${filename}"><span class="badge badge--orange">Standalone</span> ${escapeHtml(label)}</a>\n`;
      }
    } catch (e) { /* ignore */ }
  }

  return html || '  <span style="color:var(--dim)">No prototypes yet</span>';
}

function renderConfigSummary(products, personas, suggestions, templatesJson) {
  const items = [];

  if (products.length > 0) {
    const productNames = products.slice(0, 4).map(p => p.name || '?');
    items.push(['Products', productNames.join(', ') + (products.length > 4 ? '...' : '')]);
  }
  if (personas.length > 0) {
    const personaNames = personas.slice(0, 3).map(p => p.name || '?');
    items.push(['Personas', personaNames.join(', ') + (personas.length > 3 ? '...' : '')]);
  }
  if (typeof suggestions === 'object' && !Array.isArray(suggestions)) {
    const chips = suggestions.suggestions || [];
    items.push(['Suggestion Chips', String(chips.length)]);
    if (suggestions.title) items.push(['Search Title', suggestions.title]);
  }
  if (typeof templatesJson === 'object' && templatesJson !== null) {
    const intents = templatesJson.intents || [];
    if (intents.length > 0) items.push(['Intents', intents.join(', ')]);
  }

  return items.map(([label, value]) =>
    `    <div class="config-item">\n      <div class="config-label">${escapeHtml(label)}</div>\n      <div class="config-value">${escapeHtml(String(value))}</div>\n    </div>`
  ).join('\n');
}

async function main() {
  if (process.argv.length < 3) {
    console.log('Usage: fill-demo-hub.jsh <repo-dir> <domain>');
    process.exit(1);
  }

  const repoDir = process.argv[1];
  const domain = process.argv[2];

  // Load repo config — REQUIRED
  const stateDir = process.env.OF1_STATE_DIR || '/shared/of1-demo-orchestrator';
  const repoConfigPath = `${stateDir}/repo-config.json`;
  const repoConfig = await loadJson(repoConfigPath);
  if (!repoConfig || Object.keys(repoConfig).length === 0) {
    console.error(`ERROR: ${repoConfigPath} is missing or empty. Run of1-check-dependencies first to write it.`);
    process.exit(1);
  }
  const missing = ['owner', 'repo', 'branch'].filter(k => !repoConfig[k]);
  if (missing.length > 0) {
    console.error(`ERROR: ${repoConfigPath} is missing required field(s): ${missing.join(', ')}`);
    process.exit(1);
  }
  const { owner, repo, branch } = repoConfig;
  const previewBase = `https://${branch}--${repo}--${owner}.aem.page`;

  // Load data
  let products = await loadJson(`${repoDir}/of1/config/products.json`);
  if (!Array.isArray(products)) products = products.products || [];
  let personas = await loadJson(`${repoDir}/of1/config/personas.json`);
  if (!Array.isArray(personas)) personas = personas.personas || [];
  const suggestions = await loadJson(`${repoDir}/of1/config/suggestions.json`);
  const templatesJson = await loadJson(`${repoDir}/of1/config/templates.json`);

  const step3 = await loadText(`${stateDir}/step-3-output.md`);
  const narrative = extractNarrative(step3);
  const focus = extractFocus(step3);

  const numTemplates = await countTemplates(repoDir);
  const numSuggestions = (typeof suggestions === 'object' && !Array.isArray(suggestions))
    ? (suggestions.suggestions || []).length : 0;

  // EDS pages
  const edsPages = await findEdsPages(repoDir, branch, owner, repo);

  // Logo
  const logoSvg = await getLogoSvg(repoDir);

  // URLs
  const of1Url = `${previewBase}/of1`;
  const galleryUrl = `${previewBase}/gallery/index.html`;

  // Load template
  const scriptDir = process.argv[0].replace(/\/[^/]+$/, '');
  const template = await fs.readFile(`${scriptDir}/demo-hub.html`);

  // Pipeline audit
  const audit = await loadJson(`${stateDir}/pipeline-audit.json`);
  const auditHtml = renderAudit(audit);

  // Render prototypes
  const prototypesHtml = await renderPrototypes(repoDir, previewBase);

  // Fill template
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  let html = template;
  html = html.split('{{DOMAIN}}').join(escapeHtml(domain));
  html = html.split('{{NUM_PRODUCTS}}').join(String(products.length));
  html = html.split('{{OF1_URL}}').join(of1Url);
  html = html.split('{{GALLERY_URL}}').join(galleryUrl);
  html = html.split('{{PREVIEW_BASE}}').join(previewBase);
  html = html.split('{{PROTOTYPES}}').join(prototypesHtml);
  html = html.split('{{EDS_PAGES}}').join(renderEdsPages(edsPages));
  html = html.split('{{OWNER}}').join(owner);
  html = html.split('{{REPO}}').join(repo);
  html = html.split('{{BRANCH}}').join(branch);
  html = html.split('{{DATE}}').join(dateStr);
  html = html.split('{{PIPELINE_AUDIT}}').join(auditHtml);

  // Write output
  const outPath = `${repoDir}/deliverables/index.html`;
  await fs.writeFile(outPath, html);

  console.log(`✓ Demo hub written to ${outPath}`);
  console.log(`  ${products.length} products, ${numTemplates} templates, ${personas.length} personas, ${numSuggestions} suggestions, ${edsPages.length} EDS pages`);
}

await main();
