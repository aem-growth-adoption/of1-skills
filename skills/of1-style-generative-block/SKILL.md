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
| `OF1_STATE_DIR` | state + IPC dir; receives `step-7-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local `of1-demo-orchestrator` git clone |
| `SKILL_DIR` | absolute path to this skill's directory (used to find the canonical `assets/of1.js` and `assets/of1.css` that get installed in `blocks/of1/`) |
| `ADOBE_IMS_TOKEN` | raw DA token (preferred) |
| `OF1_TOKEN_FILE` | path to a `{"access_token":"…"}` JSON (fallback) |

Resolve `DA_TOKEN` and read repo config once at the top:

```bash
DA_TOKEN="${ADOBE_IMS_TOKEN:-$(jq -r .access_token "$OF1_TOKEN_FILE")}"
[ -n "$DA_TOKEN" ] || { echo "FAIL: no DA token available" >&2; exit 1; }

REPO_CONFIG=$(cat "$OF1_STATE_DIR/repo-config.json")
OWNER=$(jq -r .owner   <<<"$REPO_CONFIG")
REPO=$(jq -r .repo     <<<"$REPO_CONFIG")
BRANCH=$(jq -r .branch <<<"$REPO_CONFIG")
DOMAIN=$(jq -r .domain <<<"$REPO_CONFIG")
```

## CRITICAL RULES

1. **NEVER modify `blocks/of1/of1.js`** — the OF1 block JavaScript is shared infrastructure and must not be changed. Only the CSS (`blocks/of1/of1.css`) is customized per brand.
2. **This skill OWNS the block install.** Always copy `of1.js` and `of1.css` fresh from `$SKILL_DIR/assets/` to `blocks/of1/` — never reuse whatever exists in the demo repo (may be stale from a previous run).
3. **Style using brand tokens from stardust** — read `stardust/current/DESIGN.json`, `DESIGN.md`, and the `:root` tokens in `styles/styles.css`. The OF1 block must feel native to the brand, not a generic overlay.
4. **Commit BOTH `of1.js` and `of1.css`** — `of1.js` deployed as-is alongside your styled `of1.css`. Always `git add blocks/of1/` to include both. Missing JS = blank page.

## Why this skill exists

EDS block CSS is designed for statically-authored pages. When the LLM generates sections dynamically, the raw block CSS often looks too plain — no visual hierarchy between sections, cards render as flat lists, heroes lack full-bleed treatment, tables are unstyled, no transitions, no cohesive container. This skill bridges that gap by writing `blocks/of1/of1.css` (block-level styles for generated content). Page chrome (header/footer/site styles) is not this skill's concern — `/of1` is an ordinary content page and inherits `styles/styles.css` and the site's real header/footer blocks automatically.

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

No runtime patching is needed. `/of1` is authored as an ordinary content page (Step 6): the site's `blocks/header`/`blocks/footer` load `/nav`/`/footer` automatically like on every other page, and the `of1` block decorates normally like any other block in `<main>`. There is no page-template/overlay engine in vanilla `aem-boilerplate` that would otherwise replace `<main>`'s content.

### Step 1 — Read design context

- `stardust/current/DESIGN.json` — design tokens (colors, fonts, spacing, radius)
- `stardust/current/DESIGN.md` — design direction
- `styles/styles.css` — CSS custom properties (the actual deployed tokens)
- `blocks/of1/of1.css` — the freshly-copied template you'll customize
- `templates/templates-catalog.json` — template catalog (what the LLM generates)

### Step 2 — Generate brand-appropriate block styles

The CSS must cover these key patterns:

- **Section-level styling** — spacing, backgrounds, max-width constraints
- **Hero treatment** — full-bleed image background, gradient overlay, large typography
- **Card grids** — proper grid layout, hover effects, image aspect ratios, card borders/shadows
- **Comparison tables** — styled headers, alternating rows, responsive overflow
- **Columns** — side-by-side with responsive stacking
- **Suggestions UI** — follow-up chips with hover states, custom input, restart button
- **Skeleton loading** — animated placeholder while generating
- **Section animations** — fade + slide-up on appearance
- **Debug panel** — side panel with timing waterfall (activated with `?debug`)

Adapt these patterns to the current brand: use the site's actual CSS custom properties (`var(--primary-color)`, `var(--text-color)`, …), match the site's aesthetic (light/dark theme, border-radius, typography), ensure generated sections feel cohesive with the rest of the site.

### Step 3 — Customize `blocks/of1/of1.css` for the brand

**This is what EDS auto-loads for the OF1 block.** All block-level styling (search UI, generated sections, cards, hero, suggestions, skeleton, debug) goes here.

⚠️ **DO NOT put block styling in `styles/styles.css`** — that's the site's own foundation stylesheet, shared across every page. Block-level styling belongs only in `blocks/of1/of1.css`.

Step 0 already copied the unbranded template to `blocks/of1/of1.css`. Now edit it in place:
1. Replace ALL generic token values (e.g. `#000000`, `system-ui`) with brand values from `DESIGN.json`
2. Add brand-specific visual enhancements

The file is organized into these sections (keep the structure; just retune the values):

```
/* ─── Container & Layout ─── */
/* ─── Search Landing UI ─── */
/* ─── Input & Submit ─── */
/* ─── Quick Suggestion Chips ─── */
/* ─── Loading Skeleton ─── */
/* ─── Generated Sections (general) ─── */
/* ─── Hero Sections ─── */
/* ─── Card Grids ─── */
/* ─── Columns ─── */
/* ─── Tables ─── */
/* ─── Text Sections ─── */
/* ─── Follow-up Suggestions ─── */
/* ─── Error State ─── */
/* ─── Debug Panel ─── */
/* ─── Animations ─── */
/* ─── Responsive ─── */
```

### Step 4 — Verify block class names

After `decorateMain` + `loadSections`, the DOM structure is:

```html
<main>
  <div class="section of1-container">        <!-- of1 search UI -->
    <div class="of1-wrapper">
      <div class="of1 block">…</div>
    </div>
  </div>
  <div class="section hero-container">       <!-- generated hero -->
    <div class="hero-wrapper">
      <div class="hero block">…</div>
    </div>
  </div>
  <div class="section cards-container">      <!-- generated cards -->
    <div class="cards-wrapper">
      <div class="cards block">…</div>
    </div>
  </div>
  <div class="section generative-suggestions"> <!-- follow-up -->
    …
  </div>
</main>
```

## EDS Block DOM Reference (after decorateMain)

**This is the actual DOM you are styling. Do NOT assume any other structure.**

EDS's `decorateMain()` always produces this three-level wrapper for every block:

```
.section.<blockname>-container > .<blockname>-wrapper > .<blockname>.block > div (rows) > div (cells)
```

### Hero
```
.section.hero-container
  > .hero-wrapper
    > .hero.block
      > div                    ← row (flexbox item)
        > div                  ← cell: h1, p, a (text content)
        > div                  ← cell: <picture><img> (NOT img directly on .hero)
```
- The `.hero` div does NOT contain the image directly — it's inside a `<picture>` inside a cell inside a row
- Text and image are sibling cells within a row div

### Cards
```
.section.cards-container
  > .cards-wrapper
    > .cards.block             ← THIS is the grid container
      > div                    ← one per card (row)
        > div                  ← cell content (picture, h3, p, a)
```
- `.cards` itself is the grid container — NOT `.cards > div`
- Each direct child `> div` of `.cards` is one card

### Columns
```
.section.columns-container
  > .columns-wrapper
    > .columns.block
      > div                    ← single row
        > div + div            ← column cells (2+ siblings)
```

### Table
```
.section.table-container
  > .table-wrapper
    > .table.block
      > div                    ← header row (div-based, NOT <th>)
        > div + div + div      ← cells (NOT <td>)
      > div                    ← data row
        > div + div + div      ← cells
```
- **NO `<table>`, `<th>`, `<td>` elements** — everything is div-based
- First `> div` child = header row; subsequent `> div` children = data rows

### Common selector mistakes to avoid

| Wrong selector | Why it fails | Correct selector |
|---|---|---|
| `.cards > div` as grid | That targets individual cards, not the grid | `.cards` is the grid |
| `.cards > div > div` for cards | That's cell content inside a card | `.cards > div` for each card |
| `table`, `th`, `td` | EDS uses divs, not HTML table elements | `.table > div` for rows, `.table > div > div` for cells |
| `.hero img` positioned absolute | img is inside `<picture>` inside a cell div | `.hero picture` positioned absolute |
| `[class*="-wrapper"] { max-width: 100% }` | Kills content constraint on cards/columns/table wrappers | Only override `.hero-wrapper` for full-bleed |

---

Target selectors for generated content use the `.generated-section` class added by the OF1 block JS:

```css
.generated-section                         /* any generated section */
.generated-section .hero                   /* generated hero block */
.generated-section .cards                  /* generated cards block */
.generated-section .adventure-cards        /* generated adventure cards */
.generated-section .columns                /* generated columns */
.generated-section .table                  /* generated table */
```

### Step 5 — (Removed) Page chrome is automatic

There is no separate page-chrome CSS step. `/of1` loads the site's own `styles/styles.css` exactly like every other page — the header/footer blocks render the branded nav/footer using the site's real `content/nav.html`/`content/footer.html`. Nothing needs to be duplicated or re-derived here.

### Step 6 — (Folded into Step 7) No template or fragment copying needed

`/of1` needs no `templates/`, `fragments/`, or `data-overlay`/`data-slot-passthrough` machinery. It is authored directly as a DA content document in Step 7 below, using the site's real `/nav` and `/footer` — the same paths every other page on the site already uses.

### Step 7 — Upload OF1 DA content

The `/of1` page is an ordinary EDS content page: a `metadata` block (Title/Description) plus a section containing the `of1` block table. The site's existing `blocks/header`/`blocks/footer` pick up its real `/nav` and `/footer` documents automatically — no placeholder nav/footer pages need to be created here, since the site already has real ones produced by `stardust:replica` (for the full e2e pipeline) or by the existing site itself (for `of1-adopt-existing-site`).

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

### Step 7b — Gate: verify DA content is live and renders correctly

**Do NOT proceed to Step 8 until this gate passes.** The preview trigger above can silently fail (401, stale cache, missing auth headers). Verify the page actually exists and returns valid HTML.

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

### Step 8 — Commit and push

```bash
cd "$OF1_DEMO_REPO"
git add blocks/of1/
git commit -m "feat: OF1 page + brand-aligned block styling for ${DOMAIN}"
git push origin "$BRANCH"
```

### Step 9 — Verify the live `/of1` page renders correctly

After the push, EDS picks up the code change automatically. Open the live OF1 page in a browser and verify the three things that have to be right before handing back to the user:

```bash
OF1_URL="https://${BRANCH}--${REPO}--${OWNER}.aem.page/of1"
playwright-cli open "$OF1_URL"
sleep 4  # EDS loads header/footer blocks + lazy CSS

# Confirm the branded chrome and the block are all in the DOM
playwright-cli eval "document.querySelector('header .header') ? 'header OK' : 'HEADER MISSING'"
playwright-cli eval "document.querySelector('footer .footer') ? 'footer OK' : 'FOOTER MISSING'"
playwright-cli eval "document.querySelector('.of1')            ? 'of1 block OK' : 'OF1 BLOCK MISSING'"

# Capture a screenshot for visual review
playwright-cli screenshot --fullPage=true --filename "$OF1_STATE_DIR/of1-render-check.png"
```

(`header .header` / `footer .footer` match vanilla `aem-boilerplate`'s `decorateBlock` convention — confirm against the target's own `runtime-contract.json` `blockWrapperClass` field if it drifts.)

Open the screenshot — the branded nav should be at the top, the branded footer at the bottom, and the OF1 search UI (title, input, suggestion chips) in the middle.

### Step 9b — Verify generated content styling

The page chrome rendering (Step 9) is necessary but not sufficient. You MUST also verify that generated blocks render with proper layout — not just raw text.

1. Trigger a test query by clicking a suggestion chip or entering a query
2. Wait for generated content to appear (sections stream in)
3. Screenshot the result and verify:
   - **Cards** render as a grid (not a vertical list of unstyled divs)
   - **Hero** shows image as background with text overlay (not image then text stacked)
   - **Table** renders with visible header row and aligned columns (not a blob of text)
   - **Columns** sit side-by-side (not stacked vertically on desktop)
4. If any block renders as unstyled/broken, inspect the DOM and compare selectors in `of1.css` against the actual EDS DOM structure documented in Step 4

```bash
# Click first suggestion chip to trigger generation
playwright-cli click ".of1-chip:first-child"
sleep 8  # wait for LLM to generate + render

# Screenshot the generated result
playwright-cli screenshot --fullPage=true --filename "$OF1_STATE_DIR/of1-generated-check.png"

# Spot-check that blocks decorated correctly
playwright-cli eval "document.querySelector('.generated-section .cards') ? 'cards OK' : 'CARDS MISSING'"
playwright-cli eval "document.querySelector('.generated-section .hero') ? 'hero OK' : 'HERO MISSING'"
```

If selectors don't match, the CSS is targeting the wrong DOM structure. Refer to the EDS Block DOM Reference in Step 4 and fix `blocks/of1/of1.css` accordingly.

Common failures:

| Symptom | Likely cause |
|---|---|
| `HEADER MISSING` / `FOOTER MISSING` | `content/nav.html`/`content/footer.html` weren't pushed by `stardust:replica`'s deploy phase — re-run its artifact-verification gate |
| `OF1 BLOCK MISSING` | `blocks/of1/of1.js` wasn't pushed, or the `of1` block table's `th` cell doesn't read exactly `of1` |
| Screenshot shows unstyled links / system font | `styles/styles.css` (the site's own foundation CSS) didn't get pushed by `stardust:replica`'s deploy phase, or the preview hasn't picked up the latest push yet |

Fix any failures and re-push before Completion.

## Key principles

- **Generated content must look as good as hand-crafted pages** — this is a demo, impressions matter
- **Use the brand's actual tokens** — don't hardcode colors; use `var(--primary-color)`
- **Style generated sections specifically** — don't break existing static page styling
- **Full-bleed heroes** — dramatic, not constrained to max-width
- **Card images are critical** — the LLM outputs image URLs; they must render at proper aspect ratios in a grid
- **Responsive by default** — grids collapse, heroes scale, tables scroll
- **Animations add polish** — fade-in + slide-up on each section as it streams in

## Completion — HARD STOP for user review

After pushing, mark the step as `review` and **STOP**. Do not proceed. The user must open the OF1 page, test the search UI, click suggestion chips, and visually approve the styling before the pipeline continues.

This is a gate — step 12 (Deploy) cannot start until both step 6 (Templates) and step 7 (this step) are approved.

```bash
OF1_URL="https://${BRANCH}--${REPO}--${OWNER}.aem.page/of1"
cat > "$OF1_STATE_DIR/step-7-status.json" <<EOF
{
  "step": 7,
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
| **Generated sections constrained to 980px max-width** | **Content has huge side padding, doesn't fill viewport** | **Generated sections MUST be full-width (`max-width: 100%` or `none`). Only inner content (cards grid, text) should have max-width.** |
| **Section padding over 60px** | **Huge vertical gaps between sections** | **Use 40–56px vertical padding max. Base template uses 56px — don't increase it.** |
| **Start over button icon misaligned** | **SVG icon floating above/below text** | **`.suggestion-restart` needs `display: inline-flex; align-items: center; gap: 6px;`** |
