---
name: of1-style-generative-block
description: Generate polished CSS for the OF1 generative block AND set up the /of1 page end-to-end (block install, branded block CSS, DA content) as an ordinary EDS content page.
user-invocable: true
---

# Generative Block Styler

Own the `/of1` page top to bottom: install the block, generate brand-aligned CSS for it, and upload the DA content document that makes the page renderable. `/of1` is authored exactly like any other EDS content page — the site's existing header/footer blocks and `styles/styles.css` apply automatically; there is no page-template or overlay mechanism to work around.

## Env — orchestrator exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-style-generative-block-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local `of1-demo-orchestrator` git clone |
| `SKILL_DIR` | absolute path to this skill's directory (used to find the canonical `assets/of1.js` and `assets/of1.css` that get installed in `blocks/of1/`) |
| `ADOBE_IMS_TOKEN` | raw DA token (preferred) |
| `OF1_TOKEN_FILE` | path to a `{"access_token":"…"}` JSON (fallback) |

Resolve `DA_TOKEN` (a shell local, not an input — canonical credential is `ADOBE_IMS_TOKEN`/`OF1_TOKEN_FILE`; see `of1-demo-orchestrator/knowledge/pipeline-contract.md` § "Environment variables") and read repo config once at the top:

```bash
# Full resolution order: ADOBE_IMS_TOKEN → OF1_TOKEN_FILE → $PWD/.hlx/.da-token.json
# → $OF1_DEMO_REPO/.hlx/.da-token.json.
DA_TOKEN="${ADOBE_IMS_TOKEN:-}"
for f in "$OF1_TOKEN_FILE" "$PWD/.hlx/.da-token.json" "$OF1_DEMO_REPO/.hlx/.da-token.json"; do
  [ -n "$DA_TOKEN" ] && [ "$DA_TOKEN" != "null" ] && break
  [ -n "$f" ] && [ -f "$f" ] && DA_TOKEN=$(jq -r .access_token "$f")
done
[ -n "$DA_TOKEN" ] && [ "$DA_TOKEN" != "null" ] \
  || { echo "FAIL: no DA token (set ADOBE_IMS_TOKEN or OF1_TOKEN_FILE, or provide .hlx/.da-token.json)" >&2; exit 1; }

REPO_CONFIG=$(cat "$OF1_STATE_DIR/repo-config.json")
OWNER=$(jq -r .owner   <<<"$REPO_CONFIG")
REPO=$(jq -r .repo     <<<"$REPO_CONFIG")
BRANCH=$(jq -r .branch <<<"$REPO_CONFIG")
DOMAIN=$(jq -r .domain <<<"$REPO_CONFIG")
```

## CRITICAL RULES

1. **NEVER modify `blocks/of1/of1.js`** — the OF1 block JavaScript is shared infrastructure and must not be changed. Only the CSS (`blocks/of1/of1.css`) is customized per brand.
2. **This skill OWNS the block install.** Always copy `of1.js` and `of1.css` fresh from `$SKILL_DIR/assets/` to `blocks/of1/` — never reuse whatever exists in the demo repo (may be stale from a previous run).
3. **Style using brand tokens from stardust** — read `DESIGN.json` (resolve its path via `of1-demo-orchestrator/knowledge/design-tokens-resolution.md` — `stardust/current/` OR `./`), `DESIGN.md`, and the `:root` tokens in `styles/styles.css`. The OF1 block must feel native to the brand, not a generic overlay.
4. **Commit BOTH `of1.js` and `of1.css`** — `of1.js` deployed as-is alongside your styled `of1.css`. Always `git add blocks/of1/` to include both. Missing JS = blank page.

## Why this skill exists

The OF1 block renders its own interactive UI — a search landing (title, input, suggestion chips), a loading skeleton while generating, a container for the sections the worker streams in, and follow-up suggestion controls. This skill writes `blocks/of1/of1.css` so that UI feels native to the brand. The **per-section visual design** of generated content is owned by each template's own stylesheet (produced by `of1-build-templates` and injected by the OF1 client SDK at runtime) — this skill does NOT style section internals (hero/cards/tables/columns). Page chrome (header/footer/site styles) is inherited automatically since `/of1` is an ordinary content page.

## Always start from the canonical base files

The OF1 block source files live in this skill's own `assets/`:

- **Base JS:** `$SKILL_DIR/assets/of1.js` — copied as-is to `blocks/of1/of1.js`
- **Base CSS:** `$SKILL_DIR/assets/of1.css` — copied to `blocks/of1/of1.css`, then customized in place with brand tokens

Always start from these. Do NOT use whatever `of1.css` or `of1.js` happens to be in the demo repo.

## Process

### Step 0 — Install block files

```bash
cd "$OF1_DEMO_REPO"
mkdir -p blocks/of1
cp "$SKILL_DIR/assets/of1.js"  blocks/of1/of1.js
cp "$SKILL_DIR/assets/of1.css" blocks/of1/of1.css
```

`of1.js` is deployed as-is. `of1.css` is the unbranded template — Step 3 customizes it in place with the site's brand tokens.

No runtime patching is needed. `/of1` is authored as an ordinary content page (Step 5): the site's `blocks/header`/`blocks/footer` load `/nav`/`/footer` automatically like on every other page, and the `of1` block decorates normally like any other block in `<main>`. There is no page-template/overlay engine in vanilla `aem-boilerplate` that would otherwise replace `<main>`'s content.

### Step 1 — Read design context

- `DESIGN.json` — design tokens (colors, fonts, spacing, radius). **Resolve its path via `of1-demo-orchestrator/knowledge/design-tokens-resolution.md`** — written by Stage 2a (`of1-extract-design`) to `stardust/current/DESIGN.json`.
- `stardust/current/DESIGN.md` — design direction
- `styles/styles.css` — CSS custom properties (the actual deployed tokens; authoritative for a live site, not a guess). If neither `DESIGN.json` location nor `styles/styles.css` exists, stop and report — do not invent tokens.
- `blocks/of1/of1.css` — the freshly-copied template you'll customize

### Step 2 — Generate brand-appropriate block UI styles

The CSS covers the OF1 block's own UI (NOT the internals of generated sections — those are styled by each template's stylesheet):

- **Search landing UI** — title, subtitle, input + submit button, quick-suggestion chips
- **Loading skeleton** — animated placeholder while generating
- **Follow-up suggestions** — chips with hover states, custom input, restart button
- **Section container + animation** — fade + slide-up as each generated section streams in
- **Debug panel** — side panel with timing waterfall (activated with `?debug`)

Adapt these to the current brand: use the site's actual CSS custom properties (`var(--primary-color)`, `var(--text-color)`, …), and match its aesthetic (light/dark theme, border-radius, typography).

### Step 3 — Customize `blocks/of1/of1.css` for the brand

**This is what EDS auto-loads for the OF1 block.** The block's UI styling (search UI, chips, skeleton, follow-up suggestions, section container + animation, debug) goes here.

⚠️ **DO NOT put block styling in `styles/styles.css`** — that's the site's own foundation stylesheet, shared across every page. Block-level styling belongs only in `blocks/of1/of1.css`.

Step 0 already copied the unbranded template to `blocks/of1/of1.css`. Now edit it in place:
1. Replace ALL generic token values (e.g. `#000000`, `system-ui`) with brand values from `DESIGN.json`
2. Add brand-specific visual enhancements to the block's own UI

The file is organized into these sections (keep the structure; just retune the values):

```
/* ─── Brand Token Mapping ─── */
/* ─── Container & Layout ─── */
/* ─── Search Landing UI ─── */
/* ─── Input & Submit ─── */
/* ─── Quick Suggestion Chips ─── */
/* ─── Loading Skeleton ─── */
/* ─── Generated Sections (container + fade-in only) ─── */
/* ─── Follow-up Suggestions ─── */
/* ─── Responsive ─── */
```

Do NOT add rules that target generated-section internals (`.generated-section .hero`, `.cards`, `.table`, `.columns`) — that content is template HTML styled by the template's own injected stylesheet.

### Step 4 — Guarantee the site's /nav and /footer chrome exist

The header/footer blocks fetch `/nav` and `/footer` on every page; if either is missing, **every page
renders chromeless** — no nav, no footer, including `/of1`. These docs are *supposed* to exist by now
(Stage 2c, `of1-snowflake`, authors them for the e2e pipeline; the existing site already has them for
`of1-integration`). A bot-blocked source is now caught upstream — Stage 2a (`of1-extract-design`)
fails loud on a blocked capture rather than letting an unmeasurable site flow downstream to an empty
`<header></header>` — but guarantee the fragments regardless of provenance rather than assume. This guard is
idempotent — if both already return 200 it changes nothing, and it **never overwrites** an existing
chrome doc:

```bash
node "$SKILL_DIR/assets/ensure-nav-footer.mjs"
```

On a missing fragment it authors a minimal branded one from the pages actually deployed on this branch
(so nav links only point at pages that exist). It fails loud (exit 1) if a fragment still can't be made
live — a chromeless demo must not proceed silently.

### Step 5 — Upload OF1 DA content

The `/of1` page is an ordinary EDS content page: a `metadata` block (Title/Description) plus a section containing the `of1` block table. The site's existing `blocks/header`/`blocks/footer` pick up the real `/nav` and `/footer` documents automatically — guaranteed to exist by Step 4 above (whether from Stage 2c's `of1-snowflake`, the existing site, or the Step 4 fallback).

```bash
OF1_HTML='<body><header></header><main><div><div class="metadata"><div><div>Title</div><div>'${DOMAIN}' — Ask Anything</div></div><div><div>Description</div><div>Search and get personalized results.</div></div></div></div><div><div class="of1"><table><tr><th colspan="2">of1</th></tr><tr><td><p>api-endpoint</p></td><td><p>https://of1-gen-web-service.franklin-prod.workers.dev</p></td></tr><tr><td><p>domain</p></td><td><p>'${BRANCH}'--'${REPO}'--'${OWNER}'</p></td></tr></table></div></div></main><footer></footer></body>'

curl -s -X PUT \
  -H "Authorization: Bearer ${DA_TOKEN}" \
  -H "Content-Type: text/html" \
  -d "$OF1_HTML" \
  "https://admin.da.live/source/${OWNER}/${REPO}/of1.html"

# Trigger preview so the URL is live
PREVIEW_RESP=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer ${DA_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${DA_TOKEN}" \
  "https://admin.hlx.page/preview/${OWNER}/${REPO}/${BRANCH}/of1")
PREVIEW_STATUS=$(echo "$PREVIEW_RESP" | tail -1)
if [ "$PREVIEW_STATUS" -lt 200 ] || [ "$PREVIEW_STATUS" -ge 300 ]; then
  echo "FAIL: preview trigger for /of1 returned HTTP ${PREVIEW_STATUS}" >&2
  echo "Response: $(echo "$PREVIEW_RESP" | sed '$d')" >&2
  exit 1
fi
```

**Do NOT include a `<title>` tag in the DA HTML** — EDS will render it as visible content.

### Step 5b — Gate: verify DA content is live and renders correctly

**Do NOT proceed to Step 6 until this gate passes.** The preview trigger above can silently fail (401, stale cache, missing auth headers). Verify the page actually exists and returns valid HTML.

```bash
OF1_PREVIEW="https://${BRANCH}--${REPO}--${OWNER}.aem.page/of1"

OF1_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$OF1_PREVIEW")
if [ "$OF1_STATUS" != "200" ]; then
  echo "FAIL: /of1 page returned HTTP ${OF1_STATUS} — preview trigger likely failed (auth issue?)" >&2
  echo "Re-run the preview trigger with both Authorization and x-content-source-authorization headers." >&2
  exit 1
fi

echo "✓ /of1 content is live"
```

Common failures at this gate:

| Symptom | Cause | Fix |
|---|---|---|
| 401 on preview trigger | Missing `x-content-source-authorization` header or expired token | Re-authenticate DA token and re-run |
| 404 on /of1 | PUT to DA source failed silently | Check the PUT response; verify `admin.da.live/source/...` path matches repo config |

### Step 6 — Commit and push

```bash
cd "$OF1_DEMO_REPO"
git add blocks/of1/
git commit -m "feat: OF1 page + brand-aligned block styling for ${DOMAIN}"
git push origin "$BRANCH"
```

### Step 7 — Verify the live `/of1` page renders correctly

After the push, EDS picks up the code change automatically. Open the live OF1 page in a browser and verify the three things that have to be right before handing back to the user:

```bash
OF1_URL="https://${BRANCH}--${REPO}--${OWNER}.aem.page/of1"
playwright-cli open "$OF1_URL"
sleep 4  # EDS loads header/footer blocks + lazy CSS

# Confirm the branded chrome and the block are all in the DOM
playwright-cli eval "() => (document.querySelector('header .header') ? 'header OK' : 'HEADER MISSING')"
playwright-cli eval "() => (document.querySelector('footer .footer') ? 'footer OK' : 'FOOTER MISSING')"
playwright-cli eval "() => (document.querySelector('.of1')            ? 'of1 block OK' : 'OF1 BLOCK MISSING')"

# Capture a screenshot for visual review
playwright-cli screenshot --full-page --filename "$OF1_STATE_DIR/of1-render-check.png"
```

(`header .header` / `footer .footer` match vanilla `aem-boilerplate`'s `decorateBlock` convention — confirm against the target's own `runtime-contract.json` `blockWrapperClass` field if it drifts.)

Open the screenshot — the branded nav should be at the top, the branded footer at the bottom, and the OF1 search UI (title, input, suggestion chips) in the middle.

### Step 7b — Verify generated content styling

The page chrome rendering (Step 7) is necessary but not sufficient. Also confirm a query returns styled content. Generated sections are template HTML styled by each template's own injected stylesheet, so this is an end-to-end smoke test that the block, the client SDK, and the templates work together — not a check of `of1.css` selectors.

1. Trigger a test query by clicking a suggestion chip
2. Wait for generated content to stream in
3. Screenshot and visually confirm the sections are styled (branded typography, spacing, imagery) — not raw unstyled text

```bash
# Click first suggestion chip to trigger generation
playwright-cli click ".of1-chip:first-child"
sleep 8  # wait for the worker to generate + render

# Screenshot the generated result for visual review
playwright-cli screenshot --full-page --filename "$OF1_STATE_DIR/of1-generated-check.png"

# Confirm at least one generated section rendered
playwright-cli eval "() => (document.querySelector('.generated-section') ? 'generated OK' : 'NO GENERATED CONTENT')"
```

If nothing renders, check the worker sync / tenant status (see `of1-publish`) and that the template catalog deployed. Per-section visual problems are the templates' CSS (`of1-build-templates`), not this skill.

Common failures:

| Symptom | Likely cause |
|---|---|
| `HEADER MISSING` / `FOOTER MISSING` | `/nav` or `/footer` doc is missing — re-run Step 4 (`ensure-nav-footer.mjs`); it authors a minimal branded fragment when Stage 2c/the existing site didn't provide one |
| `OF1 BLOCK MISSING` | `blocks/of1/of1.js` wasn't pushed, or the `of1` block table's `th` cell doesn't read exactly `of1` |
| Screenshot shows unstyled links / system font | `styles/styles.css` (the site's own foundation CSS) didn't get pushed by Stage 2c's (`of1-snowflake`) deploy phase, or the preview hasn't picked up the latest push yet |

Fix any failures and re-push before Completion.

## Key principles

- **Use the brand's actual tokens** — don't hardcode colors; use `var(--primary-color)`
- **The block's own UI must feel native to the brand** — search landing, chips, skeleton, and follow-up suggestions carry the first impression
- **Animations add polish** — fade-in + slide-up on each section as it streams in
- **Responsive by default** — the search UI, chips, and skeleton adapt to mobile
- **Per-section visual design is the templates' job** — `of1.css` styles the block UI + section container only; never the section internals

## Completion — HARD STOP for user review

After pushing, mark the step as `review` and **STOP**. Do not proceed. The user must open the OF1 page, test the search UI, click suggestion chips, and visually approve the styling before the pipeline continues.

This is a gate — `of1-publish` (Deploy) cannot start until both `of1-build-templates`(assemble) and this skill (`of1-style-generative-block`) are approved.

```bash
OF1_URL="https://${BRANCH}--${REPO}--${OWNER}.aem.page/of1"
cat > "$OF1_STATE_DIR/of1-style-generative-block-status.json" <<EOF
{
  "stage": 3,
  "skill": "of1-style-generative-block",
  "status": "review",
  "deliverables": [
    { "url": "${OF1_URL}", "label": "OF1 page" }
  ],
  "summary": "OF1 page is live with brand-aligned block styling. Open it, try the search chips, and review the design."
}
EOF
```

The user will:
1. Open the OF1 page via the deliverable link
2. Try suggestion chips to see generated content with the new styling
3. Approve or request revisions

## Common mistakes that waste time

Cross-cutting rules (SLICC Node.js shim, EDS class collisions) live in `of1-demo-orchestrator/knowledge/common-pitfalls.md`. The pitfalls below are specific to OF1-block styling — read all before writing CSS.

| Mistake | Time cost | Fix |
|---|---|---|
| Writing branded CSS to `styles/of1-template-base.css` or any other file | 10+ min (block appears completely unstyled) | Output MUST go to `blocks/of1/of1.css` — the ONLY file EDS auto-loads for the block |
| Leaving generic tokens (`#000000`, `system-ui`) in `of1.css` | 5+ min (block looks unbranded) | Replace ALL placeholder token values with brand values from `DESIGN.json` |
| Assuming `/of1` needs its own page-chrome CSS file | Wasted effort — `styles/of1.css` doesn't exist anymore | `/of1` inherits `styles/styles.css` automatically like any other page; nothing to write here |
| Using whatever `of1.js` is in the demo repo | 10+ min debugging | Always copy fresh from `$SKILL_DIR/assets/of1.js` |
| Using whatever `of1.css` is in the demo repo as base | 5+ min stale/wrong | Always copy fresh from `$SKILL_DIR/assets/of1.css` and customize in place |
| Modifying `of1.js` to add brand logic | Breaks block | JS is shared infrastructure — NEVER touch it, only customize CSS |
| Forgetting to commit `of1.js` alongside `of1.css` | Blank page | Always `git add blocks/of1/` to include both files |
| Adding rules for generated-section internals (`.generated-section .hero`/`.cards`/`.table`) | Wasted effort — dead selectors | That content is template HTML styled by the template's own injected stylesheet; `of1.css` styles only the block UI + section container |
