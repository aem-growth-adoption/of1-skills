export const INTENTS = ['comparison', 'recommendation', 'deep-dive', 'budget', 'discovery'];
export const TARGETS = INTENTS.flatMap((intent) => [1, 2, 3].map((n) => ({ path: `/templates/${intent}-${n}`, intent })));

const templatePath = (p) => {
  const m = /(\/templates\/[^/]+?)(?:\.html)?$/.exec(String(p));
  return m ? m[1] : null;
};

export function planTemplates({ registered = [], daPaths = [] }) {
  const keep = registered.map((t) => t.path);
  const seen = new Set(keep);
  const register = [];
  for (const p of daPaths.map(templatePath)) {
    if (p && !seen.has(p)) { seen.add(p); register.push(p); }
  }
  const build = [];
  let total = seen.size;
  for (const t of TARGETS) {
    if (total >= TARGETS.length) break;
    if (!seen.has(t.path)) { build.push({ path: t.path, intent: t.intent }); total += 1; }
  }
  return { keep, register, build };
}
