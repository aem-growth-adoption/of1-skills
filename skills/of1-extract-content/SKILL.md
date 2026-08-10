---
name: of1-extract-content
description: Scrape product data, personas, use cases, features, and FAQs from a website for the tenant config
user-invocable: true
---

# Content Metadata Populator

Crawl a website to extract product data, user personas, use cases, features, and FAQs, producing JSON files for the OF1 worker tenant config.

## Env — orchestrator exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-extract-content-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local `of1-demo-orchestrator` git clone |
| `SKILL_DIR` | absolute path to this skill (used to find `assets/download-images.*`) |
| `ADOBE_IMS_TOKEN` | raw DA token (preferred) |
| `OF1_TOKEN_FILE` | path to a `{"access_token":"…"}` JSON (fallback) |

Resolve `DA_TOKEN` and read repo config:

```bash
export DA_TOKEN="${ADOBE_IMS_TOKEN:-$(jq -r .access_token "$OF1_TOKEN_FILE")}"
[ -n "$DA_TOKEN" ] || { echo "FAIL: no DA token available" >&2; exit 1; }

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

Schema reference: `of1-demo-orchestrator/knowledge/worker-config-schemas.md` — § `products.json`, § `personas.json`, § `use-cases.json`, § `features.json`, § `faqs.json`.

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

### 4. Infer personas and use cases

**Personas:** distinct buyer types with trigger keywords, priorities, product mappings, and an intent profile (see `personas.json` schema in Step 7 — at least one axis should be clearly dominant per persona so personas are visually distinct on the demo's Intent Map).

**Use cases:** activities/goals with trigger keywords and recommended products.

### 5. Extract features and FAQs

**Features:** cross-product differentiators (technology names, capability categories).

**FAQs:** from FAQ sections or inferred from comparison points and feature explanations.

### 5b. Extract testimonials

Scrape any customer quotes, reviews, or social proof from the site. Look for:
- Testimonial sections (quote cards, carousels)
- Tweet embeds or social proof sections
- Customer review excerpts
- Speaker/attendee quotes (for event sites)

If the site has NO real testimonials, write an empty array — never invent them.

### 6. Present summary (standalone mode only)

**Skip in pipeline mode** — go directly to Step 7.

### 7. Generate JSON files

Write all files to `of1/config/`. Schemas below.

**products.json:**
```json
[
  {
    "id": "product-slug",
    "name": "Product Name",
    "category": "category",
    "price": 999,
    "currency": "USD",
    "images": ["https://branch--repo--owner.aem.page/media/product-slug-1.png"],
    "url": "https://site.com/products/slug",
    "description": "Detailed description (2-3 sentences). Sent to the LLM for generation.",
    "features": ["Feature 1", "Feature 2"],
    "highlights": ["Key selling point 1", "Key selling point 2"],
    "persona": "persona-id",
    "useCase": "use-case-id",
    "keywords": ["search term 1", "search term 2", "synonym", "related phrase"]
  }
]
```

**CRITICAL fields:**
- `persona` (string): primary persona ID — used for RAG scoring boost
- `useCase` (string): primary use-case ID — used for RAG scoring boost
- `keywords` (array of 8–12 strings): search terms a user might type — each match adds +2 to score
- `images` (array): **MUST be site-domain (`.aem.page`/`.aem.live`) URLs after upload+preview** (see Step 9 below). Never external CDN URLs, never `content.da.live` (access-restricted).
- `description` (string): must be rich enough for the LLM to generate detailed deep-dive content

Without `persona`, `useCase`, and `keywords`, the worker cannot match user queries to the right products.

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

This isn't just cosmetic: it renders as the demo's Intent Map radar, but when a viewer clicks "Personalize" for that persona, this exact value is sent to the OF1 worker's personalize endpoint and directly drives real generation — which of the 25 templates gets selected, the RAG retrieval mode, and the intent context put in the LLM prompt (see `of1-demo-orchestrator/knowledge/worker-config-schemas.md` § `personas.json` for the full trace). Get it wrong and the persona won't just look wrong on the radar — it'll get shown content for the wrong intent.

`keywords` (10–12 strings) are matched against the user's query. Without them, persona matching fails silently and defaults to the first persona.

**use-cases.json:**
```json
[
  {
    "id": "use-case-slug",
    "name": "Use Case Name",
    "description": "What this involves and who it's for",
    "keywords": ["trigger", "keywords", "user", "would", "search", "for"],
    "recommendedProducts": ["product-id-1"],
    "relatedPersonas": ["persona-id-1"]
  }
]
```

`keywords` (8–12 strings) — without them, use-case matching never triggers.

**features.json:**
```json
[
  {
    "id": "feature-slug",
    "name": "Feature Name",
    "description": "What it does and why it matters.",
    "productIds": ["product-1"],
    "category": "feature-category"
  }
]
```

**faqs.json:**
```json
[
  {
    "id": "faq-slug",
    "question": "The question a user might ask?",
    "answer": "The full answer.",
    "relatedProducts": ["product-id"],
    "category": "faq-category"
  }
]
```

**testimonials.json:**
```json
[
  {
    "id": "testimonial-slug",
    "quote": "The actual quote text from the website.",
    "author": "Real Person Name",
    "role": "Their actual title/role",
    "company": "Their actual company (if shown)",
    "source": "twitter|website|review|event"
  }
]
```

**CRITICAL:** Only include testimonials that are **actually on the website**. Never invent quotes, names, or companies. If the site has no testimonials, write `[]`. The worker uses these to fill testimonial/quote slots in templates — hallucinated social proof is unacceptable.

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

# Generate manifest from products.json
python3 << 'EOF'
import json
with open("of1/config/products.json") as f:
    products = json.load(f)
manifest = [{"productId": p["id"], "urls": p.get("images", [])} for p in products if p.get("images")]
with open("/tmp/image-manifest.json", "w") as f:
    json.dump(manifest, f)
print(f"Manifest: {len(manifest)} products with images")
EOF

# Parallel download + upload + rewrite products.json with DA URLs
node "$SKILL_DIR/assets/download-images.mjs" \
  --input /tmp/image-manifest.json \
  --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
  --output /tmp/image-mapping.json \
  --update-products
```

The `--update-products` flag rewrites `products.json[*].images` to the site's `.aem.page/media/...` URLs automatically.

#### Clean up temp files before any commit

```bash
rm -rf /tmp/image-manifest.json /tmp/image-mapping.json
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

If ANY of these are false, GO BACK and complete Step 9. Do not proceed.

This skill runs alongside `of1-extract-brand-voice`. Both must complete before the content track is treated as done.

```bash
cat > "$OF1_STATE_DIR/of1-extract-content-status.json" <<EOF
{"stage":3,"skill":"of1-extract-content","status":"done","summary":"Content metadata: [N] products, [M] personas, [P] use cases, [Q] features, [R] FAQs. All images on DA."}
EOF
```

The orchestrator waits for both `of1-extract-content-status.json` and `of1-extract-brand-voice-status.json` before treating the content pair as complete.
