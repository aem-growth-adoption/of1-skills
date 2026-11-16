import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'blocks');
export const BLOCKS = ['of1', 'decision'];

const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((o, p) => o?.[p], obj);
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && typeof v.value === 'string') return v.value;
  }
  return undefined;
};

export function styleFromDesign(css, design) {
  const map = {
    '--of1-primary': pick(design, 'colors.primary', 'color.primary', 'palette.primary'),
    '--of1-accent': pick(design, 'colors.accent', 'colors.primary', 'color.accent', 'color.primary', 'palette.accent', 'palette.primary'),
    '--of1-text': pick(design, 'colors.text', 'color.text', 'palette.text'),
    '--of1-surface': pick(design, 'colors.background', 'colors.surface', 'color.background', 'palette.background'),
    '--of1-font-heading': pick(design, 'typography.heading', 'typography.headingFont', 'typography.fonts.heading', 'fonts.heading'),
    '--of1-font-body': pick(design, 'typography.body', 'typography.bodyFont', 'typography.fonts.body', 'fonts.body'),
  };
  let out = css;
  for (const [name, value] of Object.entries(map)) {
    if (!value) continue;
    out = out.replace(new RegExp(`(${name}:\\s*)[^;]+;`), (_, p) => `${p}${value};`);
  }
  return out;
}

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
    const i = args.indexOf('--design');
    let files;
    if (i >= 0) {
      const design = JSON.parse(fs.readFileSync(args[i + 1], 'utf8'));
      const css = fs.readFileSync(path.join(ASSETS, name, `${name}.css`), 'utf8');
      files = { [`${name}.js`]: fs.readFileSync(path.join(ASSETS, name, `${name}.js`), 'utf8'), [`${name}.css`]: styleFromDesign(css, design) };
    }
    return { result: { block: name, status: installBlock({ repoDir: process.cwd(), name, files, overwrite: args.includes('--overwrite') }) } };
  },
};
