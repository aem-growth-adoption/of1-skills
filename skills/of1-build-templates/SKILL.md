---
name: of1-build-templates
description: Author DA block templates for the OF1 worker's da-blocks-slots engine — real EDS documents in a tenant's /templates DA folder, composed from the site's own EDS blocks (reused first, new general-purpose blocks only where useful) filled with realistic example content. The worker syncs them, selects one per request, and asks the LLM for content-only slot values it splices into the authored skeleton.
user-invocable: true
---

# OF1 Template Authoring (da-blocks-slots)

Produce the worker's template library as **DA-authored block templates**: real EDS documents in a tenant's `/templates` DA folder, composed of the site's **own** blocks (`hero`, `cards`, `columns`, …) filled with realistic example content, each carrying a `section-metadata` block describing its intent. DA is the source of truth — no git-committed template HTML, `.metadata.json`, catalog, or gallery.

At request time the worker (`da-blocks-slots` engine) selects one template by intent, asks the LLM for **content-only slot values** addressed by structural id, and splices them into the authored skeleton; the browser then runs the site's real `decorate()` pipeline. See `of1-gen-web-service/docs/superpowers/specs/2026-08-10-da-block-templates-design.md` and this repo's `docs/superpowers/specs/2026-08-31-of1-build-templates-da-blocks-slots-migration.md`.

## Env — the driver exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives status JSON |
| `OF1_DEMO_REPO` | absolute path to the local EDS site repo (also `TENANT_REPO_DIR` for `inventory.sh`) |
| `SKILL_DIR` | absolute path to this skill |
| `ADOBE_IMS_TOKEN` / `OF1_TOKEN_FILE` | DA token (`AEM_TOKEN` defaults to the same token) |
| `OF1_TG_MODE` / `OF1_TG_INTENT` | phase / intent (see Phases) |

Scripts in `$SKILL_DIR/scripts/` (run `bash "$SKILL_DIR/scripts/<name>"`) resolve repo config and the DA token (probed before any write) themselves. **Every phase starts with `. "$SKILL_DIR/scripts/env.sh"`** (source it, don't run it): it loads `repo-config.json` (`OWNER`, `REPO`, `BRANCH`, `DOMAIN`), resolves `DA_TOKEN`/`AEM_TOKEN`, exports `ORG` (= `$OWNER`, the DA org), sources `assets/da-api.sh` (`da_put`…), and `cd`s into `$OF1_DEMO_REPO`. With `OF1_TG_MODE=intent` it also validates `OF1_TG_INTENT` (exit 2 otherwise) and sets `INTENT`. `write-status.sh base [n] | intent | final` writes the phase status files.

## Block Strategy — the core methodology (read before authoring anything)

Reason in this order. **Reuse first; invent general blocks only when genuinely useful; never author a
slot-specific, single-template block.**

1. **Use cases first.** From `$OF1_STATE_DIR/of1-discovery-output.md` (optional, usually absent), `knowledge-pages.json` (captured pages, from `of1-extract-content`, when present) and `personas-rows.json`, determine what the generative-search experience must answer.
2. **Derive intents** — `comparison`, `recommendation`, `deep-dive`, `budget`, `discovery`. Each maps
   to one or more template shapes.
3. **Choose the block palette per template, in priority order:**
   - **Reuse an existing block** from the tenant's `blocks/*` — first choice whenever it, optionally with a single-hyphen **variant** or a `no-static-labels` /
     `key-value` knob, can express the shape.
   - **Author a new *general-purpose* block** only when reuse genuinely can't express the shape AND the
     block is a broadly reusable pattern — e.g. `product-cards`, `comparison-grid`, `feature-list`,
     `stat-row`. Positional, with real `blocks/<name>/<name>.{js,css}`, usable across templates/intents
     and other sites.
4. **Compose the DA template** from the chosen blocks with realistic example content.

### CRITICAL RULES

1. **General, never slot-specific.** `product-cards` is fine; `comparison-hero-with-three-fixed-tiers` is not — the point of this engine is to kill bespoke-per-template markup. When in doubt, reuse an existing block with a variant.
2. **Never modify or restyle a reused (existing) block** — its `blocks/<name>/<name>.css` is owned upstream. New blocks you author get disjoint names.
3. **Never touch `blocks/of1/of1.{js,css}`** — that is `of1-style-generative-block`'s. You own section blocks only.
4. **New blocks must be positional** (read `block.children` by index, like `cards.js`). Never author the snowflake label/value convention (`cells[0]`=name, `cells[1]`=value) — it decorates into the wrong shape here.
5. **Keep alignment consistent within a template.** A generated page stacks several blocks in one `<main>`; they must read as one designed layout. Decide one alignment intent per template (usually centered) and make **every** block obey it — heading, body, media, CTAs. The common offender is a `hero`/`featured` whose CSS defaults to left image + left text above centered `cards`/`columns`. When a reused block's CSS fights the alignment, pick a matching variant or add a new general block that centers — **never** restyle the reused block (rule 2). New blocks center by default. Record the decision in the block plan so every intent agent composes the same way.
6. **Size the page to its purpose — richness is not fixed.** 1–6 content sections (excluding `section-metadata`), keyed off `Template Max Items`:
   - **Quick answer** (`Max Items ≤ 2` — single deep-dive, focused two-item comparison): **1–2 blocks is fine**; don't pad it into a landing page.
   - **Exploratory** (`Max Items ≥ 3` — recommendation, budget, discovery): **target 4–5** (max 6); a lead + grid alone feels like a stub. Compose a **lead** (`hero`/`featured`), the **primary** block (`cards`/`comparison-grid`), then supporting sections — framing `columns`, a secondary `cards`/`stat-row`, a quote, a closing CTA band — from **reused** blocks first; never invent a slot-specific block to pad.
   Starting recipes: **recommendation** `hero`/`featured` pick → framing `columns` → alternatives `cards` → CTA (4); **comparison** `hero`/`featured` → `comparison-grid` (2, fine) or + option `cards` + CTA (2–4); **deep-dive** `hero`/`featured` → `comparison-grid.simple` spec sheet (1–3); **budget** `featured` best-value → priced `cards` → price-breakdown `comparison-grid` → CTA (4); **discovery** `hero`/`featured` → filter/framing `columns` → browse `cards` → CTA (4). Keep alignment consistent (rule 5). `assemble` **rejects** an empty template and **warns** when an exploratory one has < 3 blocks.
7. **Wire any search / query input to `/of1`.** A template's search input, "ask a question" field, or search-styled CTA must navigate to `/of1` (typed text as `?q=<encoded>`) — a raw `<input>` that goes nowhere is a dead end. Prefer a whole-cell `<a href="/of1">` CTA (a real link the worker keeps `static`), or a `<form action="/of1" method="get">` with the field named `q`. Never leave it unbound or point it at the brand's original search endpoint.

## The da-blocks-slots authored-template contract

An authored template is a normal EDS document. What the worker requires (`materialize-da-templates.js`, `block-tree.js`, `slot-address.js`, `slot-splice.js`):

- **Body shape:** `<body><header></header><main><div>…sections…</div></main><footer></footer></body>`, like the tenant's own `content/*.html`; positional rows of the tenant's own blocks with realistic example content.
- **No `data-slot` attributes, no slot schema.** Slots are addressed structurally (`s{S}-b{B}-r{R}-c{C}`) by the worker at sync time; a cell's **role is auto-detected**: `<picture>`/`<img>` → `image` · whole-cell `<a>` → `link` · >1 block-level element (e.g. `<h2>` + `<p>`) → `html` · empty/icon-only → `static` (never filled) · otherwise `text`. So put an `<img>` where you want a fillable image, a whole-cell `<a>` for a fillable link, and keep multi-element intros in one cell to preserve markup.
- **Label/value rows** (spec/price tables) are auto-detected: 2–3 cells, cell 0 short plain text (≤4 words, no image/link), repeating across ≥2 rows. Cell 0 stays **static** (verbatim, never sent to the LLM). Knobs: `no-static-labels` forces **every** cell dynamic; `key-value` lowers the detection threshold to one row.
- **Section metadata:** a `section-metadata` block with **`Template Intent`**, **`Template Description`**, **`Template Min Items`**, **`Template Max Items`**. **No commas in any value** (the markdown intermediate drops the following space). Min/max gate selection against available product count.
- **Class names:** single-hyphen variants only (`variant-double`, never `variant--double`). Positional rows only.
- **Naming:** EDS strips a leading underscore from a path (`templates/_foo` → `/templates/foo`); use a `templates/_drafts/` subfolder for scratch.

`assets/da-api.sh` provides `da_put` / `da_delete` / `da_list` / `aem_preview` (source it; it sets no shell options, so it is safe to source in bash or zsh). `assets/template-richness.mjs` counts content blocks / reads `Template Max Items` from a `.plain.html`. `assets/inventory.sh`
enumerates usable positional blocks in `$TENANT_REPO_DIR/blocks/*`.

## Phases

Selected by `OF1_TG_MODE`; the driver runs `base` → `intent × 5` (parallel) → `assemble`.

| Mode | What it does | Dispatched by |
|---|---|---|
| `base` | Use-cases → intents → **block plan**; `inventory.sh` + harvest live `.plain.html`; author planned **new general blocks**, commit + push, wait for code sync. | Driver first (1 agent) |
| `intent` | Compose DA template docs for ONE intent (`$OF1_TG_INTENT`) from the plan, `da_put` each to `/templates/<name>`. No preview, no commit. | Fan-out (5 agents) after `base` |
| `assemble` | Once, after all intents: preview every doc (MANDATORY), verify round-trip + richness, write the final status. Writes nothing to git. | Driver after all intents |
| `all` (default) | `base` → 5 intents serially → `assemble` inline (same artifacts, ~3× slower). | Single agent |

**Race-safety:** intent agents write disjoint DA paths (`/templates/<intent>-*`); new-block code is owned by `base`, previewing by `assemble`. **No routing config:** the worker always uses `da-blocks-slots` and `/templates` (override only via `config.json` `templates.daPath`).

### Phase: `base`

Start with `. "$SKILL_DIR/scripts/env.sh"` (defines `${OWNER}`, `${REPO}`; the preview host is `https://main--${REPO}--${OWNER}.aem.page`).

1. **Use cases → intents → block plan.** Read discovery + `knowledge-pages.json`; decide per intent the template shapes and block palette (reuse vs new). Size each template to its purpose (RULE 6) and list its ordered block sequence (lead → primary → supporting → CTA) so exploratory intents compose rich pages. Fix the **alignment intent** (usually `center`, RULE 5) and record it; where a reused block's CSS won't honor it, note the matching variant or flag that a centered new block is needed.
2. **Inventory reusable blocks:** `export TENANT_REPO_DIR="$OF1_DEMO_REPO"; "$SKILL_DIR/assets/inventory.sh" "$TENANT_REPO_DIR"`. Read each `blocks/<name>/<name>.js` to confirm it is **positional** (reads `block.children` by index); exclude label/value-convention blocks.
3. **Harvest known-good compositions.** For each usable block fetch the live pages' `.plain.html` (`https://main--{REPO}--{OWNER}.aem.page/{path}.plain.html`) and record a per-block fingerprint (row count, per-row cell count) — stronger evidence than the `.js` alone.
4. **Adapt the count to the vocabulary.** A 16-block site supports ~5 intents × ~3 variations; a 3-block site fewer, leaning on variants + `no-static-labels`/`key-value`. Don't blindly target 15.
5. **Author planned NEW general blocks** (skip when reuse covers everything): positional `blocks/<name>/<name>.{js,css}`, brand tokens from `styles/styles.css` + `DESIGN.json` (path via `of1-integration/knowledge/design-tokens-resolution.md`). Then commit, push, and wait until the code bus serves them **before** any template previews them:
   ```bash
   bash "$SKILL_DIR/scripts/commit-block-code.sh" <name> [<name>...]   # one commit per block; code-sync timeout only warns
   ```
6. **Persist the block plan** (usable blocks, fingerprints, per-intent template list) to `$OF1_STATE_DIR/of1-build-templates-plan.json`, then write the progress file: `bash "$SKILL_DIR/scripts/write-status.sh" base <N-new-blocks>`.

### Phase: `intent`

First `. "$SKILL_DIR/scripts/env.sh"` (validates intent, sets `${INTENT}`, `${OWNER}`, `${REPO}`, `da_put`). Precondition: `$OF1_TG_INTENT` ∈ {`comparison`, `recommendation`, `deep-dive`, `budget`, `discovery`} (else exit 2) and `base` has finished (`of1-build-templates-plan.json` exists, new blocks deployed). For each template variation the plan calls for:

1. **Compose the document** from the planned blocks with realistic example content per the contract above: image-role cells where a real image should be swapped, label/value rows for spec/price tables, single-hyphen variants. Honor the plan's alignment intent (RULE 5), size to purpose (RULE 6), point any search input at `/of1` (RULE 7).
2. **Add the `section-metadata` block**: `Template Intent = <intent>`, a short structurally-distinct `Template Description`, `Template Min Items` / `Template Max Items`. No commas in values.
3. **Wrap** in `<body><header></header><main><div>…</div></main><footer></footer></body>` and `da_put` (source `assets/da-api.sh`):
   ```bash
   da_put "./<intent>-<variation>.html" "templates/<intent>-<variation>.html"
   ```
   `da_put` returns the `editUrl` (`da.live/edit#/…`) — capture it; `of1-publish` surfaces it in the demo hub.
4. Do **not** preview or commit here. Then write this intent's status file: `bash "$SKILL_DIR/scripts/write-status.sh" intent`.

### Phase: `assemble`

Run once after all 5 intent agents complete; first `. "$SKILL_DIR/scripts/env.sh"`.

1. **Preview every composed doc (MANDATORY)** — an unpreviewed DA doc has no `.plain.html`, so the worker syncs nothing:
   ```bash
   bash "$SKILL_DIR/scripts/preview-all.sh"
   ```
   Aborts (non-zero) if `/templates` lists no docs or any preview is non-2xx. On 401/403 **stop and report the org-authorization gap** (see `of1-check-dependencies` step 5); other statuses (404, 5xx) are reported as-is. Never report templates ready with unpublished docs. DA content is shared across branches, so a preview on any existing ref is visible on every branch's preview host.
   Then write the template-name sheet the worker enumerates (names of the `/templates` docs, previewed, not published):
   ```bash
   bash "$SKILL_DIR/scripts/write-template-list.sh"   # DA sheet /of1/config/template-list, column `name`; aborts on 0 valid names / write failure
   ```
2. **Verify the round-trip** per template: `https://main--{REPO}--{OWNER}.aem.page/templates/{name}.plain.html` must be 200 and each block's row/per-row cell counts must match the harvested fingerprint. A 404 means preview didn't materialize; a shape mismatch means markdown-intermediate mangling — fix before proceeding.
3. **Check richness against purpose (RULE 6):**
   ```bash
   bash "$SKILL_DIR/scripts/verify-richness.sh"
   ```
   Counts content blocks per `.plain.html` (`<div class="NAME">` section children minus `section-metadata`/`metadata`, via `assets/template-richness.mjs`). **Aborts** on an empty template (0 blocks); **warns** when an exploratory one (`Max Items ≥ 3`) has < 3; quick-answer templates (`Max Items ≤ 2`) are never warned.
4. **Final status file** (the deliverable status the driver reports; links to `https://da.live/edit#/${OWNER}/${REPO}/templates`): `bash "$SKILL_DIR/scripts/write-status.sh" final`.

## Deliverables & notes

- DA sheet `/of1/config/template-list` (previewed; the worker's template enumeration) and DA documents at `/templates/<intent>-<variation>` (not git-committed; editable at `da.live/edit#/{org}/{repo}/templates/*`, the authoring showcase `of1-publish` surfaces) and any **new general-purpose** `blocks/<name>/{<name>.js,<name>.css}` (committed). No template config file; reused blocks are never modified.
- **Preview is not optional** — a DA write with no preview means the worker syncs zero templates and the generative page is empty.
- **Reuse over invention.** A new block must earn its place as a general pattern reused across templates.
- Does not author `blocks/of1/of1.css`, generative-images.json, or generative-fragments.json (other skills).
