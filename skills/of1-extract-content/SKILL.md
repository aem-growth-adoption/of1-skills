---
name: of1-extract-content
description: Crawl a website to publish its page content to DA under /of1/knowledge/** and write the /of1/config/personas DA sheet
user-invocable: true
---

# Content Metadata Populator

Crawl a website to capture the site's own page content (products, features, FAQs, testimonials) and publish it to DA under `/of1/knowledge/**` for the worker's content-RAG, then infer user personas and write them as the DA sheet `/of1/config/personas`. Nothing is written to git: captured pages are staged in `$OF1_STATE_DIR/knowledge-pages.json`, personas rows in `$OF1_STATE_DIR/personas-rows.json`.

## Env — orchestrator exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-extract-content-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local `of1-demo-orchestrator` git clone |
| `SKILL_DIR` | absolute path to this skill (used to find `assets/*.mjs` and `../of1-integration/assets/da-write.mjs`) |
| `ADOBE_IMS_TOKEN` | raw DA token (preferred) |
| `OF1_TOKEN_FILE` | path to a `{"access_token":"…"}` JSON (fallback) |

Resolve `DA_TOKEN` (a shell local, not an input — the canonical credential is
`ADOBE_IMS_TOKEN`/`OF1_TOKEN_FILE`; see `of1-demo-orchestrator/knowledge/pipeline-contract.md`
§ "Environment variables"). Walk the full resolution order so a standalone run with only a
local `.hlx/.da-token.json` still works:

```bash
DA_TOKEN="${ADOBE_IMS_TOKEN:-}"
for f in "$OF1_TOKEN_FILE" "$PWD/.hlx/.da-token.json" "$OF1_DEMO_REPO/.hlx/.da-token.json"; do
  [ -n "$DA_TOKEN" ] && [ "$DA_TOKEN" != "null" ] && break
  [ -n "$f" ] && [ -f "$f" ] && DA_TOKEN=$(jq -r .access_token "$f")
done
export DA_TOKEN
[ -n "$DA_TOKEN" ] && [ "$DA_TOKEN" != "null" ] \
  || { echo "FAIL: no DA token (set ADOBE_IMS_TOKEN or OF1_TOKEN_FILE, or provide .hlx/.da-token.json)" >&2; exit 1; }

REPO_CONFIG=$(cat "$OF1_STATE_DIR/repo-config.json")
OWNER=$(jq -r .owner   <<<"$REPO_CONFIG")
REPO=$(jq -r .repo     <<<"$REPO_CONFIG")
BRANCH=$(jq -r .branch <<<"$REPO_CONFIG")
SKILL_DIR="${SKILL_DIR:-/workspace/skills/of1-extract-content}"
DA_WRITE="$SKILL_DIR/../of1-integration/assets/da-write.mjs"
PAGES="$OF1_STATE_DIR/knowledge-pages.json"

cd "$OF1_DEMO_REPO"
```

If discovery output exists, read it to focus on the right product category:
```bash
cat "$OF1_STATE_DIR/of1-discovery-output.md" 2>/dev/null
```

Personas sheet columns (DA `/of1/config/personas`): `id,name,description,keywords,priorities,explore,research,compare,purchase,deals,support`.

## Source resolution — live site vs replica

This skill crawls real pages, so it needs a base URL to crawl. There are two candidates and
`OF1_CONTENT_SOURCE` decides between them:

```bash
if [ -n "$OF1_CONTENT_SOURCE" ]; then
  # Pipeline mode: extract from the REAL external site. The orchestrator sets
  # OF1_CONTENT_SOURCE to the target domain (e.g. frescopa.coffee), so here
  # SOURCE_BASE is just that domain as an https:// URL.
  SOURCE_BASE="https://${OF1_CONTENT_SOURCE}"
else
  # Standalone mode (default): there is no external domain to point at — crawl the
  # built EDS replica preview instead. This is NOT the target domain.
  SOURCE_BASE="https://${BRANCH}--${REPO}--${OWNER}.aem.page"
fi
echo "Extracting from: $SOURCE_BASE"
```

Use `$SOURCE_BASE` as the root for every crawl/scrape in the steps below. Everything else
(output files, image rehosting, JSON shapes) is identical in both modes. Note: `$SOURCE_BASE`
is only for extracting content — Step 8's image re-hosting always targets the EDS replica
(`https://${BRANCH}--${REPO}--${OWNER}.aem.page/media/...`) regardless of source.

## Inputs

- `$SOURCE_BASE` (resolved above) — the base URL to crawl. In pipeline mode this is the target domain; in standalone mode it's the replica preview.

## Process

### 1. Understand scope

In pipeline mode: use `$SOURCE_BASE` and focus on the **demo category** from discovery (10–20 products). Skip asking.

In standalone mode, ask:
> What should I index? Full catalog / specific category / curated list of URLs?

### 2. Discover catalog (or main content pages)

Fetch main product listing pages with WebFetch. Extract for each visible product: name, URL, category, price, short description. Put the page URLs to capture in a bash array `PRODUCT_URLS=( … )`.

**Non-commerce sites (no catalog).** If the site sells nothing / has no product listing (services, B2B, content, events, institutions), capture the site's **main content pages** instead — the knowledge base is "what this site says", not a product list. Take them from the site index or the nav, in that order:

```bash
# EDS JSON index (paths) — skip drafts/fragments/OF1/template paths.
mapfile -t PRODUCT_URLS < <(curl -s --max-time 20 "${SOURCE_BASE}/sitemap.json" \
  | jq -r '[.. | objects | .path? // empty | strings] | .[]' 2>/dev/null \
  | grep -vE '^/(drafts|fragments|of1|templates|nav|footer)(/|$)' | head -20 \
  | sed "s|^|${SOURCE_BASE}|")
# Fallback: the nav fragment's links.
[ "${#PRODUCT_URLS[@]}" -gt 0 ] || mapfile -t PRODUCT_URLS < <(curl -s --max-time 20 "${SOURCE_BASE}/nav.plain.html" \
  | grep -oE 'href="[^"#?]+"' | sed -E 's/^href="//; s/"$//' \
  | sed -E "s|^/|${SOURCE_BASE}/|" | grep "^${SOURCE_BASE}" | sort -u | head -20)
printf '%s\n' "${PRODUCT_URLS[@]}"
```

(`mapfile` is bash; under zsh use `PRODUCT_URLS=("${(@f)$(…)}")`.) Always include the home page (`${SOURCE_BASE}/`). Hand-prune the list to the 10–20 pages with real content (about, services/solutions, programs, FAQ/help, pricing/plans if any) before Step 3.

### 3. Extract page data (parallel scraping)

Start each run from a fresh `$PAGES` (`rm -f "$PAGES"` before the first batch) so re-runs do not duplicate pages.

**Open pages in parallel batches of 5, then extract from each batch.** Do NOT scrape pages one at a time in a serial loop — that takes 2 min per page × 16 pages = 32 min. Batches of 5 take ~5 min total.

`playwright-cli` rules (verified on the current CLI):

- **Run it from `$OF1_STATE_DIR`, never from the repo** — it writes a `.playwright-cli/` folder (snapshots, console logs) into the current directory, which would otherwise end up in the customer's git tree.
- First URL of a batch → `playwright-cli open URL` (starts the browser); every other URL → `playwright-cli tab-new URL`. Calling `open` repeatedly does not open new tabs.
- Tab ids come from `playwright-cli tab-list` lines shaped `- <id>: …` → `grep -oE '^- [0-9]+:' | grep -oE '[0-9]+'` (a bare `grep -oE '[0-9]+'` also picks up digits in titles/URLs).
- `playwright-cli eval` prints a Markdown report; the returned value is under `### Result`. Extract it with `awk '/^### Result/{f=1;next} /^### /{f=0} f'`.
- Close the batch with `playwright-cli close` (closes the browser and all its tabs). If you close tabs individually, go from the **highest id down** — ids are positional and renumber after each close.

```bash
cd "$OF1_STATE_DIR"   # playwright-cli writes .playwright-cli/ into cwd — keep it out of the repo
pw_result() { awk '/^### Result/{f=1;next} /^### /{f=0} f'; }
CAPTURE_JS="() => {
  const root = document.querySelector('main') || document.querySelector('article') || document.body;
  const title = (document.querySelector('h1')?.innerText || document.title || '').trim();
  const blocks = [];
  root.querySelectorAll('h1,h2,h3,p,li,img').forEach((el) => {
    if (el.closest('nav,header,footer,aside')) return;
    if (el.tagName.toLowerCase() === 'img') {
      const src = el.currentSrc || el.src || '';
      if (src) blocks.push({ tag: 'img', src, alt: (el.alt || '').trim() });
      return;
    }
    const text = el.innerText.replace(/\\s+/g, ' ').trim();
    if (text) blocks.push({ tag: el.tagName.toLowerCase(), text });
  });
  return { url: location.href, title, blocks };
}"
rm -f "$PAGES"
BATCH_SIZE=5
for ((i=0; i<${#PRODUCT_URLS[@]}; i+=BATCH_SIZE)); do
  # Open this batch: first URL starts the browser, the rest are new tabs.
  first=1
  for URL in "${PRODUCT_URLS[@]:$i:$BATCH_SIZE}"; do
    if [ "$first" = 1 ]; then playwright-cli open "$URL"; first=0
    else playwright-cli tab-new "$URL"; fi
  done
  sleep 5  # wait for batch to render

  # Extract data from each tab in this batch.
  TAB_IDS=($(playwright-cli tab-list | grep -oE '^- [0-9]+:' | grep -oE '[0-9]+'))
  for TAB_ID in "${TAB_IDS[@]}"; do
    playwright-cli tab-select "$TAB_ID" >/dev/null
    # (Commerce sites) product facts for persona inference — working notes only:
    # playwright-cli eval "() => ({ name: …, price: …, description: … })" | pw_result

    # Readable page content for the knowledge RAG — same tab, no extra page load.
    CAP=$(playwright-cli eval "$CAPTURE_JS" | pw_result \
      | jq -c 'if type == "string" then fromjson else . end' 2>/dev/null)
    # Append to $PAGES with jq (never hand-concatenate); skip empty/failed captures.
    if [ -n "$CAP" ] && [ "$(jq '.blocks | length' <<<"$CAP" 2>/dev/null || echo 0)" -gt 0 ]; then
      if [ -f "$PAGES" ]; then
        jq --argjson p "$CAP" '. + [$p]' "$PAGES" > "$PAGES.tmp" && mv "$PAGES.tmp" "$PAGES"
      else
        jq -n --argjson p "$CAP" '[$p]' > "$PAGES"
      fi
    else
      echo "WARN: no content captured from tab $TAB_ID" >&2
    fi
  done

  # Close the whole batch (browser + tabs) before opening the next one.
  playwright-cli close >/dev/null 2>&1 || true
done
echo "captured $(jq length "$PAGES" 2>/dev/null || echo 0) page(s) → $PAGES"
```

(Works in bash and zsh: `$(…)` inside `( )` splits into array elements in both, and the slice uses `$i`/`$BATCH_SIZE` — zsh rejects a bare `${arr[@]:i:n}`.)

For each product (cap at 20 in pipeline mode), note: name, price, category, features, description, use cases, target audience. These notes are working context for persona inference (Step 4) only — the knowledge the worker uses is the captured page content in `$PAGES`.

### 4. Infer personas

**Personas:** distinct buyer types with trigger keywords, priorities, and an intent profile (see the personas sheet in Step 7 — at least one axis should be clearly dominant per persona so personas are visually distinct on the demo's Intent Map).

### 5. Capture features and FAQs

**Features / FAQs:** if the site has dedicated feature, FAQ, help, or comparison pages that Step 3 did not visit, open them (same batch-of-5 pattern) and run the same capture eval, appending each to `$PAGES`. Their headings, paragraphs and list items become the knowledge docs — do not rewrite or summarise them.

### 5b. Capture testimonials

Look for customer quotes, reviews, or social proof on the site:
- Testimonial sections (quote cards, carousels)
- Tweet embeds or social proof sections
- Customer review excerpts
- Speaker/attendee quotes (for event sites)

If they live on a page not yet captured, capture it into `$PAGES` the same way. If the site has NO real testimonials, capture none — never invent them.

### 6. Present summary (standalone mode only)

**Skip in pipeline mode** — go directly to Step 7.

### 7. Write personas sheet (`/of1/config/personas`)

Write the persona rows as a JSON array to `$OF1_STATE_DIR/personas-rows.json` — one object per persona, keys exactly matching the sheet columns:

```json
[
  {
    "id": "persona-slug",
    "name": "Persona Name",
    "description": "Who this represents and what they're looking for",
    "keywords": ["trigger", "words", "user", "would", "type", "in", "search"],
    "priorities": ["what", "they", "value"],
    "explore": 0.3,
    "research": 0.8,
    "compare": 0.6,
    "purchase": 0.3,
    "deals": 0.2,
    "support": 0.2
  }
]
```

⛔ **No commas inside a keyword or priority.** `keywords` and `priorities` are written to the sheet as one comma-joined cell and consumers split on `,` — so `"sugar, free"` would silently become two keywords. Use `"sugar free"` instead. `da-write.mjs` rejects any `keywords`/`priorities` item containing a comma (non-zero exit); fix the item and re-run rather than working around it.

Intent axes — `explore`, `research`, `compare`, `purchase`, `deals`, `support` (numbers 0–1): where this persona typically sits on the shopping-intent funnel — `explore` (browsing broadly, no target yet), `research` (digging into specs/details), `compare` (weighing alternatives), `purchase` (ready to buy), `deals` (price/promo-sensitive), `support` (needs help/service, post-sale). Infer them from the persona's `priorities`/`description` — give each persona a clearly dominant axis (≥0.7) and at least one clearly low axis (≤0.3) so personas render as visibly different shapes rather than a uniform hexagon.

This isn't just cosmetic: it renders as the demo's Intent Map radar, and when a viewer clicks "Personalize" for that persona, the preview extension / edge proxy seeds the visitor's behaviour profile with these exact values and sends it to the OF1 worker's `/api/personalize` — where the intent and interests shape the content-chunk retrieval and the intent context put in the LLM prompt. Get them wrong and the persona won't just look wrong on the radar — it'll get content aimed at the wrong intent.

`keywords` (10–12 strings) describe what this persona searches for and cares about; the preview extension uses them as focus areas in the persona's seeded profile (and, only when the intent columns are empty, to guess its intent). Keep them specific to the persona so personas stay distinguishable.

Upload + preview the sheet:

```bash
node "$DA_WRITE" sheet --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
  --path of1/config/personas \
  --columns id,name,description,keywords,priorities,explore,research,compare,purchase,deals,support \
  --rows "$OF1_STATE_DIR/personas-rows.json"
```

It prints a `✓ … previewed` line for the personas sheet on success. On `FAIL <step> <path> HTTP <status>` or a comma-validation error (non-zero exit) **stop** and fix — do not mark the skill done. Never write a personas file into the git repo (it would shadow the DA sheet).

### 8. Publish knowledge pages to DA (`of1/knowledge/**`)

Turn the captured pages into bare DA content docs the worker's content-RAG
ingests. Fast — content, not craft (no EDS blocks). Requires
`$OF1_STATE_DIR/knowledge-pages.json` from Steps 3–5b.

Rehost the captured page images to DA, then author the knowledge docs with
inline `<img>` pointing at the rehosted URLs. `download-images.mjs` is reused
unchanged — `build-image-manifest.mjs` feeds it a per-image manifest keyed by a
hash of each source URL, and `publish-knowledge-da.mjs --image-map` maps each
captured `<img>` back to its rehosted DA url by that same key. Images that fail
to download/upload are dropped from the doc; the text still publishes. **A partial
image failure is OK** — `download-images.mjs` exits non-zero when any image fails
but still writes the mapping for the ones that succeeded; carry on to step 3 (only
`publish-knowledge-da.mjs` failing is a real failure). Non-http(s) srcs (inline
`data:` SVG placeholders, `blob:`) are skipped by `build-image-manifest.mjs`.

```bash
cd "$OF1_DEMO_REPO"

# 1. captured images -> download-images input manifest (unique srcs, hash-keyed)
node "$SKILL_DIR/assets/build-image-manifest.mjs" \
  --pages "$OF1_STATE_DIR/knowledge-pages.json" \
  --output /tmp/knowledge-image-manifest.json

# 2. download + upload each image to DA, preview into the Media Bus
#    (skip if the manifest is empty — no images captured)
if [ "$(jq 'length' /tmp/knowledge-image-manifest.json)" -gt 0 ]; then
  node "$SKILL_DIR/assets/download-images.mjs" \
    --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
    --input /tmp/knowledge-image-manifest.json \
    --output /tmp/knowledge-image-mapping.json \
    || echo "WARN: some images failed to rehost — publishing text with the ones that succeeded" >&2
fi

# 3. author the bare knowledge docs with inline <img> (text-only if no map)
node "$SKILL_DIR/assets/publish-knowledge-da.mjs" \
  --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
  --pages "$OF1_STATE_DIR/knowledge-pages.json" \
  --image-map /tmp/knowledge-image-mapping.json

rm -f /tmp/knowledge-image-manifest.json /tmp/knowledge-image-mapping.json
```

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

## Completion (pipeline mode)

⛔ **BEFORE writing the status file below, you MUST have:**
1. Run `publish-knowledge-da.mjs` (Step 8) and seen `✓ N knowledge page(s) published to DA under of1/knowledge/`
2. Run `da-write.mjs sheet` (Step 7) and seen its `✓ … previewed` line for the personas sheet

If either is false, GO BACK and complete Step 7 (personas sheet) / Step 8 (knowledge pages). Do not proceed.

This skill runs alongside `of1-extract-brand-voice`. Both must complete before the content track is treated as done.

```bash
cat > "$OF1_STATE_DIR/of1-extract-content-status.json" <<EOF
{"stage":3,"skill":"of1-extract-content","status":"done","summary":"Content: [N] knowledge pages published to DA under of1/knowledge/ ([I] images rehosted). [M] personas written to DA sheet /of1/config/personas."}
EOF
```

The orchestrator waits for both `of1-extract-content-status.json` and `of1-extract-brand-voice-status.json` before treating the content pair as complete.
