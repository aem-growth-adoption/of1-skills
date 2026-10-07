---
name: of1-publish
description: Assert only config.json (+ cta-template.json in pipeline mode) is in git, refresh the /of1 page, sync the OF1 worker, generate the demo hub (DA edit links + "what worked" panel), and run the pre-launch checks.
user-invocable: true
---

# OF1 Deploy

Assert the git config set, refresh the `/of1` page, sync the OF1 worker, generate the demo hub, commit, and run the pre-launch checklist. Author-tunable config (brand voice, personas, chips, landing copy, templates, knowledge pages) already lives in DA — the earlier skills wrote and previewed it; this skill commits only `of1/config/config.json` (+ `of1/config/cta-template.json` in pipeline mode) and `deliverables/index.html`.

## Env — orchestrator exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-publish-status.json` and the staged hub inputs under `hub/` |
| `OF1_PIPELINE_MODE` | `1` in pipeline mode — `cta-template.json` is expected, committed and checked (check 7) |
| `OF1_GENWEB_URL` | optional gen-web worker override (default prod) |
| `OF1_DEMO_REPO` | absolute path to the local `of1-demo-orchestrator` git clone |
| `SKILL_DIR` | absolute path to this skill (used to find `assets/fill-demo-hub.*` and the sibling `of1-style-generative-block` skill) |
| `ADOBE_IMS_TOKEN` | raw DA token (preferred) |
| `OF1_TOKEN_FILE` | path to a `{"access_token":"…"}` JSON (fallback) |

Resolve `DA_TOKEN` (a shell local, not an input — canonical credential is `ADOBE_IMS_TOKEN`/`OF1_TOKEN_FILE`; see `of1-demo-orchestrator/knowledge/pipeline-contract.md` § "Environment variables") and read repo config:

```bash
# Full resolution order (see pipeline-contract.md): ADOBE_IMS_TOKEN → OF1_TOKEN_FILE
# → $PWD/.hlx/.da-token.json → $OF1_DEMO_REPO/.hlx/.da-token.json.
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

cd "$OF1_DEMO_REPO"
PREVIEW_BASE="https://${BRANCH}--${REPO}--${OWNER}.aem.page"
TENANT_ID="${BRANCH}--${REPO}--${OWNER}"
# gen-web worker the pipeline syncs + generates against. Defaults to prod;
# override per run with OF1_GENWEB_URL (of1-labs "gen-web worker URL" advanced
# field) to point a branch/dev deploy at a dev worker without touching prod.
WORKER_URL="${OF1_GENWEB_URL:-https://of1-gen-web-service.franklin-prod.workers.dev}"
```

`playwright-cli` calls follow `of1-demo-orchestrator/knowledge/common-pitfalls.md` § 9 "playwright-cli syntax" (`open`, `--full-page` bare, `--filename`, `eval` as a function form). Works on both SLICC-native and CC binaries.

## How config sync works

The worker pulls each tenant source from the preview host `${PREVIEW_BASE}` on `POST ${WORKER_URL}/api/tenants/${TENANT_ID}/sync`:

| Source | Where | Sync file |
|---|---|---|
| `of1/config/config.json` | git (code bus) | `config` |
| `of1/config/cta-template.json` | git, pipeline mode only | `cta-template` |
| `/of1/brand-voice` | DA doc | `brand-voice` |
| `/of1/config/suggestions` | DA sheet | `suggestions` |
| `/of1/strategy` | DA doc (optional, author-created) | `strategy` |
| `/templates/*` | DA docs | `templates` |
| `/of1/knowledge/**` | DA docs, via `query-index.json` | `content` (indexed as RAG chunks) |

`/of1/config/personas` (DA sheet) and the `/of1` page are read by the extension / client SDK, not synced. The sync response is `{ok, id, domain, synced, errors, content: {indexed} | null}`. Shapes: `of1-integration/knowledge/worker-config-schemas.md`.

**Tenant ID format:** `{branch}--{repo}--{owner}` (e.g. `frescopa--labs-abc123--of1-labs`)

## Process

```bash
HUB="$OF1_STATE_DIR/hub"
mkdir -p "$HUB"
ALLOWED="of1/config/config.json"
[ "${OF1_PIPELINE_MODE:-}" = "1" ] && ALLOWED="$ALLOWED of1/config/cta-template.json"
```

### 1. Assert the git config set (check 1)

Only `of1/config/config.json` (and `of1/config/cta-template.json` in pipeline mode) may be tracked under `of1/config/`. Any other tracked file — especially `personas.json` / `suggestions.json` — would shadow the DA sheet at the same URL (a git file beats a DA sheet on EDS). Fail and list the extras; do not delete them here — `of1-check-dependencies` step 3b ("Remove legacy `of1/config/*.json`") removes them on every run, so this check is the backstop for when that was declined or skipped.

```bash
EXTRA=$(git ls-files of1/config | while read -r f; do
  case " $ALLOWED " in *" $f "*) ;; *) echo "$f" ;; esac
done)
if [ -n "$EXTRA" ]; then
  echo "✗ FAIL (check 1): unexpected files tracked under of1/config/ — they shadow DA config or are no longer read:" >&2
  echo "$EXTRA" | sed 's/^/    /' >&2
  echo "  Re-run of1-check-dependencies (step 3b removes legacy of1/config JSON: scoped git rm + commit + push), then re-run of1-publish." >&2
  exit 1
fi
[ -f of1/config/config.json ] || { echo "✗ FAIL: of1/config/config.json missing — run of1-check-dependencies" >&2; exit 1; }
if [ "${OF1_PIPELINE_MODE:-}" = "1" ] && [ ! -f of1/config/cta-template.json ]; then
  echo "✗ FAIL: pipeline mode but of1/config/cta-template.json missing — of1-build-cta-template did not run" >&2; exit 1
fi
echo "✓ git config set OK: $(git ls-files of1/config | tr '\n' ' ')"
```

### 2. Refresh the `/of1` page

`of1-style-generative-block` may have written `/of1` before `of1-build-quick-suggestions` produced the landing copy (`$OF1_STATE_DIR/of1-landing.json`). Run **`of1-style-generative-block` Step 5 ("Upload OF1 DA content") again**, exactly as written there — read `$SKILL_DIR/../of1-style-generative-block/SKILL.md` § Step 5 and run its bash block in this shell, then its Step 5b gate (it needs `DA_TOKEN`, `OWNER`, `REPO`, `BRANCH`, `DOMAIN`, `OF1_STATE_DIR`, `OF1_GENWEB_URL`, all set above). It is idempotent: it PUTs the whole `/of1` doc (with the `title`/`subtitle`/`placeholder` rows now present) and previews it, failing loud on a non-2xx preview. Do not copy the HTML here — Step 5 is the single source of truth for the `/of1` document.

### 2b. Index coverage — `config.json` overrides for config-service sites

The worker discovers `/templates/*` docs and `/of1/knowledge/**` pages from the site-root `/query-index.json` (built from `helix-query.yaml`, which `of1-check-dependencies` step 8 authors). Some sites manage their index in the **AEM configuration service** instead — a repo `helix-query.yaml` is not honoured there, and `/query-index.json` 404s or doesn't list OF1 paths. Probe before committing/syncing; when the query index doesn't cover both, point the worker at the right sources through `config.json`:

- `templates.names` — the DA `/templates` doc names (worker then skips the query index for templates)
- `contentIngestion.indexPath` — the first index (`/sitemap.json`, then any index the user names) that lists `/of1/knowledge/` paths

```bash
# Every path in an EDS JSON index (single- or multi-sheet), one per line.
index_paths() {
  curl -s --connect-timeout 10 --max-time 30 "${PREVIEW_BASE}$1" 2>/dev/null \
    | jq -r '[.. | objects | .path? // empty | strings] | .[]' 2>/dev/null
}
QI_PATHS=$(index_paths /query-index.json)
QI_HAS_TEMPLATES=false; QI_HAS_KNOWLEDGE=false
grep -q '^/templates/' <<<"$QI_PATHS" && QI_HAS_TEMPLATES=true
grep -q '^/of1/knowledge/' <<<"$QI_PATHS" && QI_HAS_KNOWLEDGE=true
echo "query-index.json: templates=$QI_HAS_TEMPLATES knowledge=$QI_HAS_KNOWLEDGE"

CFG=of1/config/config.json
CFG_NEW=$(cat "$CFG")
if [ "$QI_HAS_TEMPLATES" != "true" ]; then
  # (a) templates: list DA /templates (names of .html entries, no extension).
  TPL_NAMES=$(curl -s --connect-timeout 10 --max-time 30 -H "Authorization: Bearer $DA_TOKEN" \
    "https://admin.da.live/list/${OWNER}/${REPO}/templates" \
    | jq -c '[.[]? | select(.ext == "html") | .name] | sort' 2>/dev/null)
  if [ -n "$TPL_NAMES" ] && [ "$TPL_NAMES" != "[]" ]; then
    CFG_NEW=$(jq --argjson n "$TPL_NAMES" '.templates = ((.templates // {}) + {names: $n})' <<<"$CFG_NEW")
    echo "→ templates.names = $TPL_NAMES"
  else
    echo "⚠ DA /templates is empty — run of1-build-templates; check 3 (hasTemplates) will fail" >&2
  fi
fi
if [ "$QI_HAS_KNOWLEDGE" != "true" ]; then
  # (b) knowledge: first candidate index that lists /of1/knowledge/ paths.
  # Append any index the user names, e.g. INDEX_CANDIDATES+=("/en/query-index.json").
  INDEX_CANDIDATES=(/sitemap.json)
  KNOWLEDGE_INDEX=""
  for idx in "${INDEX_CANDIDATES[@]}"; do
    if index_paths "$idx" | grep -q '^/of1/knowledge/'; then KNOWLEDGE_INDEX="$idx"; break; fi
  done
  if [ -n "$KNOWLEDGE_INDEX" ]; then
    CFG_NEW=$(jq --arg p "$KNOWLEDGE_INDEX" '.contentIngestion = ((.contentIngestion // {}) + {indexPath: $p})' <<<"$CFG_NEW")
    echo "→ contentIngestion.indexPath = $KNOWLEDGE_INDEX"
  else
    echo "⚠ no index lists /of1/knowledge/ (tried: ${INDEX_CANDIDATES[*]}) — check 2 (content.indexed > 0) will fail." >&2
    echo "  The site owner must add /of1/knowledge/** to an index (helix-query.yaml or the AEM config service)." >&2
  fi
fi
# Merge result (keeps domain + any existing fields); commit ONLY config.json.
if [ "$(jq -S . <<<"$CFG_NEW")" != "$(jq -S . "$CFG")" ]; then
  jq . <<<"$CFG_NEW" > "$CFG"
  git add -- "$CFG"
  git commit -m "feat: OF1 index overrides for ${DOMAIN}" -- "$CFG"
  git push origin "$BRANCH"
  echo "✓ $CFG updated + pushed"
else
  echo "✓ query-index covers OF1 paths (or overrides already set) — config.json unchanged"
fi
```

If `/query-index.json` lists both `/templates/` and `/of1/knowledge/` paths, nothing is written. If the knowledge pages were published moments ago and the repo's `helix-query.yaml` does include them, the index may just be lagging — wait a minute and re-run this step before concluding the site needs overrides. If no index lists `/of1/knowledge/`, ask the user whether the site has another index (append it to `INDEX_CANDIDATES` and re-run); otherwise continue — check 2 will report the gap. Field shapes: `of1-integration/knowledge/worker-config-schemas.md` § `config.json`.

### 3. Push the git config

`of1-check-dependencies` already committed `config.json`; in pipeline mode `of1-build-cta-template` leaves `cta-template.json` uncommitted. Push it before syncing so the worker can read it:

```bash
git add -- $ALLOWED
if ! git diff --cached --quiet -- $ALLOWED; then
  git commit -m "feat: OF1 config for ${DOMAIN}" -- $ALLOWED
  git push origin "$BRANCH"
fi
```

### 4. Sync → `hub/sync.json` (check 2)

```bash
curl -s -X POST "${WORKER_URL}/api/tenants/${TENANT_ID}/sync" > "$HUB/sync.json"
jq . "$HUB/sync.json"
OK=$(jq -r '.ok' "$HUB/sync.json")
INDEXED=$(jq -r '.content.indexed // 0' "$HUB/sync.json")
echo "Sync: ok=$OK synced=$(jq -c '.synced' "$HUB/sync.json") errors=$(jq '.errors | length' "$HUB/sync.json") content.indexed=$INDEXED"
```

Pass: `ok: true` **and** `content.indexed > 0`. Per-file failures are in `.errors[]` (`{file, error}`) — e.g. `brand-voice: empty document` means `/of1/brand-voice` wasn't previewed. If `content.indexed` is 0 while `$OF1_STATE_DIR/knowledge-pages.json` is non-empty, the knowledge pages aren't in the index the worker reads (`/query-index.json`, or `contentIngestion.indexPath` set in step 2b): check the site's `helix-query.yaml` (or, for config-service sites, the AEM config-service index) covers `/of1/knowledge/**` (an existing file is never edited by the skills — `of1-check-dependencies` warns when it doesn't), that `.hlxignore` doesn't exclude them, and that the pages are **published** (live), not just previewed. Don't stop on failure yet — finish steps 5–8 so the hub shows what failed, then fail in the checklist.

### 5. Tenant status → `hub/status.json` (check 3)

```bash
curl -s "${WORKER_URL}/api/tenants/${TENANT_ID}/status" > "$HUB/status.json"
jq . "$HUB/status.json"
echo "ready=$(jq -r .ready "$HUB/status.json")"
jq -r '.config | to_entries[] | select(.value == false or .value == 0) | "  ✗ \(.key)"' "$HUB/status.json"
```

`ready` = `hasTemplates` (renderable DA templates) **and** `hasContent` (indexed knowledge chunks > 0). `hasBrandVoice`, `hasSuggestions`, `hasCtaTemplate`, `hasStrategy` are reported, not gated (still expect `hasBrandVoice`/`hasSuggestions` true — missing means the DA doc/sheet wasn't previewed).

### 6. DA listings → `hub/da-{pages,templates,knowledge}.txt`

```bash
da_list() {
  curl -s -H "Authorization: Bearer $DA_TOKEN" \
    -H "x-content-source-authorization: Bearer $DA_TOKEN" \
    "https://admin.da.live/list/${OWNER}/${REPO}$1"
}
# Site pages (one "<name>.html" per line) — the hub's EDS pages section.
da_list ""               | jq -r '.[] | select(.ext == "html") | .name + ".html"' > "$HUB/da-pages.txt"
# Template docs (names, no extension) — the authoring showcase.
da_list "/templates"     | jq -r '.[] | select(.ext == "html") | .name' > "$HUB/da-templates.txt"
# Knowledge pages (slugs, no extension).
da_list "/of1/knowledge" | jq -r '.[] | select(.ext == "html") | .name' > "$HUB/da-knowledge.txt"
for f in da-pages da-templates da-knowledge; do
  [ -s "$HUB/$f.txt" ] || echo "WARN: $HUB/$f.txt is empty — that hub section will be empty"
done
```

### 7. Generate the demo hub

```bash
node "$SKILL_DIR/assets/fill-demo-hub.mjs" . "${DOMAIN}"
```

Reads `$OF1_STATE_DIR/repo-config.json`, `of1-discovery-output.md`, `pipeline-audit.json`, every `$OF1_STATE_DIR/of1-*-status.json`, and the `hub/` files staged above; links prototypes (`deliverables/prototype-*.html`, committed by Stage 2b — a content-only demo has none) and `deliverables/discovery.html` when present. Writes `deliverables/index.html` with DA edit links for each authored item (brand voice, personas, suggestions, `/of1`, `/templates`, `/of1/knowledge`) and a **"What worked"** panel (per-skill status, sync `synced`/`errors`/`content.indexed`, `ready` + failing `/status` flags). Do NOT hand-write the hub HTML.

### 8. Commit and push the hub

```bash
git add -- deliverables/index.html
# Same guard as step 3: an identical hub (same-day re-run) leaves nothing staged,
# and an unguarded `git commit` would exit 1.
if ! git diff --cached --quiet -- deliverables/index.html; then
  git commit -m "feat: OF1 demo hub for ${DOMAIN}" -- deliverables/index.html
  git push origin "$BRANCH"
fi
```

Never `git add of1/config/` or `git add -A` — only the explicit allowed paths (step 3) and the hub.

## Pre-Launch Checklist (MANDATORY)

ALL applicable checks must pass before marking the demo done. If any fail, fix the issue (usually: preview the DA item, re-run the producing skill) and re-run from step 4.

### Check 1: Git config set

Step 1 passed: `git ls-files of1/config` ⊆ {`of1/config/config.json`} (+ `of1/config/cta-template.json` in pipeline mode).

### Check 2: Sync ok and knowledge indexed

```bash
[ "$(jq -r .ok "$HUB/sync.json")" = "true" ] || { echo "✗ FAIL (check 2): sync ok != true — see $HUB/sync.json .errors" >&2; exit 1; }
[ "$(jq -r '.content.indexed // 0' "$HUB/sync.json")" -gt 0 ] || { echo "✗ FAIL (check 2): content.indexed = 0 — /of1/knowledge/** not in the worker's index (query-index.json or contentIngestion.indexPath — see step 2b; pages must be published live)" >&2; exit 1; }
echo "✓ sync ok, $(jq -r .content.indexed "$HUB/sync.json") chunk(s) indexed"
```

### Check 3: Tenant ready

```bash
[ "$(jq -r .ready "$HUB/status.json")" = "true" ] || {
  echo "✗ FAIL (check 3): tenant not ready; failing flags:" >&2
  jq -r '.config | to_entries[] | select(.value == false or .value == 0) | "  \(.key)"' "$HUB/status.json" >&2
  exit 1
}
echo "✓ tenant ready"
```

### Check 4: `/of1` renders header, footer and the `of1` block with the authored title and ≥1 chip

```bash
playwright-cli open "${PREVIEW_BASE}/of1"
sleep 6
playwright-cli screenshot --full-page --filename "$OF1_STATE_DIR/check-of1.png"
playwright-cli eval "() => (document.querySelector('header .header a') ? 'header OK' : 'HEADER MISSING')"
playwright-cli eval "() => (document.querySelector('footer .footer') && document.querySelector('footer .footer').textContent.trim() ? 'footer OK' : 'FOOTER MISSING')"
playwright-cli eval "() => (document.querySelector('main .of1') ? 'of1 block OK' : 'OF1 BLOCK MISSING')"
playwright-cli eval "() => (document.querySelector('.of1 .of1-title')?.textContent.trim() || 'TITLE MISSING')"
playwright-cli eval "() => ('chips: ' + document.querySelectorAll('.of1 .of1-chip').length)"
jq -r '.title // "(no of1-landing.json title — SDK default expected)"' "$OF1_STATE_DIR/of1-landing.json" 2>/dev/null
```

**Pass:** header block with ≥1 nav link, non-empty footer block, the `of1` block, its title equals the `title` in `$OF1_STATE_DIR/of1-landing.json` (the authored landing copy; when that file is absent the SDK default is acceptable), and `chips: N` with N ≥ 1. Selectors follow vanilla `aem-boilerplate` (`blockWrapperClass` in `stardust/runtime-contract.json` if it drifts) and `blocks/of1/of1.css` (`.of1-title`, `.of1-chip`).

**If fails:** title missing/default → step 2 didn't run after `of1-build-quick-suggestions` (re-run it). No chips → `/of1/config/suggestions` not previewed or `hasSuggestions` false. No header/footer → `/nav` / `/footer` missing (`of1-style-generative-block` Step 4) or the preview hasn't picked up the deploy. No block → `blocks/of1/` not pushed or the table header cell isn't exactly `of1`.

### Check 5: Deliverable URLs return 200

`/nav` and `/footer` are the chrome fragments every page's header/footer blocks fetch (`loadFragment` → `${path}.plain.html`); a 404 makes every page chromeless.

```bash
LINKS=(
  "${PREVIEW_BASE}/nav.plain.html"
  "${PREVIEW_BASE}/footer.plain.html"
  "${PREVIEW_BASE}/of1"
  "${PREVIEW_BASE}/deliverables/index.html"
)
# Full e2e pipeline only (discovery ran) — skipped automatically otherwise.
[ -f "${OF1_STATE_DIR}/of1-discovery-output.md" ] && LINKS+=("${PREVIEW_BASE}/deliverables/discovery.html")

ALL_OK=true
for URL in "${LINKS[@]}"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
  if [ "$STATUS" = "200" ]; then echo "  ✓ $STATUS $URL"; else echo "  ✗ $STATUS $URL"; ALL_OK=false; fi
done
[ "$ALL_OK" = "true" ] || { echo "✗ FAIL (check 5): some deliverable URLs return non-200" >&2; exit 1; }
```

### Check 6: `/api/generate` returns ≥2 sections

```bash
RESPONSE=$(curl -s -X POST "${WORKER_URL}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"domain\":\"${TENANT_ID}\",\"query\":\"show me your best products\",\"followUp\":false,\"context\":{\"browsing\":[],\"conversationHistory\":[]}}")
SECTIONS=$(echo "$RESPONSE" | grep -c '"type"' || echo "0")
if [ "$SECTIONS" -ge 2 ]; then
  echo "✓ Generation returned ${SECTIONS} sections"
else
  echo "✗ FAIL (check 6): generation returned ${SECTIONS} sections (expected ≥2)" >&2
  echo "$RESPONSE" | head -20
  exit 1
fi
```

**If fails:** check `hasTemplates`/`hasContent` in `hub/status.json`.

### Check 7: CTA injection (pipeline mode only)

Skip in standalone mode. In pipeline mode `of1/config/cta-template.json` must be present (step 1) and `/api/personalize` must stream an `inject_cta` event:

```bash
if [ "${OF1_PIPELINE_MODE:-}" = "1" ]; then
  [ -f of1/config/cta-template.json ] || { echo "✗ FAIL (check 7): of1/config/cta-template.json missing" >&2; exit 1; }
  curl -s -X POST "${WORKER_URL}/api/personalize" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"${TENANT_ID}\",\"elements\":{\"T0\":{\"tag\":\"h1\",\"text\":\"Welcome\"}},\"behaviorProfile\":{\"interests\":[],\"intent\":\"research\"}}" \
    > "$OF1_STATE_DIR/check-personalize.ndjson"
  grep -q '"type":"inject_cta"' "$OF1_STATE_DIR/check-personalize.ndjson" \
    && echo "✓ /api/personalize streamed inject_cta" \
    || { echo "✗ FAIL (check 7): no inject_cta event — is hasCtaTemplate true in hub/status.json?" >&2; exit 1; }
fi
```

### Checklist summary

Mark `of1-publish` done only if ALL applicable checks pass (7 in pipeline mode, 6 in standalone):

| # | Check |
|---|-------|
| 1 | No `of1/config/*.json` in git other than `config.json` (and `cta-template.json` in pipeline mode) |
| 2 | Sync `ok: true`; `content.indexed > 0` |
| 3 | `/api/tenants/<id>/status` → `ready: true` |
| 4 | `/of1` renders header, footer and the `of1` block, with the authored title and ≥1 chip |
| 5 | `nav.plain.html`, `footer.plain.html`, `/of1`, `deliverables/index.html` return 200 |
| 6 | `/api/generate` returns ≥2 sections |
| 7 | Pipeline mode only: `cta-template.json` present and `/api/personalize` streams an `inject_cta` |

## Completion

Present final report:

```
## Demo Ready: ${DOMAIN}

**Demo Hub:** ${PREVIEW_BASE}/deliverables/index.html
**OF1 page:** ${PREVIEW_BASE}/of1
**Edit config in DA:** https://da.live/#/${OWNER}/${REPO}/of1
**Worker tenant:** ${TENANT_ID} (synced + ready)

Pre-launch checklist: N/N passed ✓
```

```bash
HUB_URL="${PREVIEW_BASE}/deliverables/index.html"
OF1_URL="${PREVIEW_BASE}/of1"
N_CHECKS=6; [ "${OF1_PIPELINE_MODE:-}" = "1" ] && N_CHECKS=7
cat > "$OF1_STATE_DIR/of1-publish-status.json" <<EOF
{
  "stage": 3,
  "skill": "of1-publish",
  "status": "done",
  "deliverables": [
    { "url": "${HUB_URL}", "label": "Demo hub" },
    { "url": "${OF1_URL}", "label": "OF1 page" }
  ],
  "summary": "Synced (${INDEXED} knowledge chunks) + all ${N_CHECKS} pre-launch checks passed."
}
EOF
```

On a failed check, write the same file with `"status": "failed"` and the failing check(s) in `summary`, then re-run steps 7–8 so the committed hub's "What worked" panel reflects it.
