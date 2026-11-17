import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'blocks');
export const BLOCKS = ['of1', 'decision'];

const safe = (v) => (typeof v === 'string' && v.trim() && !/[;{}\n\r]/.test(v) ? v.trim() : undefined);

const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((o, p) => o?.[p], obj);
    const found = safe(v) ?? safe(v?.value) ?? safe(v?.family) ?? safe(v?.fontFamily);
    if (found) return found;
  }
  return undefined;
};

const unquote = (v) => {
  if (/^"(.*)"$/.test(v)) return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (/^'(.*)'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  return v;
};

const stripComment = (line) => {
  let q = '';
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
};

// YAML subset of a DESIGN.md frontmatter: nested maps by indentation and scalars.
// Lists and anything else unparseable are skipped.
export function parseFrontmatter(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === '---');
  if (start < 0) return {};
  const root = {};
  const stack = [{ indent: -1, obj: root, child: undefined }];
  for (const raw of lines.slice(start + 1)) {
    if (raw.trim() === '---') break;
    const line = stripComment(raw).replace(/\s+$/, '');
    if (!line.trim()) continue;
    const m = line.match(/^(\s*)("[^"]*"|'[^']*'|[^:\s][^:]*?):(?:\s+(.*))?$/);
    if (!m) continue;
    const indent = m[1].length;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const top = stack[stack.length - 1];
    top.child ??= indent;
    if (indent !== top.child) continue;
    const key = unquote(m[2].trim());
    const value = (m[3] ?? '').trim();
    if (value) top.obj[key] = unquote(value);
    else {
      top.obj[key] = {};
      stack.push({ indent, obj: top.obj[key], child: undefined });
    }
  }
  return root;
}

const lightness = (v) => {
  const m = String(v).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return undefined;
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1].slice(0, 6);
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return (Math.max(...rgb) + Math.min(...rgb)) / 2;
};

const str = (v) => (typeof v === 'string' ? v : undefined);
const font = (v) => str(v) ?? str(v?.fontFamily) ?? str(v?.family);

function colorsByRole(palette, meta) {
  const value = (name) => str(palette[name]) ?? str(meta[name]?.canonical);
  const primaryName = Object.keys(meta).find((n) => meta[n]?.role === 'primary');
  const neutrals = Object.keys(meta).filter((n) => meta[n]?.role === 'neutral')
    .map((n) => ({ value: value(n), l: lightness(value(n)) }))
    .filter((c) => c.l !== undefined)
    .sort((a, b) => b.l - a.l);
  const colors = {};
  if (primaryName && value(primaryName)) colors.primary = colors.accent = value(primaryName);
  if (!neutrals.length) return colors;
  const surface = neutrals[0];
  const text = neutrals[neutrals.length - 1];
  colors.surface = colors.background = surface.value;
  colors.text = text.value;
  const mids = neutrals.filter((c) => c !== surface && c !== text);
  if (mids.length) colors['text-muted'] = mids.reduce((a, b) => (Math.abs(b.l - 0.42) < Math.abs(a.l - 0.42) ? b : a)).value;
  const rest = neutrals.filter((c) => c !== surface);
  const border = rest.find((c) => c.l < 0.95) ?? rest[0];
  if (border && border !== text) colors.border = border.value;
  return colors;
}

// Builds the { colors, typography, rounded } shape styleFromDesign reads from a
// schemaVersion 2 pair (DESIGN.md frontmatter + DESIGN.json extensions), keeping
// any top-level DESIGN.json tokens as the fallback.
export function normalizeDesign(json = {}, fm = {}) {
  const palette = fm.colors && typeof fm.colors === 'object' ? fm.colors : {};
  const meta = json.extensions?.colorMeta ?? {};
  const colors = Object.keys(meta).length ? colorsByRole(palette, meta) : { ...palette };

  const t = fm.typography && typeof fm.typography === 'object' ? fm.typography : {};
  const typography = {};
  const heading = font(t.display) ?? font(t.headline) ?? font(t.h1) ?? font(t.heading);
  if (heading) typography.heading = heading;
  if (font(t.body)) typography.body = font(t.body);

  const r = fm.rounded && typeof fm.rounded === 'object' ? fm.rounded : {};
  const motif = json.extensions?.motifs?.borderRadius ?? {};
  const fixed = Object.values(r).filter((v) => typeof v === 'string' && !v.includes('%') && !Number.isNaN(parseFloat(v)))
    .sort((a, b) => parseFloat(a) - parseFloat(b));
  const rounded = {};
  const md = str(r.md) ?? str(motif.primary) ?? fixed[0];
  const pill = str(motif.pill) ?? str(r.pill);
  if (md) rounded.md = md;
  if (pill) rounded.pill = pill;

  return {
    ...json,
    colors: { ...json.colors, ...colors },
    typography: { ...json.typography, ...typography },
    rounded: { ...json.rounded, ...rounded },
  };
}

export function loadDesign(jsonPath) {
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const md = path.join(path.dirname(jsonPath), 'DESIGN.md');
  if (!fs.existsSync(md)) return json;
  return normalizeDesign(json, parseFrontmatter(fs.readFileSync(md, 'utf8')));
}

function applyDesign(css, design) {
  const map = {
    '--of1-primary': pick(design, 'colors.primary', 'color.primary', 'palette.primary'),
    '--of1-primary-hover': pick(design, 'colors.primary-hover'),
    '--of1-accent': pick(design, 'colors.accent', 'colors.primary', 'color.accent', 'color.primary', 'palette.accent', 'palette.primary'),
    '--of1-text': pick(design, 'colors.text', 'color.text', 'palette.text'),
    '--of1-text-secondary': pick(design, 'colors.text-muted'),
    '--of1-surface': pick(design, 'colors.surface', 'colors.background', 'color.background', 'palette.background'),
    '--of1-border': pick(design, 'colors.border'),
    '--of1-radius-card': pick(design, 'rounded.md'),
    '--of1-radius-pill': pick(design, 'rounded.pill'),
    '--of1-font-heading': pick(design, 'typography.heading', 'typography.headingFont', 'typography.fonts.heading', 'fonts.heading'),
    '--of1-font-body': pick(design, 'typography.body', 'typography.bodyFont', 'typography.fonts.body', 'fonts.body'),
  };
  let out = css;
  let mapped = 0;
  // stylelint-config-standard (color-hex-length) rejects #aabbcc where #abc says the same.
  const shortHex = (v) => v.replace(/#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3\b/gi, '#$1$2$3');
  for (const [name, value] of Object.entries(map)) {
    if (!value) continue;
    const re = new RegExp(`(${name}:\\s*)[^;]+;`);
    if (!re.test(out)) continue;
    out = out.replace(re, (_, p) => `${p}${shortHex(value)};`);
    mapped += 1;
  }
  return { css: out, mapped };
}

export const styleFromDesign = (css, design) => applyDesign(css, design).css;

export function installBlock({ repoDir, name, files, overwrite = false }) {
  if (!BLOCKS.includes(name)) throw new Error(`Unknown block "${name}" (${BLOCKS.join('|')})`);
  const src = path.join(ASSETS, name);
  const content = files ?? Object.fromEntries(fs.readdirSync(src).map((f) => [f, fs.readFileSync(path.join(src, f), 'utf8')]));
  const dest = path.join(repoDir, 'blocks', name);
  const present = Object.keys(content).some((f) => fs.existsSync(path.join(dest, f)));
  if (present && !overwrite) return 'exists';
  fs.mkdirSync(dest, { recursive: true });
  for (const [f, text] of Object.entries(content)) fs.writeFileSync(path.join(dest, f), text);
  return present ? 'updated' : 'installed';
}

export const blockCommands = {
  'install-block': async (args) => {
    const [name] = args;
    if (!BLOCKS.includes(name)) throw new Error(`Unknown block "${name}" (${BLOCKS.join('|')})`);
    const i = args.indexOf('--design');
    let files;
    let mapped;
    if (i >= 0) {
      const design = loadDesign(args[i + 1]);
      mapped = 0;
      files = Object.fromEntries(fs.readdirSync(path.join(ASSETS, name)).map((f) => {
        const text = fs.readFileSync(path.join(ASSETS, name, f), 'utf8');
        if (!f.endsWith('.css')) return [f, text];
        const styled = applyDesign(text, design);
        mapped += styled.mapped;
        return [f, styled.css];
      }));
    }
    const status = installBlock({ repoDir: process.cwd(), name, files, overwrite: args.includes('--overwrite') });
    return { result: { block: name, status, ...(files ? { design: { mapped } } : {}) } };
  },
};
