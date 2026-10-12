---
name: of1-extract-content
description: Crawl a website to publish its page content to DA under /of1/knowledge/** and write the /of1/config/personas DA sheet
user-invocable: true
---

# Content Metadata Populator

Crawl a website to capture the site's own page content (products, features, FAQs, testimonials) and publish it to DA under `/of1/knowledge/**` for the worker's content-RAG, then infer user personas and write them as the DA sheet `/of1/config/personas`. Nothing is written to git: captured pages are staged in `$OF1_STATE_DIR/knowledge-pages.json`, personas rows in `$OF1_STATE_DIR/personas-rows.json`.

## Env — the driver exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-extract-content-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local EDS site repo |
| `SKILL_DIR` | absolute path to this skill (used to find `assets/*.mjs` and `../of1-integration/assets/da-write.mjs`) |
| `ADOBE_IMS_TOKEN` | raw DA token (preferred) |
| `OF1_TOKEN_FILE` | path to a `{"access_token":"…"}` JSON (fallback) |

Each command step is a script in `$SKILL_DIR/scripts/` (run as `bash "$SKILL_DIR/scripts/<name>"`). Every script sources `common.sh`: env from `repo-config.json`, DA token resolution + expiry probe, `SOURCE_BASE`, then `cd "$OF1_DEMO_REPO"`.

Optional discovery output (usually absent): `cat "$OF1_STATE_DIR/of1-discovery-output.md" 2>/dev/null` — use it to focus on the right product category.

Personas sheet columns (DA `/of1/config/personas`): `id,name,description,keywords,priorities,explore,research,compare,purchase,deals,support`.

## Source resolution — live site vs replica

`common.sh` sets `SOURCE_BASE`: `https://${OF1_CONTENT_SOURCE}` (the REAL external site, e.g. `frescopa.coffee`) when `OF1_CONTENT_SOURCE` is set, else the site's own EDS preview `https://${BRANCH}--${REPO}--${OWNER}.aem.page`. It is the root for every crawl; everything else is identical either way. Step 8's image re-hosting always targets the EDS replica regardless of source.

## Process

### 1. Understand scope

If `OF1_NON_INTERACTIVE=1`: use `$SOURCE_BASE`, focus on the main category (10–20 products) and skip asking.

Otherwise ask:
> What should I index? Full catalog / specific category / curated list of URLs?

### 2. Discover catalog (or main content pages)

Fetch main product listing pages with WebFetch. Extract for each visible product: name, URL, category, price, short description. Write the page URLs to capture, one per line, to `$OF1_STATE_DIR/product-urls.txt`.

**Non-commerce sites (no catalog).** If the site sells nothing / has no product listing (services, B2B, content, events, institutions), capture the site's **main content pages** instead — the knowledge base is "what this site says", not a product list. Take them from the site index or the nav, in that order:

```bash
bash "$SKILL_DIR/scripts/discover-urls.sh"
```

It reads the EDS JSON index (`/sitemap.json`, skipping `drafts|fragments|of1|templates|nav|footer` paths, max 20), falls back to the nav fragment's links, always prepends `${SOURCE_BASE}/`, prints one URL per line and saves them to `$OF1_STATE_DIR/product-urls.txt`.

Hand-prune `product-urls.txt` to the 10–20 pages with real content (about, services/solutions, programs, FAQ/help, pricing/plans if any) before Step 3.

### 3. Extract page data (parallel scraping)

```bash
bash "$SKILL_DIR/scripts/capture-pages.sh"   # URLs from product-urls.txt, or pass them as arguments
```

`capture-pages.sh` starts from a fresh `$OF1_STATE_DIR/knowledge-pages.json`, opens pages in parallel **batches of 5** (first URL `playwright-cli open`, the rest `tab-new`), waits 5 s, runs the capture eval in each tab (`main`/`article` content: h1–h3, p, li, img, minus nav/header/footer/aside), appends non-empty captures with `jq` (empty ones warn and are skipped), and closes the batch. `playwright-cli` runs from `$OF1_STATE_DIR` (via the `pw` helper) so `.playwright-cli/` never lands in the repo. Do NOT scrape pages serially. Close tabs individually only from the highest id down. Pages for Step 5/5b: capture them the same way (append to `knowledge-pages.json`; re-running the script resets it, so pass ALL URLs in one run).

For each product (cap at 20), note: name, price, category, features, description, use cases, target audience. These notes are working context for persona inference (Step 4) only — the knowledge the worker uses is the captured page content in `knowledge-pages.json`.

### 4. Infer personas

**Personas:** distinct buyer types with trigger keywords, priorities, and an intent profile (see the personas sheet in Step 7 — at least one axis should be clearly dominant per persona so personas are visually distinct on the demo's Intent Map).

### 5. Capture features and FAQs

**Features / FAQs:** if the site has dedicated feature, FAQ, help, or comparison pages that Step 3 did not visit, open them (same batch-of-5 pattern) and run the same capture eval, appending each to `knowledge-pages.json`. Their headings, paragraphs and list items become the knowledge docs — do not rewrite or summarise them.

### 5b. Capture testimonials

Look for testimonials / social proof (quote cards, tweet embeds, review excerpts, attendee quotes).

If they live on a page not yet captured, capture it into `knowledge-pages.json` the same way. If the site has NO real testimonials, capture none — never invent them.

### 6. Present summary (interactive only)

**Skip when `OF1_NON_INTERACTIVE=1`** — go to Step 7.

### 7. Write personas sheet (`/of1/config/personas`)

Write the persona rows as a JSON array to `$OF1_STATE_DIR/personas-rows.json` — one object per persona, keys exactly matching the sheet columns:

```json
[
  { "id": "persona-slug", "name": "Persona Name", "description": "Who this represents and what they're looking for",
    "keywords": ["trigger", "words", "user", "would", "type"], "priorities": ["what", "they", "value"],
    "explore": 0.3, "research": 0.8, "compare": 0.6, "purchase": 0.3, "deals": 0.2, "support": 0.2 }
]
```

⛔ **No commas inside a keyword or priority.** `keywords` and `priorities` are written to the sheet as one comma-joined cell and consumers split on `,` — so `"sugar, free"` would silently become two keywords. Use `"sugar free"` instead. `da-write.mjs` rejects any `keywords`/`priorities` item containing a comma (non-zero exit); fix the item and re-run rather than working around it.

Intent axes — `explore`, `research`, `compare`, `purchase`, `deals`, `support` (numbers 0–1): where this persona typically sits on the shopping-intent funnel — `explore` (browsing broadly, no target yet), `research` (digging into specs/details), `compare` (weighing alternatives), `purchase` (ready to buy), `deals` (price/promo-sensitive), `support` (needs help/service, post-sale). Infer them from the persona's `priorities`/`description` — give each persona a clearly dominant axis (≥0.7) and at least one clearly low axis (≤0.3) so personas render as visibly different shapes rather than a uniform hexagon.

This renders as the demo's Intent Map radar and seeds the visitor's behaviour profile sent to `/api/personalize` (shaping content retrieval and the LLM prompt) — wrong values get content aimed at the wrong intent.

`keywords` (10–12 strings) describe what this persona searches for and cares about; the preview extension uses them as focus areas in the persona's seeded profile (and, only when the intent columns are empty, to guess its intent). Keep them specific to the persona so personas stay distinguishable.

Upload + preview the sheet:

```bash
bash "$SKILL_DIR/scripts/write-personas.sh"
```

It prints a `✓ … previewed` line for the personas sheet on success. On `FAIL <step> <path> HTTP <status>` or a comma-validation error (non-zero exit) **stop** and fix — do not mark the skill done. Never write a personas file into the git repo (it would shadow the DA sheet).

### 8. Publish knowledge pages to DA (`of1/knowledge/**`)

Turn the captured pages into bare DA content docs the worker's content-RAG
ingests. Fast — content, not craft (no EDS blocks). Requires
`$OF1_STATE_DIR/knowledge-pages.json` from Steps 3–5b.

Rehost the captured images to DA, then author the knowledge docs with inline `<img>` pointing at the rehosted URLs (`build-image-manifest.mjs` keys each image by a hash of its source URL; `publish-knowledge-da.mjs --image-map` maps back by the same key). Failed images are dropped, the text still publishes. **A partial image failure is OK** (`download-images.mjs` exits non-zero but writes the mapping for the successes); only `publish-knowledge-da.mjs` failing is a real failure. Non-http(s) srcs are skipped.

```bash
bash "$SKILL_DIR/scripts/publish-knowledge.sh"
```

It runs `build-image-manifest.mjs` → `download-images.mjs` (skipped when the manifest is empty; a failure only warns) → `publish-knowledge-da.mjs`, then removes the `/tmp/knowledge-image-*.json` temp files; its exit code is the publish step's.

The worker indexes `/of1/knowledge/**` by default (no `contentIngestion` needed in
`config.json`; `of1-check-dependencies` makes sure `helix-query.yaml` covers it, and
`of1-publish` step 2b sets `contentIngestion.indexPath` for config-service sites) and
`of1-publish`'s sync indexes them. Do NOT convert these to EDS blocks.

## Tips

- IDs must be URL-friendly slugs (lowercase, hyphens)
- Don't fabricate data — if not on the page, omit it
- Persona keywords should be words users would type, not marketing terms — and never contain a comma
- 10–30 content-rich captured pages work better than 200 sparse ones
- Never use invented/fabricated image URLs — only images captured from the live site

## Completion

⛔ **BEFORE writing the status file, you MUST have seen** `✓ N knowledge page(s) published to DA under of1/knowledge/` (Step 8) and the personas sheet's `✓ … previewed` line (Step 7). Otherwise GO BACK and complete Step 7 / Step 8.

This skill runs alongside `of1-extract-brand-voice`. Both must complete before the content track is treated as done.

```bash
cat > "$OF1_STATE_DIR/of1-extract-content-status.json" <<EOF
{"stage":3,"skill":"of1-extract-content","status":"done","summary":"Content: [N] knowledge pages published to DA under of1/knowledge/ ([I] images rehosted). [M] personas written to DA sheet /of1/config/personas."}
EOF
```

