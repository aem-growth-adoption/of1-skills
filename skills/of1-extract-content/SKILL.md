---
name: of1-extract-content
description: Scrape product data, personas, use cases, features, and FAQs from a website for the tenant config
user-invocable: true
---

# Content Metadata Populator

Crawl a website to extract the site's knowledge — products, features, FAQs and testimonials — into a single `knowledge` document of generic entities (plus user personas), producing JSON files for the OF1 worker tenant config and publishing `knowledge` to DA as `of1-config` blocks so authors can edit the tenant's knowledge in Document Authoring.

## Env — orchestrator exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-extract-content-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local `of1-demo-orchestrator` git clone |
| `SKILL_DIR` | absolute path to this skill (used to find `assets/download-images.*`) |
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

cd "$OF1_DEMO_REPO"
mkdir -p of1/config
```

If discovery output exists, read it to focus on the right product category:
```bash
cat "$OF1_STATE_DIR/of1-discovery-output.md" 2>/dev/null
```

Schema reference: `of1-demo-orchestrator/knowledge/worker-config-schemas.md` — § `knowledge.json`, § `personas.json`.

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
(output files, image download, JSON shapes) is identical in both modes. Note: `$SOURCE_BASE`
is only for extracting product/content data — Step 9's image re-hosting always targets the
EDS replica (`https://${BRANCH}--${REPO}--${OWNER}.aem.page/media/...`) regardless of source.

## Inputs

- `$SOURCE_BASE` (resolved above) — the base URL to crawl. In pipeline mode this is the target domain; in standalone mode it's the replica preview.

## Process

### 1. Understand scope

In pipeline mode: use `$SOURCE_BASE` and focus on the **demo category** from discovery (10–20 products). Skip asking.

In standalone mode, ask:
> What should I index? Full catalog / specific category / curated list of URLs?

### 2. Discover catalog

Fetch main product listing pages with WebFetch. Extract for each visible product: name, URL, category, price, short description.

### 3. Extract product data (parallel scraping)

**Open product pages in parallel batches of 5, then extract from each batch.** Do NOT scrape pages one at a time in a serial loop — that takes 2 min per page × 16 pages = 32 min. Batches of 5 take ~5 min total.

```bash
# Process in batches of 5 tabs at a time
BATCH_SIZE=5
for ((i=0; i<${#PRODUCT_URLS[@]}; i+=BATCH_SIZE)); do
  # Open this batch
  for URL in "${PRODUCT_URLS[@]:i:BATCH_SIZE}"; do
    playwright-cli open "$URL"
  done
  sleep 5  # wait for batch to render

  # Extract data from each tab in this batch
  for TAB_ID in $(playwright-cli tab-list | grep -oE '[0-9]+'); do
    playwright-cli tab-select "$TAB_ID"
    playwright-cli eval "() => {
      // extract name, price, description, images, features, etc.
    }"
  done

  # Close batch tabs before opening the next batch
  playwright-cli tab-list | grep -oE '[0-9]+' | while read TAB; do
    playwright-cli tab-close "$TAB" 2>/dev/null
  done
done
```

For each product (cap at 20 in pipeline mode), extract: name, price, currency, category, features (bullets), description (2–3 sentences), specifications, use cases, target audience, image URLs, related products, tags.

### 4. Infer personas

**Personas:** distinct buyer types with trigger keywords, priorities, product mappings, and an intent profile (see `personas.json` schema in Step 7 — at least one axis should be clearly dominant per persona so personas are visually distinct on the demo's Intent Map).

### 5. Extract features and FAQs

**Features:** cross-product differentiators (technology names, capability categories). Fold each into its related product's `facts[]` in `knowledge.json`; a feature with no related product becomes its own `type:"feature"` knowledge entity.

**FAQs:** from FAQ sections or inferred from comparison points and feature explanations. Each becomes a `type:"faq"` knowledge entity.

### 5b. Extract testimonials

Scrape any customer quotes, reviews, or social proof from the site. Look for:
- Testimonial sections (quote cards, carousels)
- Tweet embeds or social proof sections
- Customer review excerpts
- Speaker/attendee quotes (for event sites)

Each real testimonial becomes a `type:"testimonial"` knowledge entity. If the site has NO real testimonials, produce none — never invent them.

### 6. Present summary (standalone mode only)

**Skip in pipeline mode** — go directly to Step 7.

### 7. Generate JSON files

Write all files to `of1/config/`. Schemas below.

**knowledge.json:** — the single factual store; one entity per product, orphan feature, FAQ, or testimonial. `facts[]` is the load-bearing field: each a self-contained, true, quotable claim (render prices, categories, highlights, feature bullets, and FAQ answers as facts). `type` records the origin.

```json
[
  {
    "id": "edge-inference-engine",
    "type": "product",
    "title": "Edge Inference Engine",
    "description": "AI that runs in milliseconds at the CDN layer.",
    "keywords": ["edge ai", "low latency personalization"],
    "facts": [
      "Runs inference at the CDN edge, not a central data center.",
      "Delivers millisecond response times.",
      "Category: Platform / Edge AI."
    ],
    "images": ["https://main--repo--owner.aem.page/media/product-edge-inference-engine-1.png"],
    "persona": "platform-engineering-lead"
  },
  {
    "id": "how-fast",
    "type": "faq",
    "title": "How fast does the page personalize?",
    "description": "The full pipeline completes within a 2.5-second maximum LCP.",
    "keywords": ["performance", "speed"],
    "facts": ["The Understand→Reason→Compose pipeline completes within a 2.5s maximum LCP, not an average."],
    "images": []
  }
]
```

Mapping rules:
- **product →** one `type:"product"` entity (title=name; images; persona); `facts[]` = highlights + related feature bullets + price/category as claims.
- **feature →** folded as `facts[]` into its related product (via the old `productIds`); an orphan feature becomes its own `type:"feature"` entity.
- **faq →** `type:"faq"` (title=question; description/facts=answer; no images).
- **testimonial →** `type:"testimonial"` (title=author/company; facts=quote + attribution).
- **personas** stay in `personas.json`. **No separate use-case file is produced.**

**personas.json:**
```json
[
  {
    "id": "persona-slug",
    "name": "Persona Name",
    "description": "Who this represents and what they're looking for",
    "keywords": ["trigger", "words", "user", "would", "type", "in", "search"],
    "priorities": ["what", "they", "value"],
    "recommendedProducts": ["product-id-1", "product-id-2"],
    "intentProfile": {
      "explore": 0.3,
      "research": 0.8,
      "compare": 0.6,
      "purchase": 0.3,
      "deals": 0.2,
      "support": 0.2
    }
  }
]
```

`intentProfile` (object, 0–1 per axis): where this persona typically sits on the shopping-intent funnel — `explore` (browsing broadly, no target yet), `research` (digging into specs/details), `compare` (weighing alternatives), `purchase` (ready to buy), `deals` (price/promo-sensitive), `support` (needs help/service, post-sale). Infer it from the persona's `priorities`/`description` — give each persona a clearly dominant axis (≥0.7) and at least one clearly low axis (≤0.3) so personas render as visibly different shapes rather than a uniform hexagon.

This isn't just cosmetic: it renders as the demo's Intent Map radar, but when a viewer clicks "Personalize" for that persona, this exact value is sent to the OF1 worker's personalize endpoint and directly drives real generation — which template gets selected (from the catalog's candidates for the resolved intent), the RAG retrieval mode, and the intent context put in the LLM prompt (see `of1-demo-orchestrator/knowledge/worker-config-schemas.md` § `personas.json` for the full trace). Get it wrong and the persona won't just look wrong on the radar — it'll get shown content for the wrong intent.

`keywords` (10–12 strings) are matched against the user's query. Without them, persona matching fails silently and defaults to the first persona.

### 8. Cross-reference check

Verify all ID references are consistent across files. Fix mismatches.

### 9. Download + upload product images to DA

⛔ **HARD GATE — DO NOT SKIP THIS STEP. DO NOT MARK THIS SKILL AS COMPLETE WITHOUT RUNNING `download-images.mjs`.** If you write the completion status file without first downloading and uploading images to DA, the demo WILL fail the pre-launch checklist and the entire pipeline run is wasted. This step is NOT optional. Placeholder URLs written by hand instead of running the script are NOT valid — they will 404.

**ALL product images MUST be self-hosted on DA and previewed on EDS.** Never leave external CDN URLs in `products.json` — external URLs break due to CORS, referrer policies, encoding issues, and EDS image optimization rewriting. `content.da.live` is DA's authoring/source store — it is access-restricted and NOT a public delivery endpoint. Images must be uploaded to DA AND previewed (so EDS's Media Bus ingests them), then referenced via the site's own domain: `https://${BRANCH}--${REPO}--${OWNER}.aem.page/media/{filename}`. `download-images.mjs` does both steps automatically.

**Minimum 4 images per product, up to 8.** The pre-launch checklist FAILS if any product has fewer than 4. Templates often render 3–6 item cards with images — fewer than 4 images per product leaves visible gaps. If a product page has only 1–3 images, look on the category/listing page, manufacturer press galleries, related model pages, or lifestyle/editorial pages for additional angles.

#### Extract source URLs

Use playwright-cli to visit each product detail page and extract product images:

```bash
playwright-cli eval "() => (
  Array.from(document.querySelectorAll('img'))
    .filter(i => i.naturalWidth > 200 && !i.src.includes('icon') && !i.src.includes('logo'))
    .map(i => ({ src: i.src, alt: i.alt, w: i.naturalWidth, h: i.naturalHeight }))
)"
```

Stage the source URLs in `products.json`'s `images` arrays.

#### Parallel download + upload

Use `download-images.mjs` — it downloads + uploads concurrently (8 workers), sniffs content type from magic bytes, triggers an EDS preview per image so it's reachable on the site's own domain, and resolves the DA token automatically.

```bash
cd "$OF1_DEMO_REPO"

# download-images.mjs derives its work list from of1/config/knowledge.json
# (one entry per entity that has an images[] array — i.e. type:"product" /
# "testimonial"). It downloads + uploads every image, previews it, and rewrites
# the entity images[] to the site's .aem.page/media/... paths.
node "$SKILL_DIR/assets/download-images.mjs" \
  --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
  --output /tmp/image-mapping.json \
  --products-json of1/config/knowledge.json \
  --max-per-product 8 \
  --update-products
```

The `--update-products` flag rewrites `knowledge.json[*].images` to the site's `.aem.page/media/...` URLs automatically.

#### Clean up temp files before any commit

```bash
rm -rf /tmp/image-mapping.json
rm -rf of1/config/img-tmp of1/config/da-token.json of1/config/image-manifest.json
```

These are working files from `download-images.mjs` — do NOT commit them to git.

#### Verify

```bash
python3 << 'EOF'
import json, subprocess, sys

with open("of1/config/products.json") as f:
    products = json.load(f)

all_good = True
for p in products:
    images = p.get("images", [])
    if len(images) < 4:
        print(f"  ✗ {p['name']}: only {len(images)} image(s) — MUST have ≥4")
        all_good = False
    else:
        r = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", images[0]], capture_output=True, text=True)
        status = "✓" if r.stdout.strip() == "200" else "✗"
        print(f"  {status} {p['name']}: {len(images)} images (HTTP {r.stdout.strip()})")
        if r.stdout.strip() != "200":
            all_good = False

if not all_good:
    print("\n✗ FAIL: Fix products with <4 images before completing!")
    sys.exit(1)
print("\n✓ All products have ≥4 accessible images")
EOF
```

**Do NOT write the completion status until this passes.** Go back and download more images if any product has fewer than 4.

### 10. Publish config to DA (`knowledge`)

The worker reads the knowledge doc from **DA** as `of1-config` key/value blocks
(`{file}.plain.html`), so authors can edit the tenant's knowledge in Document
Authoring instead of hand-editing JSON in git. It only falls back to the
committed `of1/config/{file}.json` when the DA doc is missing or parses to zero
records. New demos are configured with `knowledgeMode: "da-document"` (set by
`of1-check-dependencies` in `config.json`), so the DA doc is the source of truth
— publishing it is required, not optional.

Run this **after** Step 9, so product `images` already carry their final
`.aem.page/media/...` URLs and get embedded in the DA doc:

```bash
cd "$OF1_DEMO_REPO"

# Reads of1/config/knowledge.json, renders each record as an
# of1-config block, uploads the doc to DA, and previews it so {file}.plain.html
# is live. Resolves the DA token the same way as download-images.mjs.
node "$SKILL_DIR/assets/publish-config-da.mjs" \
  --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
  --files knowledge
```

The committed JSON is **kept** as the fallback safety net — do NOT delete it.
The DA doc and the JSON stay in sync because both are generated from the same
extracted records here. (Format + migration contract:
`of1-gen-web/docs/da-config-authoring.md`.)

`personas.json` is **not** published to DA: under `knowledgeMode: "da-document"`
the worker disables server-side persona matching (personalization is interests
→ RAG retrieval only), so that file is inert. Keep writing it in Step 7 for
backward-compat with non-knowledgeMode tenants, but it needs no DA doc.

## Tips

- IDs must be URL-friendly slugs (lowercase, hyphens)
- Don't fabricate data — if not on the page, omit it
- Persona keywords should be words users would type, not marketing terms
- 10–30 well-described products work better than 200 sparse entries
- Never use invented/fabricated image URLs — only URLs extracted from the live site that actually downloaded successfully (> 10 KB)

## Completion (pipeline mode)

⛔ **BEFORE writing the status file below, you MUST have:**
1. Run `download-images.mjs` with `--update-products` (Step 9 above)
2. Verified ALL product image URLs return HTTP 200 (the verify script above)
3. Confirmed all images are `https://${BRANCH}--${REPO}--${OWNER}.aem.page/media/...` URLs (site domain, previewed), NOT `https://content.da.live/...` (access-restricted, not public)
4. Run `publish-config-da.mjs` (Step 10) and confirmed all three files published (`✓ All config files published to DA`)

If ANY of these are false, GO BACK and complete Step 9 / Step 10. Do not proceed.

This skill runs alongside `of1-extract-brand-voice`. Both must complete before the content track is treated as done.

```bash
cat > "$OF1_STATE_DIR/of1-extract-content-status.json" <<EOF
{"stage":3,"skill":"of1-extract-content","status":"done","summary":"Content metadata: [N] products, [M] personas, [P] use cases, [Q] features, [R] FAQs. All images on DA. products/features/faqs published to DA as of1-config blocks."}
EOF
```

The orchestrator waits for both `of1-extract-content-status.json` and `of1-extract-brand-voice-status.json` before treating the content pair as complete.
