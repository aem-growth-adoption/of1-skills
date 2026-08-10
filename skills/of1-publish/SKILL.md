---
name: of1-publish
description: Commit config to git, sync to OF1 worker via EDS, generate demo hub, and verify generation works.
user-invocable: false
---

# OF1 Deploy

Commit config files, trigger sync to the OF1 worker, generate the demo hub, run the pre-launch checklist, and verify generation works.

## Env — orchestrator exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-publish-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local `of1-demo-orchestrator` git clone |
| `SKILL_DIR` | absolute path to this skill (used to find `assets/fill-demo-hub.*`) |
| `ADOBE_IMS_TOKEN` | raw DA token (preferred) |
| `OF1_TOKEN_FILE` | path to a `{"access_token":"…"}` JSON (fallback) |

Resolve `DA_TOKEN` (a shell local, not an input — canonical credential is `ADOBE_IMS_TOKEN`/`OF1_TOKEN_FILE`; see `of1-demo-orchestrator/knowledge/pipeline-contract.md` § "Environment variables") and read repo config:

```bash
DA_TOKEN="${ADOBE_IMS_TOKEN:-$(jq -r .access_token "$OF1_TOKEN_FILE")}"
[ -n "$DA_TOKEN" ] || { echo "FAIL: no DA token available" >&2; exit 1; }

REPO_CONFIG=$(cat "$OF1_STATE_DIR/repo-config.json")
OWNER=$(jq -r .owner   <<<"$REPO_CONFIG")
REPO=$(jq -r .repo     <<<"$REPO_CONFIG")
BRANCH=$(jq -r .branch <<<"$REPO_CONFIG")
DOMAIN=$(jq -r .domain <<<"$REPO_CONFIG")

cd "$OF1_DEMO_REPO"
PREVIEW_BASE="https://${BRANCH}--${REPO}--${OWNER}.aem.page"
TENANT_ID="${BRANCH}--${REPO}--${OWNER}"
WORKER_URL="https://of1-gen-web-service.franklin-prod.workers.dev"
```

`playwright-cli` calls use modern @playwright/cli syntax: `open` + `--full-page` (bare boolean) + `--filename`. This works on both SLICC-native and CC `playwright-cli` binaries.

## How config sync works

The OF1 worker syncs config from the EDS repo directly:

1. Config JSON files are committed to git at `/of1/config/*.json`
2. EDS serves them as static files at `${PREVIEW_BASE}/of1/config/{file}.json`
3. `POST ${WORKER_URL}/api/tenants/${TENANT_ID}/sync` tells the worker to fetch each config from EDS and store in R2
4. The worker auto-indexes vectors for products, features, and faqs

**Tenant ID format:** `{branch}--{repo}--{owner}` (e.g. `frescopa--labs-abc123--of1-labs`)

## Process

### 1. Verify config files exist

```bash
for f in brand-voice products personas use-cases features faqs suggestions cta-template of1-endpoint; do
  if [ -f "of1/config/${f}.json" ]; then
    echo "  ✓ ${f}.json ($(wc -c < "of1/config/${f}.json") bytes)"
  else
    echo "  ✗ ${f}.json MISSING"
  fi
done
```

`of1-endpoint.json` must exist (created by `of1-check-dependencies`). If missing, fail — don't recreate it here.

### 2. Deploy the replica prototypes as standalone deliverables

`stardust:replica` writes the standalone prototype archetypes to
`stardust/prototypes/<slug>-proposed.html`, but nothing serves them — so they're invisible in the
demo. Copy each into `deliverables/` (EDS serves that dir statically, exactly like `discovery.html`),
where the "Commit and push" step's `git add deliverables/` picks them up and the hub links them:

```bash
if ls stardust/prototypes/*.html >/dev/null 2>&1; then
  mkdir -p deliverables
  for f in stardust/prototypes/*.html; do
    stem=$(basename "$f" .html)
    cp "$f" "deliverables/prototype-${stem}.html"
    echo "  ✓ deployed prototype-${stem}.html"
  done
else
  echo "  (no stardust/prototypes/*.html — content-only demo or replica skipped)"
fi
```

The hub's prototype renderer (`fill-demo-hub.mjs` → `renderPrototypes`) links exactly these
`deliverables/prototype-<slug>.html` files, and Check 5 does not assert them individually (they're
best-effort deliverables), so a content-only demo with no prototypes is not a hard failure.

### 3. Generate demo hub page

**You MUST create `/tmp/da-pages.txt` before calling the fill script** — it reads this file to list the EDS overlay pages in the hub. Without it, the hub shows prototypes but no live EDS pages.

```bash
curl -s -H "Authorization: Bearer $DA_TOKEN" \
  -H "x-content-source-authorization: Bearer $DA_TOKEN" \
  "https://admin.da.live/list/${OWNER}/${REPO}" \
  | jq -r '.[] | select(.ext == "html") | .name + ".html"' > /tmp/da-pages.txt

# Verify it's not empty
[ -s /tmp/da-pages.txt ] || echo "WARN: no DA pages found — hub will be missing EDS page links"

# Generate the demo hub from the template
node "$SKILL_DIR/assets/fill-demo-hub.mjs" . "${DOMAIN}"
```

This reads all config, finds prototypes, discovers EDS pages from `/tmp/da-pages.txt`, and writes `deliverables/index.html`. Do NOT hand-write the hub HTML.

### 4. Commit and push

```bash
git add of1/config/ deliverables/
git commit -m "feat: deploy config and demo hub for ${DOMAIN}"
git push origin "$BRANCH"
```

After push, config files are immediately available at `${PREVIEW_BASE}/of1/config/{file}.json`.

### 5. Sync config to the OF1 worker

```bash
RESPONSE=$(curl -s -X POST "${WORKER_URL}/api/tenants/${TENANT_ID}/sync")
echo "$RESPONSE" | jq '.'

OK=$(echo "$RESPONSE" | jq -r '.ok')
SYNCED=$(echo "$RESPONSE" | jq -r '.synced | length')
ERRORS=$(echo "$RESPONSE" | jq -r '.errors | length')
VECTORS=$(echo "$RESPONSE" | jq -r '.vectors.indexed')

echo "Sync result: ok=$OK, synced=$SYNCED files, errors=$ERRORS, vectors=$VECTORS"

if [ "$OK" != "true" ]; then
  echo "ERROR: Sync failed!" >&2
  echo "$RESPONSE" | jq '.errors'
fi
```

### 6. Verify tenant is ready

```bash
STATUS=$(curl -s "${WORKER_URL}/api/tenants/${TENANT_ID}/status")
READY=$(echo "$STATUS" | jq -r '.ready')
echo "Tenant ready: $READY"

if [ "$READY" != "true" ]; then
  echo "ERROR: Tenant is NOT ready!" >&2
  echo "$STATUS" | jq '.config | to_entries[] | select(.value == false) | .key'
fi
```

Required for `ready: true`: `hasOf1Endpoint`, `hasProducts`, `hasBrandVoice`, `hasSuggestions`, `hasTemplates`.

### 7. Test generation

```bash
curl -s -X POST "${WORKER_URL}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"domain\":\"${TENANT_ID}\",\"query\":\"show me your best products\",\"followUp\":false,\"context\":{\"browsing\":[],\"conversationHistory\":[]}}" > /tmp/gen-test.txt

echo "Generation test:"
head -50 /tmp/gen-test.txt
```

Verify: sections are generated (not empty), image URLs return 200, suggestions appear at the end.

## Pre-Launch Checklist (MANDATORY)

ALL checks must pass before marking the demo done. If any fail, fix the issue and re-check.

### Check 1: OF1 page loads with styled search UI

```bash
playwright-cli open "${PREVIEW_BASE}/of1"
sleep 6
playwright-cli screenshot --full-page --filename "$OF1_STATE_DIR/check-of1.png"
```

**Pass:** branded search UI visible (title, subtitle, input, chips), styled header nav (dark translucent bar, white links), styled footer. No raw unstyled content.

**If fails:** check `blocks/of1/of1.js`/`blocks/of1/of1.css` were pushed and the `of1` block's table cell reads exactly `of1`, or the site's own `styles/styles.css` foundation isn't loading (check the preview build succeeded).

### Check 2: OF1 nav/footer renders via the standard header/footer blocks

```bash
playwright-cli open "${PREVIEW_BASE}/of1"
sleep 6
# Verify concrete elements exist — not just a visual comparison
playwright-cli eval "() => (document.querySelector('header .header') ? 'header OK' : 'HEADER MISSING')"
playwright-cli eval "() => (document.querySelector('header .header a') ? 'nav links OK' : 'NAV LINKS MISSING')"
playwright-cli eval "() => (document.querySelector('footer .footer') ? 'footer OK' : 'FOOTER MISSING')"
```

**Pass criteria (concrete, not just visual):**
- `header .header` block renders (vanilla `aem-boilerplate`'s `decorateBlock` output — confirm the target's `blockWrapperClass` in `stardust/runtime-contract.json` if it drifts)
- At least one nav link is present inside the header block
- `footer .footer` block renders with styled content (not empty)

**If fails:** the site's `content/nav.html`/`content/footer.html` didn't push correctly, or the preview hasn't picked up the latest deploy yet — re-check `stardust:replica` (for the full e2e pipeline, which produces the replica site's nav/footer chrome) or the existing site's own chrome (for `of1-integration`, where nav/footer already existed before this pipeline ran).

### Check 3: All products have ≥2 images

```bash
python3 << 'EOF'
import json, sys

with open('of1/config/products.json') as f:
    products = json.load(f)

all_good = True
for p in products:
    images = p.get('images', [])
    if len(images) < 2:
        print(f"  ✗ {p.get('name', 'Unknown')}: only {len(images)} image(s)")
        all_good = False

if not all_good:
    print("\n✗ FAIL: Some products have fewer than 2 images")
    sys.exit(1)
print(f"\n✓ All {len(products)} products have ≥2 images")
EOF
```

All image URLs must be from the site's own domain (`https://${BRANCH}--${REPO}--${OWNER}.aem.page/media/...`) — never `content.da.live` (access-restricted, not public) and never external CDN URLs.

### Check 4: Template catalog has 15 entries

```bash
python3 << 'EOF'
import json, sys
from pathlib import Path

p = Path('templates/templates-catalog.json')
if not p.exists():
    print("✗ templates-catalog.json missing — of1-build-templates did not run", file=sys.stderr)
    sys.exit(1)

catalog = json.loads(p.read_text())
of1_entries = [t for t in catalog.get('templates', []) if t.get('name', '').startswith('of1-')]

if len(of1_entries) < 15:
    print(f"✗ Only {len(of1_entries)} of1-* templates (need 15)", file=sys.stderr)
    sys.exit(1)

intents = {t.get('intent') for t in of1_entries}
missing = {'comparison', 'recommendation', 'deep-dive', 'budget', 'discovery'} - intents
if missing:
    print(f"✗ Missing intents: {missing}", file=sys.stderr)
    sys.exit(1)

print(f"✓ Catalog has {len(of1_entries)} of1-* templates across all 5 intents")
EOF
```

### Check 5: All deliverable URLs return 200

Only assert URLs this pipeline path actually produces. `brand-review.html` is **not** produced by
any current path (there is no brand-review step) — do not assert it. The home page is served at `/`,
**not** `/home` — assert `/`. `/nav` and `/footer` are the chrome fragments every page's
header/footer blocks fetch (via `loadFragment` → `${path}.plain.html`); if either 404s, every page
renders chromeless (Check 2 only inspects the `/of1` DOM — it does not prove the fragments exist), so
assert `nav.plain.html` and `footer.plain.html` here too. `of1-style-generative-block` Step 6b
guarantees these exist before deploy.

```bash
LINKS=(
  "${PREVIEW_BASE}/"
  "${PREVIEW_BASE}/nav.plain.html"
  "${PREVIEW_BASE}/footer.plain.html"
  "${PREVIEW_BASE}/gallery/index.html"
  "${PREVIEW_BASE}/of1"
  "${PREVIEW_BASE}/deliverables/config-review.html"
  "${PREVIEW_BASE}/deliverables/index.html"
)
# Full e2e pipeline only (discovery ran): also assert the discovery deliverable.
# When discovery never ran (e.g. of1-integration against an existing site), the
# output file is absent and this URL is skipped automatically — no flow-specific edit needed.
[ -f "${OF1_STATE_DIR}/of1-discovery-output.md" ] && LINKS+=("${PREVIEW_BASE}/deliverables/discovery.html")

ALL_OK=true
for URL in "${LINKS[@]}"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
  if [ "$STATUS" = "200" ]; then
    echo "  ✓ $STATUS $URL"
  else
    echo "  ✗ $STATUS $URL"
    ALL_OK=false
  fi
done

# HARD gate: a non-200 deliverable means the demo is broken. Fail loud — do NOT
# let the pipeline report "ready" over a 404. (Previously this only printed a
# warning and the run continued, which is how chromeless/404 demos shipped.)
[ "$ALL_OK" = "true" ] || { echo "✗ FAIL: Some deliverable URLs return non-200 — demo is not ready" >&2; exit 1; }
```

### Check 6: Generation test (end-to-end worker verification)

```bash
RESPONSE=$(curl -s -X POST "${WORKER_URL}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"domain\":\"${TENANT_ID}\",\"query\":\"show me your best products\",\"followUp\":false,\"context\":{\"browsing\":[],\"conversationHistory\":[]}}")

# Verify non-empty response with actual content
SECTIONS=$(echo "$RESPONSE" | grep -c '"type"' || echo "0")
if [ "$SECTIONS" -ge 2 ]; then
  echo "✓ Generation returned ${SECTIONS} sections"
else
  echo "✗ FAIL: generation returned ${SECTIONS} sections (expected ≥2)" >&2
  echo "$RESPONSE" | head -20
  exit 1
fi
```

**Pass:** response contains ≥2 sections with content. **If fails:** check worker sync status, verify `hasTemplates` is true in tenant status.

### Checklist summary

Only mark this deploy step (`of1-publish`) done if ALL 6 pass:

| # | Check |
|---|-------|
| 1 | OF1 page loads with styled search UI |
| 2 | OF1 nav/footer renders via the standard header/footer blocks (concrete element checks) |
| 3 | All products have ≥2 images |
| 4 | Template catalog has 15 of1-* entries across all 5 intents |
| 5 | All deliverable URLs return 200 |
| 6 | `/api/generate` returns ≥2 sections (end-to-end worker test) |

## Completion

Present final report:

```
## Demo Ready: ${DOMAIN}

**Demo Hub:** ${PREVIEW_BASE}/deliverables/index.html
**OF1 page:** ${PREVIEW_BASE}/of1
**Gallery:** ${PREVIEW_BASE}/gallery/index.html
**Worker tenant:** ${TENANT_ID} (synced + verified)

Pre-launch checklist: 6/6 passed ✓
```

```bash
HUB_URL="${PREVIEW_BASE}/deliverables/index.html"
OF1_URL="${PREVIEW_BASE}/of1"
cat > "$OF1_STATE_DIR/of1-publish-status.json" <<EOF
{
  "stage": 3,
  "skill": "of1-publish",
  "status": "done",
  "deliverables": [
    { "url": "${HUB_URL}", "label": "Demo hub" },
    { "url": "${OF1_URL}", "label": "OF1 page" }
  ],
  "summary": "Deployed + all 5 pre-launch checks passed."
}
EOF
```
