#!/usr/bin/env node
/**
 * fill-brand-review.mjs — mechanical brand-review.html generator
 *
 * Usage:
 *     node fill-brand-review.mjs <repo-dir> <domain>
 *
 * Args:
 *     repo-dir  Path to the repo root (contains stardust/current/DESIGN.json)
 *     domain    Demo domain name displayed in the report header
 *
 * Output:
 *     <repo-dir>/deliverables/brand-review.html
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── helpers ──────────────────────────────────────────────────────────────────

function safeGet(obj, keys, defaultValue = '') {
  let val = obj;
  for (const key of keys) {
    if (typeof val !== 'object' || val === null) return defaultValue;
    val = val[key];
  }
  return val === undefined || val === '' ? defaultValue : val;
}

function hexLuminance(hexColor) {
  let h = hexColor.replace(/^#/, '');
  if (h.length !== 3 && h.length !== 6) return 0.5;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return 0.5;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function textOnColor(hexColor) {
  return hexLuminance(hexColor) > 0.5 ? '#1C1917' : '#F5F0E8';
}

const GOOGLE_FONT_FAMILIES = new Set([
  'roboto', 'open sans', 'lato', 'montserrat', 'oswald', 'raleway',
  'poppins', 'merriweather', 'ubuntu', 'nunito', 'inter', 'playfair display',
  'source sans pro', 'pt sans', 'lora', 'noto sans', 'rubik', 'work sans',
  'titillium web', 'fira sans', 'barlow', 'josefin sans', 'mukta',
  'dm sans', 'mulish', 'exo 2', 'outfit', 'quicksand', 'manrope',
  'cormorant garamond', 'libre baskerville', 'crimson text', 'eb garamond',
  'spectral', 'baskerville', 'garamond', 'times new roman', 'georgia',
  'jetbrains mono', 'fira mono', 'source code pro', 'inconsolata',
  'space mono', 'courier prime', 'dm mono',
]);

function firstFontName(familyString) {
  return familyString.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
}

function looksLikeGoogleFont(familyString) {
  return GOOGLE_FONT_FAMILIES.has(firstFontName(familyString).toLowerCase());
}

function googleFontLink(familyString) {
  const name = firstFontName(familyString);
  const encoded = name.replace(/ /g, '+');
  const href = `https://fonts.googleapis.com/css2?family=${encoded}`
    + ':ital,wght@0,300;0,400;0,600;0,700;1,400&display=swap';
  return `<link href="${href}" rel="stylesheet">`;
}

// ── section generators ────────────────────────────────────────────────────────

function buildColorSwatches(colors) {
  if (!colors || Object.keys(colors).length === 0) {
    return '<div class="empty-state">No color data extracted.</div>';
  }

  const items = [];
  for (const [name, hexVal] of Object.entries(colors)) {
    if (!hexVal) continue;
    const textColor = textOnColor(hexVal);
    items.push(
      '<div class="swatch">'
      + `  <div class="swatch-color" style="background:${hexVal};"></div>`
      + '  <div class="swatch-info">'
      + `    <span class="swatch-name">${name}</span>`
      + `    <span class="swatch-hex">${hexVal}</span>`
      + '  </div>'
      + '</div>',
    );
  }

  return `<div class="swatches-grid">${items.join('')}</div>`;
}

function buildTypographySection(typography) {
  if (!typography || Object.keys(typography).length === 0) {
    return ['<div class="empty-state">No typography data extracted.</div>', []];
  }

  const fontLinks = [];
  const cards = [];

  for (const role of ['heading', 'body']) {
    const t = typography[role] || {};
    const family = safeGet(t, ['family'], '(not extracted)');
    const weight = safeGet(t, ['weight'], '400');
    const style = safeGet(t, ['style'], 'normal');

    if (looksLikeGoogleFont(family)) fontLinks.push(googleFontLink(family));

    const fontCss = `font-family:${family};font-weight:${weight};font-style:${style};`;

    let preview;
    let label;
    if (role === 'heading') {
      preview = `<div class="typo-preview-heading" style="${fontCss}">The quick brown fox jumps</div>`;
      label = 'Heading Font';
    } else {
      preview = `<div class="typo-preview-body" style="${fontCss}">The quick brown fox jumps over the lazy dog. Bright vixens jump; dozy fowl quack.</div>`;
      label = 'Body Font';
    }

    const firstName = firstFontName(family);
    cards.push(
      '<div class="typo-card">'
      + `  <div class="typo-label">${label}</div>`
      + `  ${preview}`
      + '  <div class="typo-meta">'
      + `    <span><b>Family:</b> ${firstName}</span>`
      + `    <span><b>Stack:</b>  ${family}</span>`
      + `    <span><b>Weight:</b> ${weight}</span>`
      + `    <span><b>Style:</b>  ${style}</span>`
      + '  </div>'
      + '</div>',
    );
  }

  const html = `<div class="typo-grid">${cards.join('')}</div>`;
  return [html, fontLinks];
}

function buildShapesSection(shapes, spacing) {
  const parts = [];

  if (shapes) {
    const shapeCards = [];
    for (const [key, props] of Object.entries(shapes)) {
      if (typeof props !== 'object' || props === null) continue;
      const radius = props.borderRadius || '0px';
      shapeCards.push(
        '<div class="shape-card">'
        + `  <span class="shape-label">${key}</span>`
        + `  <div class="shape-preview-box" style="border-radius:${radius};"></div>`
        + `  <span class="shape-value">border-radius: ${radius}</span>`
        + '</div>',
      );
    }
    if (shapeCards.length) parts.push(`<div class="shapes-grid">${shapeCards.join('')}</div>`);
  }

  if (spacing) {
    const spacingCards = [];
    for (const [key, val] of Object.entries(spacing)) {
      if (val) {
        spacingCards.push(
          '<div class="spacing-card">'
          + `  <div class="spacing-label">${key}</div>`
          + `  <div class="spacing-value">${val}</div>`
          + '</div>',
        );
      }
    }
    if (spacingCards.length) {
      parts.push(
        '<h3 style="font-family:var(--font-head);font-weight:400;'
        + 'font-size:1.1rem;color:var(--fg-dim);margin:28px 0 12px;">Spacing</h3>'
        + `<div class="spacing-grid">${spacingCards.join('')}</div>`,
      );
    }
  }

  if (!parts.length) return '<div class="empty-state">No shape or spacing data extracted.</div>';

  return parts.join('');
}

function buildLogoSection(logoSvgContent) {
  if (!logoSvgContent) {
    return '<div class="logo-well"><p class="logo-not-found">Logo SVG not found.</p></div>';
  }

  let svg = logoSvgContent.replace(/<\?xml[^>]*\?>/, '');
  svg = svg.replace(/<!DOCTYPE[^>]*>/i, '');
  svg = svg.trim();

  return '<div class="logo-well">'
    + '  <div class="logo-variants">'
    + '    <div>'
    + '      <div class="logo-variant-label">On Dark</div>'
    + `      <div class="logo-on-dark logo-display">${svg}</div>`
    + '    </div>'
    + '    <div>'
    + '      <div class="logo-variant-label">On Light</div>'
    + `      <div class="logo-on-light logo-display">${svg}</div>`
    + '    </div>'
    + '  </div>'
    + '</div>';
}

function buildScreenshotsSection(screenshotPaths) {
  if (!screenshotPaths || !screenshotPaths.length) {
    return '<div class="empty-state">No screenshots found.</div>';
  }

  const items = screenshotPaths.map(([webPath, caption]) => (
    '<div class="screenshot-item">'
    + `  <div class="screenshot-caption">${caption}</div>`
    + `  <img src="${webPath}" alt="Screenshot: ${caption}" loading="lazy">`
    + '</div>'
  ));

  return `<div class="screenshots-list">${items.join('')}</div>`;
}

// ── main ──────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: fill-brand-review.mjs <repo-dir> <domain>');
    process.exit(1);
  }

  const repoDir = path.resolve(args[0]);
  const domain = args[1];

  // ── Locate DESIGN.json ────────────────────────────────────────────────────
  let designPath = path.join(repoDir, 'stardust', 'current', 'DESIGN.json');
  if (!fs.existsSync(designPath)) {
    const alt = path.join(repoDir, 'deliverables', 'DESIGN.json');
    if (fs.existsSync(alt)) {
      designPath = alt;
    } else {
      console.error(`ERROR: DESIGN.json not found at ${designPath}`);
      process.exit(1);
    }
  }

  const design = JSON.parse(fs.readFileSync(designPath, 'utf-8'));

  const colors = design.colors || {};
  const typography = design.typography || {};
  const shapes = design.shapes || {};
  const spacing = design.spacing || {};

  // ── Locate logo SVG ───────────────────────────────────────────────────────
  const logoCandidates = [
    path.join(repoDir, 'stardust', 'current', 'assets', 'logo.svg'),
    path.join(repoDir, 'deliverables', 'assets', 'logo.svg'),
    path.join(repoDir, 'stardust', 'current', 'logo.svg'),
  ];
  let logoSvgContent = null;
  for (const candidate of logoCandidates) {
    if (fs.existsSync(candidate)) {
      logoSvgContent = fs.readFileSync(candidate, 'utf-8');
      break;
    }
  }

  // ── Locate screenshots ────────────────────────────────────────────────────
  const deliverablesDir = path.join(repoDir, 'deliverables');
  const screenshotsDeliver = path.join(deliverablesDir, 'assets', 'screenshots');
  const screenshotsStardust = path.join(repoDir, 'stardust', 'current', 'assets', 'screenshots');

  fs.mkdirSync(screenshotsDeliver, { recursive: true });

  if (fs.existsSync(screenshotsStardust)) {
    const pngs = fs.readdirSync(screenshotsStardust).filter((f) => f.endsWith('.png')).sort();
    for (const png of pngs) {
      const src = path.join(screenshotsStardust, png);
      const dest = path.join(screenshotsDeliver, png);
      if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    }
  }

  const screenshotPaths = [];
  if (fs.existsSync(screenshotsDeliver)) {
    const pngs = fs.readdirSync(screenshotsDeliver).filter((f) => f.endsWith('.png')).sort();
    for (const png of pngs) {
      const webPath = `/deliverables/assets/screenshots/${png}`;
      const stem = png.replace(/\.png$/, '');
      const caption = stem.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      screenshotPaths.push([webPath, caption]);
    }
  }

  // ── Build HTML fragments ──────────────────────────────────────────────────
  const colorSwatchesHtml = buildColorSwatches(colors);
  const [typographyHtml, extraFontLinks] = buildTypographySection(typography);
  const shapesHtml = buildShapesSection(shapes, spacing);
  const logoHtml = buildLogoSection(logoSvgContent);
  const screenshotsHtml = buildScreenshotsSection(screenshotPaths);

  const timestamp = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;

  const extraFontLinksHtml = [...new Set(extraFontLinks)].join('\n  ');

  // ── Load template ─────────────────────────────────────────────────────────
  const templateCandidates = [
    '/shared/brand-review-template.html',
    path.join(repoDir, 'tools', 'brand-review-template.html'),
    path.join(__dirname, 'brand-review-template.html'),
  ];
  let templatePath = null;
  for (const candidate of templateCandidates) {
    if (fs.existsSync(candidate)) {
      templatePath = candidate;
      break;
    }
  }

  if (templatePath === null) {
    console.error('ERROR: brand-review-template.html not found.');
    process.exit(1);
  }

  const template = fs.readFileSync(templatePath, 'utf-8');

  // ── Fill placeholders ─────────────────────────────────────────────────────
  let output = template;
  output = output.replace('{{DOMAIN}}', domain);
  output = output.replace('{{TIMESTAMP}}', timestamp);
  output = output.replace('{{EXTRA_FONT_LINKS}}', extraFontLinksHtml);
  output = output.replace('{{COLOR_SWATCHES}}', colorSwatchesHtml);
  output = output.replace('{{TYPOGRAPHY_SECTION}}', typographyHtml);
  output = output.replace('{{SHAPES_SECTION}}', shapesHtml);
  output = output.replace('{{LOGO_SECTION}}', logoHtml);
  output = output.replace('{{SCREENSHOTS_SECTION}}', screenshotsHtml);

  // ── Write output ──────────────────────────────────────────────────────────
  const outPath = path.join(deliverablesDir, 'brand-review.html');
  fs.mkdirSync(deliverablesDir, { recursive: true });
  fs.writeFileSync(outPath, output, 'utf-8');

  console.log(`✓  Brand review written to: ${outPath}`);
  console.log(`   Colors:       ${Object.keys(colors).length} extracted`);
  console.log(`   Fonts:        ${Object.keys(typography).length} extracted`);
  console.log(`   Logo:         ${logoSvgContent ? 'found' : 'not found'}`);
  console.log(`   Screenshots:  ${screenshotPaths.length} found`);
}

main();
