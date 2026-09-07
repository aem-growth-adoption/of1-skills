# OF1 Knowledge Pages → Content RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During the crawl `of1-extract-content` already runs, capture each page's text, publish it as a bare DA doc under `/of1/knowledge/**`, and wire the tenant config so the gen-web content-RAG ingests it.

**Architecture:** One new standalone Node asset (`publish-knowledge-da.mjs`) renders captured page blocks into minimal EDS HTML and uploads+previews them to DA (mirroring `publish-config-da.mjs`). Three SKILL.md edits wire the capture, the tenant `contentIngestion` config + `helix-query.yaml` coverage, and a post-sync verification. The gen-web worker is unchanged — it already ingests `/of1/knowledge/**` via query-index discovery.

**Tech Stack:** Node (ES modules, `node --test`), DA admin API (`admin.da.live/source`, `admin.hlx.page/preview`), EDS query-index, of1-skills SKILL.md prose.

**Spec:** `docs/superpowers/specs/2026-08-28-of1-knowledge-pages-to-rag.md`

## Global Constraints

- Knowledge pages live under `/of1/knowledge/{slug}` — a separate namespace from the existing structured `of1-config` docs at `/of1/config/knowledge`. Never conflate them.
- Bare content only: `<h1>` title + `<h2>/<p>/<li>` blocks, **no EDS block tables** (no `<div class="...">` block markup).
- `contentIngestion` config value is exactly: `{ "enabled": true, "includePaths": ["/of1/knowledge/**"], "maxChunkTokens": 400, "contentTopK": 4 }`.
- Additive: structured products/features/faqs/knowledge extraction is unchanged.
- DA token resolution order (copy verbatim from `publish-config-da.mjs`): `--token-file` → `$DA_TOKEN` → `$ADOBE_IMS_TOKEN` → `$OF1_TOKEN_FILE` → `oauth-token adobe` → `.hlx/.da-token.json`.
- Node asset must keep the `import.meta.url === pathToFileURL(process.argv[1]).href` CLI guard so render helpers are importable by tests without running the upload path.
- No `git add -A` — stage explicit paths only.
- Tests for the Node asset: `node --test skills/of1-extract-content/assets/publish-knowledge-da.test.mjs` (run from the repo/worktree root). The SKILL.md tasks (2–4) are agent-instruction edits verified by structural grep + review, not unit tests.

---

### Task 1: `publish-knowledge-da.mjs` — render + upload knowledge pages

**Files:**
- Create: `skills/of1-extract-content/assets/publish-knowledge-da.mjs`
- Test: `skills/of1-extract-content/assets/publish-knowledge-da.test.mjs`

**Interfaces:**
- Consumes: an input manifest JSON `of1/config/knowledge-pages.json` — an array of `{ slug?: string, url?: string, title: string, blocks: Array<{ tag: "h1"|"h2"|"h3"|"p"|"li", text: string }> }`. (Written by Task 2's SKILL step.)
- Produces (exported for tests):
  - `slugify(input: string): string` — lowercased, non-alphanumerics → `-`, collapsed, trimmed; empty → `"page"`.
  - `resolveSlug(entry): string` — `entry.slug` if present, else `slugify(last path segment of entry.url)`.
  - `renderKnowledgeDoc(entry): string` — EDS HTML: `<body><header></header><main><div><h1>{title}</h1> + one tag per block …</div></main><footer></footer></body>`, all text HTML-escaped, empty-text blocks dropped, `li` runs wrapped in a single `<ul>`.
- Produces (side effects): uploads `of1/knowledge/{slug}.html` to DA, previews `of1/knowledge/{slug}`, writes created resource paths to `of1/config/knowledge-pages.txt` (one per line).

- [ ] **Step 1: Write the failing test**

```js
// skills/of1-extract-content/assets/publish-knowledge-da.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, resolveSlug, renderKnowledgeDoc } from './publish-knowledge-da.mjs';

test('slugify normalizes to url-safe slug', () => {
  assert.equal(slugify('Multi-Entity Accounting!'), 'multi-entity-accounting');
  assert.equal(slugify('  A / B  '), 'a-b');
  assert.equal(slugify(''), 'page');
});

test('resolveSlug prefers slug, else derives from url last segment', () => {
  assert.equal(resolveSlug({ slug: 'x', url: 'https://s/a/b' }), 'x');
  assert.equal(resolveSlug({ url: 'https://site.com/accounting/multi-entity' }), 'multi-entity');
});

test('renderKnowledgeDoc emits bare h1 + blocks, escaped, no block tables', () => {
  const html = renderKnowledgeDoc({
    title: 'Returns & Refunds',
    blocks: [
      { tag: 'h2', text: 'How to return' },
      { tag: 'p', text: 'Ship it <back> in 30 days.' },
      { tag: 'li', text: 'Step one' },
      { tag: 'li', text: 'Step two' },
      { tag: 'p', text: '' },
    ],
  });
  assert.match(html, /<h1>Returns &amp; Refunds<\/h1>/);
  assert.match(html, /<h2>How to return<\/h2>/);
  assert.match(html, /<p>Ship it &lt;back&gt; in 30 days\.<\/p>/);
  assert.match(html, /<ul><li>Step one<\/li><li>Step two<\/li><\/ul>/);
  assert.doesNotMatch(html, /class="/); // no EDS block tables
  assert.doesNotMatch(html, /<p><\/p>/); // empty block dropped
  assert.match(html, /^<body>/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test skills/of1-extract-content/assets/publish-knowledge-da.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `publish-knowledge-da.mjs`**

Copy the token/upload/preview plumbing verbatim from `publish-config-da.mjs` (`readTokenFile`, `resolveToken`, `escapeHtml`, `uploadDoc`, `triggerPreview`, and the CLI guard). Add the knowledge-specific renderers and `main`:

```js
#!/usr/bin/env node
// publish-knowledge-da.mjs — Publish captured page content as bare DA docs
// under of1/knowledge/{slug}, then EDS-preview them so {slug}.plain.html is
// live for the gen-web content-RAG (contentIngestion includePaths
// ["/of1/knowledge/**"]). Content, not craft: <h1> + <h2>/<p>/<li>, no blocks.
//
// Input:  of1/config/knowledge-pages.json  (array of {slug?,url?,title,blocks})
// Output: of1/knowledge/{slug}.html (DA) + preview; of1/config/knowledge-pages.txt
//
// Usage: node publish-knowledge-da.mjs --owner O --repo R --branch B
//        [--config-dir of1/config] [--knowledge-dir of1/knowledge]
//        [--token-file path] [--concurrency 8]
//
// Token resolution order: --token-file, $DA_TOKEN, $ADOBE_IMS_TOKEN,
// $OF1_TOKEN_FILE, `oauth-token adobe`, ./.hlx/.da-token.json.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execCb);

function readTokenFile(p) {
  const raw = fs.readFileSync(p, 'utf8').trim();
  try { return JSON.parse(raw).access_token || raw; } catch { return raw; }
}

async function resolveToken(tokenFileArg) {
  if (tokenFileArg) return readTokenFile(tokenFileArg);
  if (process.env.DA_TOKEN) return process.env.DA_TOKEN;
  if (process.env.ADOBE_IMS_TOKEN) return process.env.ADOBE_IMS_TOKEN;
  if (process.env.OF1_TOKEN_FILE) return readTokenFile(process.env.OF1_TOKEN_FILE);
  try {
    const { stdout } = await exec('oauth-token adobe');
    if (stdout.trim()) return stdout.trim();
  } catch { /* SLICC shim absent */ }
  if (fs.existsSync('.hlx/.da-token.json')) return readTokenFile('.hlx/.da-token.json');
  throw new Error('Could not resolve DA token. Pass --token-file, set $DA_TOKEN/$ADOBE_IMS_TOKEN, or place .hlx/.da-token.json.');
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function slugify(input) {
  const s = String(input || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'page';
}

export function resolveSlug(entry) {
  if (entry.slug) return slugify(entry.slug);
  let last = '';
  try { last = new URL(entry.url).pathname.split('/').filter(Boolean).pop() || ''; }
  catch { last = String(entry.url || '').split('/').filter(Boolean).pop() || ''; }
  return slugify(last);
}

const HEADINGS = new Set(['h1', 'h2', 'h3']);

export function renderKnowledgeDoc(entry) {
  const parts = [`<h1>${escapeHtml(entry.title || '')}</h1>`];
  const blocks = Array.isArray(entry.blocks) ? entry.blocks : [];
  let liRun = [];
  const flushLi = () => {
    if (liRun.length) { parts.push(`<ul>${liRun.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`); liRun = []; }
  };
  for (const b of blocks) {
    const text = String(b?.text || '').trim();
    if (!text) continue;
    const tag = HEADINGS.has(b.tag) ? b.tag : (b.tag === 'li' ? 'li' : 'p');
    if (tag === 'li') { liRun.push(text); continue; }
    flushLi();
    parts.push(`<${tag}>${escapeHtml(text)}</${tag}>`);
  }
  flushLi();
  return `<body>\n<header></header>\n<main>\n<div>\n${parts.join('\n')}\n</div>\n</main>\n<footer></footer>\n</body>`;
}

async function uploadDoc(html, token, owner, repo, docPath) {
  const boundary = '----DABoundary' + crypto.randomBytes(8).toString('hex');
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="data"; filename="${path.basename(docPath)}"\r\nContent-Type: text/html\r\n\r\n`;
  const body = `${header}${html}\r\n--${boundary}--\r\n`;
  const resp = await fetch(`https://admin.da.live/source/${owner}/${repo}/${docPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  return resp.ok ? null : `upload HTTP ${resp.status}`;
}

async function triggerPreview(token, owner, repo, branch, resourcePath) {
  try {
    const resp = await fetch(`https://admin.hlx.page/preview/${owner}/${repo}/${branch}/${resourcePath}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    return resp.ok ? null : `preview HTTP ${resp.status}`;
  } catch (e) { return `preview error: ${e.message}`; }
}

function parseArgs(argv) {
  const args = { configDir: 'of1/config', knowledgeDir: 'of1/knowledge', concurrency: 8 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--owner') args.owner = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--branch') args.branch = argv[++i];
    else if (a === '--config-dir') args.configDir = argv[++i];
    else if (a === '--knowledge-dir') args.knowledgeDir = argv[++i];
    else if (a === '--token-file') args.tokenFile = argv[++i];
    else if (a === '--concurrency') args.concurrency = parseInt(argv[++i], 10) || 8;
  }
  if (!args.owner || !args.repo || !args.branch) throw new Error('Missing required --owner / --repo / --branch');
  return args;
}

async function publishEntry(entry, token, args, seen) {
  let slug = resolveSlug(entry);
  // Dedupe collisions by suffixing a short hash of the source url/title.
  if (seen.has(slug)) {
    const h = crypto.createHash('sha1').update(entry.url || entry.title || slug).digest('hex').slice(0, 6);
    slug = `${slug}-${h}`;
  }
  seen.add(slug);
  const docPath = `${args.knowledgeDir}/${slug}.html`;
  const resourcePath = `${args.knowledgeDir}/${slug}`;
  const html = renderKnowledgeDoc(entry);
  const upErr = await uploadDoc(html, token, args.owner, args.repo, docPath);
  if (upErr) return { slug, ok: false, err: upErr };
  const prevErr = await triggerPreview(token, args.owner, args.repo, args.branch, resourcePath);
  if (prevErr) return { slug, ok: false, err: prevErr };
  return { slug, ok: true, resourcePath: `/${resourcePath}` };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = await resolveToken(args.tokenFile);
  const manifestPath = path.join(args.configDir, 'knowledge-pages.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`${manifestPath} not found — capture step must run first`);
  const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('knowledge-pages.json is empty or not an array');

  const results = [];
  const seen = new Set();
  for (let i = 0; i < entries.length; i += args.concurrency) {
    const batch = entries.slice(i, i + args.concurrency);
    results.push(...await Promise.all(batch.map((e) => publishEntry(e, token, args, seen))));
  }

  const ok = results.filter((r) => r.ok);
  fs.writeFileSync(path.join(args.configDir, 'knowledge-pages.txt'), ok.map((r) => r.resourcePath).join('\n') + '\n');
  for (const r of results) console.log(r.ok ? `  ✓ ${r.resourcePath}` : `  ✗ ${r.slug}: ${r.err}`);
  const failed = results.length - ok.length;
  if (failed > 0) { console.error(`\n✗ ${failed} knowledge page(s) failed`); process.exit(1); }
  console.log(`\n✓ ${ok.length} knowledge page(s) published to DA under of1/knowledge/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`FATAL: ${e.message}`); process.exit(1); });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test skills/of1-extract-content/assets/publish-knowledge-da.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/of1-extract-content/assets/publish-knowledge-da.mjs skills/of1-extract-content/assets/publish-knowledge-da.test.mjs
git commit -m "feat(of1-extract-content): publish-knowledge-da.mjs — bare DA content pages for RAG"
```

---

### Task 2: Capture page content + invoke the publisher (`of1-extract-content/SKILL.md`)

**Files:**
- Modify: `skills/of1-extract-content/SKILL.md`

**Interfaces:**
- Consumes: `publish-knowledge-da.mjs` (Task 1), `$SKILL_DIR`, `$OWNER/$REPO/$BRANCH` (already resolved in the skill).
- Produces: `of1/config/knowledge-pages.json` (capture manifest) and, via the script, live `/of1/knowledge/**` pages + `knowledge-pages.txt`.

- [ ] **Step 1: Add block capture to the Step 3 crawl**

In `### 3. Extract product data (parallel scraping)`, inside the per-tab extraction, add a second `playwright-cli eval` that captures the page's content blocks, and append them to a shared `of1/config/knowledge-pages.json`. Add this code block immediately after the existing `// extract name, price, description…` eval:

````markdown
Also capture each page's readable content for the knowledge RAG — same tab, no extra page load:

```bash
playwright-cli eval "() => {
  const root = document.querySelector('main') || document.querySelector('article') || document.body;
  const title = (document.querySelector('h1')?.innerText || document.title || '').trim();
  const blocks = [];
  root.querySelectorAll('h1,h2,h3,p,li').forEach((el) => {
    if (el.closest('nav,header,footer,aside')) return;
    const text = el.innerText.replace(/\s+/g, ' ').trim();
    if (text) blocks.push({ tag: el.tagName.toLowerCase(), text });
  });
  return { url: location.href, title, blocks };
}"
```

Append each result (`{ url, title, blocks }`) to `of1/config/knowledge-pages.json` (a JSON array). Skip pages whose `blocks` is empty. These are the same pages you already opened — do not open extra tabs.
````

- [ ] **Step 2: Add the publish step**

After `### 10. Publish config to DA (knowledge)`, add:

````markdown
### 11. Publish knowledge pages to DA (`of1/knowledge/**`)

Turn the captured pages into bare DA content docs the worker's content-RAG
ingests. Fast — content, not craft (no EDS blocks). Requires
`of1/config/knowledge-pages.json` from Step 3.

```bash
cd "$OF1_DEMO_REPO"
node "$SKILL_DIR/assets/publish-knowledge-da.mjs" \
  --owner "$OWNER" --repo "$REPO" --branch "$BRANCH"
```

Writes `of1/config/knowledge-pages.txt` (the live `/of1/knowledge/**` paths).
`of1-check-dependencies` enables `contentIngestion` for `/of1/knowledge/**`
and `of1-publish`'s sync indexes them. Do NOT convert these to EDS blocks.
````

- [ ] **Step 3: Update the Completion checklist**

In the `## Completion (pipeline mode)` gate, add a bullet after the `publish-config-da.mjs` item:

````markdown
5. Run `publish-knowledge-da.mjs` (Step 11) and confirmed knowledge pages published (`✓ N knowledge page(s) published to DA under of1/knowledge/`)
````

- [ ] **Step 4: Verify structurally**

```bash
grep -q "publish-knowledge-da.mjs" skills/of1-extract-content/SKILL.md \
  && grep -q "knowledge-pages.json" skills/of1-extract-content/SKILL.md \
  && grep -q "of1/knowledge" skills/of1-extract-content/SKILL.md \
  && echo "OK: capture + publish + namespace present"
```
Expected: `OK: capture + publish + namespace present`.

- [ ] **Step 5: Commit**

```bash
git add skills/of1-extract-content/SKILL.md
git commit -m "feat(of1-extract-content): capture page content + publish /of1/knowledge pages"
```

---

### Task 3: Enable ingestion in config + helix-query coverage (`of1-check-dependencies/SKILL.md`)

**Files:**
- Modify: `skills/of1-check-dependencies/SKILL.md`

**Interfaces:**
- Consumes: `$DOMAIN/$OWNER/$REPO/$BRANCH` (already resolved in Step 6).
- Produces: `of1/config/config.json` with a `contentIngestion` block; a verified/patched `helix-query.yaml` indexing `/of1/knowledge/**`.

- [ ] **Step 1: Add `contentIngestion` to the config.json heredoc**

In `### 6. Write of1-endpoint.json + config.json`, change the `config.json` heredoc to include the block (add after `"knowledgeMode": "da-document"`):

````markdown
```bash
cat > of1/config/config.json <<EOF
{
  "domain": "${DOMAIN}",
  "owner": "${OWNER}",
  "repo": "${REPO}",
  "branch": "${BRANCH}",
  "knowledgeMode": "da-document",
  "contentIngestion": {
    "enabled": true,
    "includePaths": ["/of1/knowledge/**"],
    "maxChunkTokens": 400,
    "contentTopK": 4
  }
}
EOF
```
````

- [ ] **Step 2: Add a helix-query.yaml coverage step**

Add a new step after Step 6 (before Step 7):

````markdown
### 6b. Ensure `/of1/knowledge/**` is indexed (query-index coverage)

The worker discovers knowledge pages via the site's `query-index.json`, which
EDS builds from `helix-query.yaml`. If that folder isn't indexed, ingestion
finds nothing. Ensure an index definition covers it:

```bash
if [ ! -f helix-query.yaml ] || ! grep -q "of1/knowledge" helix-query.yaml; then
  cat >> helix-query.yaml <<'EOF'
version: 1
indices:
  of1-knowledge:
    include:
      - '/of1/knowledge/**'
    target: /of1/knowledge/query-index.json
    properties:
      title:
        select: head > meta[property="og:title"]
        value: attribute(el, "content")
EOF
  git add helix-query.yaml
  git commit -m "chore: index /of1/knowledge for content-RAG discovery" && git push origin "$BRANCH"
  echo "✓ helix-query.yaml now indexes /of1/knowledge/**"
else
  echo "✓ /of1/knowledge already indexed"
fi
```

Note: the worker fetches the site-root `query-index.json`; if this demo uses a
per-folder index (`target:` above), confirm the root index also lists these
pages, or set `contentIngestion.includePaths` to the folder index the worker
reads. Verify with `of1-publish`'s `content.indexed` gate (Task 4).
````

- [ ] **Step 3: Verify structurally**

```bash
grep -q "contentIngestion" skills/of1-check-dependencies/SKILL.md \
  && grep -q "of1/knowledge" skills/of1-check-dependencies/SKILL.md \
  && grep -q "helix-query.yaml" skills/of1-check-dependencies/SKILL.md \
  && echo "OK: contentIngestion + helix-query coverage present"
```
Expected: `OK: contentIngestion + helix-query coverage present`.

- [ ] **Step 4: Commit**

```bash
git add skills/of1-check-dependencies/SKILL.md
git commit -m "feat(of1-check-dependencies): enable contentIngestion + index /of1/knowledge"
```

---

### Task 4: Verify ingestion after sync (`of1-publish/SKILL.md`)

**Files:**
- Modify: `skills/of1-publish/SKILL.md`

**Interfaces:**
- Consumes: the worker `/api/tenants/:id/sync` JSON response (has `content: { indexed }`), `of1/config/knowledge-pages.txt` (created-page count from Task 2).
- Produces: a pass/fail gate on knowledge ingestion.

- [ ] **Step 1: Add a verification step after the sync call**

Locate the step where `of1-publish` POSTs `/api/tenants/:id/sync` and captures its JSON response (grep `api/tenants` / `sync`). Immediately after the response is available, add:

````markdown
**Verify knowledge ingestion.** The sync response includes `content.indexed`
(page chunks embedded into the RAG). If `of1/config/knowledge-pages.txt`
exists (knowledge pages were published), confirm ingestion ran:

```bash
INDEXED=$(jq -r '.content.indexed // 0' <<<"$SYNC_RESPONSE")
PAGES=$( [ -f of1/config/knowledge-pages.txt ] && grep -c . of1/config/knowledge-pages.txt || echo 0 )
if [ "$PAGES" -gt 0 ] && [ "$INDEXED" -eq 0 ]; then
  echo "✗ ${PAGES} knowledge page(s) published but content.indexed=0 — check query-index coverage / preview propagation (of1-check-dependencies Step 6b)" >&2
else
  echo "✓ content RAG: ${INDEXED} chunk(s) indexed from ${PAGES} knowledge page(s)"
fi
```

(`$SYNC_RESPONSE` is the raw JSON body from the `/sync` POST above.)
````

- [ ] **Step 2: Verify structurally**

```bash
grep -q "content.indexed" skills/of1-publish/SKILL.md \
  && grep -q "knowledge-pages.txt" skills/of1-publish/SKILL.md \
  && echo "OK: ingestion verification present"
```
Expected: `OK: ingestion verification present`.

- [ ] **Step 3: Commit**

```bash
git add skills/of1-publish/SKILL.md
git commit -m "feat(of1-publish): verify content.indexed after sync"
```

---

## Self-Review

**Spec coverage:**
- §Design 1 (capture during crawl) → Task 2 Step 1. ✓
- §Design 2 (bare DA docs via publish-knowledge-da.mjs) → Task 1 + Task 2 Step 2. ✓
- §Design 3 (helix-query `/of1/knowledge/**`) → Task 3 Step 2. ✓
- §Design 4 (contentIngestion in config.json) → Task 3 Step 1. ✓
- §Design 5 (trigger + verify via of1-publish) → Task 4. ✓
- §"Where the changes land" table → Tasks 1–4 map 1:1. ✓
- Worker unchanged → no worker task. ✓
- Risk "slug collisions" → `publishEntry` hash-suffix (Task 1). Risk "helix-query coverage"/"preview timing" → Task 3 Step 2 note + Task 4 gate. ✓

**Placeholder scan:** Tasks 2–4 anchor edits with grep-locatable section headings and give the exact text to add; verification is structural grep (SKILL.md is agent-instruction prose, not unit-testable) — this is the honest verification for those tasks, not a placeholder. Task 1 carries full runnable code + tests.

**Type consistency:** manifest entry shape `{ slug?, url?, title, blocks:[{tag,text}] }` is produced by Task 2's capture eval (`{ url, title, blocks:[{tag,text}] }`) and consumed by Task 1 (`resolveSlug`/`renderKnowledgeDoc`). `knowledge-pages.json` (capture) vs `knowledge-pages.txt` (created paths) are distinct and used consistently across Tasks 1/2/4. `contentIngestion` value identical in Task 3 and the spec.
