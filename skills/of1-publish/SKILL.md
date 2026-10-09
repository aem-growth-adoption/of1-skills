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
| `OF1_DEMO_REPO` | absolute path to the local EDS site repo |
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
# Fail fast on an expired/invalid token (IMS tokens last ~3h) — before any write.
DA_PROBE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 20 \
  -H "Authorization: Bearer $DA_TOKEN" "https://admin.da.live/list/${OWNER}/${REPO}")
case "$DA_PROBE" in
  200) ;;
  401|403) echo "FAIL: DA token expired or invalid (IMS tokens last ~3h) — refresh ADOBE_IMS_TOKEN / OF1_TOKEN_FILE" >&2; exit 1 ;;
  *) echo "WARN: DA token probe on ${OWNER}/${REPO} returned HTTP ${DA_PROBE} — continuing" >&2 ;;
esac
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
# Bash array — never a space-joined string expanded unquoted (zsh doesn't word-split it).
ALLOWED=(of1/config/config.json)
[ "${OF1_PIPELINE_MODE:-}" = "1" ] && ALLOWED+=(of1/config/cta-template.json)
# The worker gates `ready` on these two flags only; every other /status flag is informational.
GATED_FLAGS='["hasTemplates","hasContent"]'
# playwright-cli writes a .playwright-cli/ folder into cwd — always run it from the
# state dir (in a subshell), never from the repo.
pw() { ( cd "$OF1_STATE_DIR" && playwright-cli "$@" ); }
pw_result() { awk '/^### Result/{f=1;next} /^### /{f=0} f'; }
```

### 1. Assert the git config set (check 1)

Only `of1/config/config.json` (and `of1/config/cta-template.json` in pipeline mode) may be tracked under `of1/config/`. Any other tracked file — especially `personas.json` / `suggestions.json` — would shadow the DA sheet at the same URL (a git file beats a DA sheet on EDS). Fail and list the extras; do not delete them here — `of1-check-dependencies` step 3b ("Remove legacy `of1/config/*.json`") removes them on every run, so this check is the backstop for when that was declined or skipped.

```bash
EXTRA=$(git ls-files of1/config | while IFS= read -r f; do
  ok=0; for a in "${ALLOWED[@]}"; do [ "$f" = "$a" ] && ok=1; done
  [ "$ok" = 1 ] || echo "$f"
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
# Paths in an EDS JSON index, one per line — read exactly the way the worker does:
# top-level `.data[].path`. A multi-sheet index (`:type: multi-sheet`, data under
# per-sheet keys) is NOT readable by the worker: warn and return non-zero so it's
# never chosen as indexPath.
index_paths() {
  local body
  body=$(curl -s --connect-timeout 10 --max-time 30 "${PREVIEW_BASE}$1" 2>/dev/null) || return 1
  if jq -e 'type == "object" and (.data | type) == "array"' >/dev/null 2>&1 <<<"$body"; then
    jq -r '.data[]?.path // empty' <<<"$body"
  elif jq -e 'type == "object" and (.[":type"] == "multi-sheet" or has(":names"))' >/dev/null 2>&1 <<<"$body"; then
    echo "⚠ $1 is a multi-sheet index — the worker only reads top-level .data; not usable" >&2
    return 2
  else
    return 1
  fi
}

CFG=of1/config/config.json
CFG_NEW=$(cat "$CFG")
# Template folder: honour a configured templates.daPath (default /templates).
# The worker uses the raw value, so a daPath without a leading "/" is NOT silently
# normalised here — warn and leave templates.names alone for this run.
TPL_DIR=$(jq -r '.templates.daPath // "/templates"' "$CFG")
TPL_SKIP=false
case "$TPL_DIR" in
  /*) TPL_DIR="${TPL_DIR%/}" ;;
  *) echo "⚠ templates.daPath \"$TPL_DIR\" has no leading '/' — the worker uses the raw value; fix config.json. Not setting/deleting templates.names this run." >&2
     TPL_SKIP=true ;;
esac
# Index candidates step 2b may write as contentIngestion.indexPath (its own fallbacks).
# Append any index the user names, e.g. INDEX_CANDIDATES+=("/en/query-index.json").
INDEX_CANDIDATES=(/sitemap.json)
CUR_INDEX_PATH=$(jq -r '.contentIngestion.indexPath // empty' "$CFG")
CUR_INDEX_IS_OURS=false
for idx in "${INDEX_CANDIDATES[@]}"; do [ "$CUR_INDEX_PATH" = "$idx" ] && CUR_INDEX_IS_OURS=true; done

QI_PATHS=$(index_paths /query-index.json)
QI_HAS_TEMPLATES=false; QI_HAS_KNOWLEDGE=false
grep -q "^${TPL_DIR}/" <<<"$QI_PATHS" && QI_HAS_TEMPLATES=true
grep -q '^/of1/knowledge/' <<<"$QI_PATHS" && QI_HAS_KNOWLEDGE=true
echo "query-index.json: templates($TPL_DIR)=$QI_HAS_TEMPLATES knowledge=$QI_HAS_KNOWLEDGE"

if [ "$TPL_SKIP" = "true" ]; then
  : # daPath malformed — warned above; templates.names left as-is.
elif [ "$QI_HAS_TEMPLATES" = "true" ]; then
  # Index covers templates — drop a stale override so the worker uses the index.
  CFG_NEW=$(jq 'del(.templates.names) | if .templates == {} then del(.templates) else . end' <<<"$CFG_NEW")
else
  # (a) templates: list the DA template folder (names of .html entries, no extension),
  # keeping only names the worker accepts (same regex it validates with).
  # A failed listing must never look like "no templates": check the HTTP status and
  # the body shape; only a genuine empty array means the folder is empty.
  TPL_RESP=$(curl -s -w '\n%{http_code}' --connect-timeout 10 --max-time 30 \
    -H "Authorization: Bearer $DA_TOKEN" "https://admin.da.live/list/${OWNER}/${REPO}${TPL_DIR}")
  TPL_CODE=$(printf '%s\n' "$TPL_RESP" | tail -n1)
  TPL_BODY=$(printf '%s\n' "$TPL_RESP" | sed '$d')
  case "$TPL_CODE" in
    200) ;;
    401|403) echo "✗ FAIL: DA token expired or lacks access to ${OWNER}/${REPO}${TPL_DIR} (HTTP ${TPL_CODE}) — refresh ADOBE_IMS_TOKEN / OF1_TOKEN_FILE and re-run" >&2; exit 1 ;;
    *) echo "✗ FAIL: listing DA ${TPL_DIR} returned HTTP ${TPL_CODE}: $(printf '%s' "$TPL_BODY" | head -c 200)" >&2; exit 1 ;;
  esac
  TPL_ALL=$(jq -c 'if type == "array" then [.[] | select(.ext == "html") | .name] | sort else error("not a list") end' <<<"$TPL_BODY" 2>/dev/null) \
    || { echo "✗ FAIL: DA ${TPL_DIR} listing (HTTP 200) is not a JSON array: $(printf '%s' "$TPL_BODY" | head -c 200)" >&2; exit 1; }
  TPL_NAMES=$(jq -c '[.[] | select(test("^[a-z0-9][a-z0-9-_]*$"; "i"))]' <<<"$TPL_ALL")
  TPL_BAD=$(jq -r '[.[] | select(test("^[a-z0-9][a-z0-9-_]*$"; "i") | not)] | join(", ")' <<<"$TPL_ALL")
  [ -n "$TPL_BAD" ] && echo "⚠ excluded template doc name(s) the worker rejects: $TPL_BAD (rename to [a-z0-9][a-z0-9-_]*)" >&2
  if [ "$TPL_NAMES" != "[]" ]; then
    CFG_NEW=$(jq --argjson n "$TPL_NAMES" '.templates = ((.templates // {}) + {names: $n})' <<<"$CFG_NEW")
    echo "→ templates.names = $TPL_NAMES"
  else
    echo "⚠ DA ${TPL_DIR} has no usable template docs — run of1-build-templates; check 3 (hasTemplates) will fail" >&2
  fi
fi

if [ -n "$CUR_INDEX_PATH" ] && [ "$CUR_INDEX_IS_OURS" != "true" ]; then
  # User-set indexPath (e.g. "/query-index.json?limit=2000") — never delete or overwrite it.
  echo "· contentIngestion.indexPath = $CUR_INDEX_PATH is user-set — left untouched"
elif [ "$QI_HAS_KNOWLEDGE" = "true" ]; then
  # Index covers knowledge — drop only a fallback this step wrote earlier.
  CFG_NEW=$(jq 'del(.contentIngestion.indexPath) | if .contentIngestion == {} then del(.contentIngestion) else . end' <<<"$CFG_NEW")
else
  # (b) knowledge: first candidate index whose top-level .data lists /of1/knowledge/ paths.
  KNOWLEDGE_INDEX=""
  for idx in "${INDEX_CANDIDATES[@]}"; do
    if index_paths "$idx" | grep -q '^/of1/knowledge/'; then KNOWLEDGE_INDEX="$idx"; break; fi
  done
  if [ -n "$KNOWLEDGE_INDEX" ]; then
    CFG_NEW=$(jq --arg p "$KNOWLEDGE_INDEX" '.contentIngestion = ((.contentIngestion // {}) + {indexPath: $p})' <<<"$CFG_NEW")
    echo "→ contentIngestion.indexPath = $KNOWLEDGE_INDEX"
  else
    echo "⚠ no single-sheet index lists /of1/knowledge/ (tried: ${INDEX_CANDIDATES[*]}) — check 2 (content.indexed > 0) will fail." >&2
    echo "  The site owner must add /of1/knowledge/** to an index (helix-query.yaml or the AEM config service)." >&2
  fi
fi

# Merge result (keeps domain + any other fields); commit ONLY config.json.
if [ "$(jq -S . <<<"$CFG_NEW")" != "$(jq -S . "$CFG")" ]; then
  jq . <<<"$CFG_NEW" > "$CFG"
  git add -- "$CFG"
  git commit -m "feat: OF1 index overrides for ${DOMAIN}" -- "$CFG"
  # Rebase onto the remote first so a concurrent push never rejects ours.
  git pull --rebase --autostash -q origin "$BRANCH" || { git rebase --abort 2>/dev/null; echo "✗ FAIL: git pull --rebase origin $BRANCH failed (conflict with the remote) — rebase aborted, nothing pushed. Resolve manually (git pull --rebase origin $BRANCH), then re-run. Never force-push." >&2; exit 1; }
  git push origin "$BRANCH"
  echo "✓ $CFG updated + pushed"
else
  echo "✓ config.json already matches index coverage — unchanged"
fi
```

If `/query-index.json` lists both `/templates/` (or the configured `templates.daPath`) and `/of1/knowledge/` paths, no override is set — and a stale `templates.names` or a skill-written `contentIngestion.indexPath` (one of `INDEX_CANDIDATES`) is removed. A user-set `indexPath` (any other value, e.g. `/query-index.json?limit=2000`) is never deleted or overwritten. A `templates.daPath` without a leading `/` is reported, not normalised, and `templates.names` is left alone that run. Sync `errors` entries that are only `{file, warning}` (e.g. >30 templates, sync truncated) are warnings, not failures. Note template docs only appear in an index once **published**; `of1-build-templates` only previews them, so on most sites step 2b sets `templates.names`. If the knowledge pages were published moments ago and the repo's `helix-query.yaml` does include them, the index may just be lagging — wait a minute and re-run this step before concluding the site needs overrides. If no index lists `/of1/knowledge/`, ask the user whether the site has another index (append it to `INDEX_CANDIDATES` and re-run); otherwise continue — check 2 will report the gap. Field shapes: `of1-integration/knowledge/worker-config-schemas.md` § `config.json`.

### 3. Push the git config

`of1-check-dependencies` already committed `config.json`; in pipeline mode `of1-build-cta-template` leaves `cta-template.json` uncommitted. Push it before syncing so the worker can read it:

```bash
# Only paths that exist (cta-template.json is absent in standalone mode).
PUSH=()
for f in "${ALLOWED[@]}"; do [ -f "$f" ] && PUSH+=("$f"); done
git add -- "${PUSH[@]}"
if ! git diff --cached --quiet -- "${PUSH[@]}"; then
  git commit -m "feat: OF1 config for ${DOMAIN}" -- "${PUSH[@]}"
  # Rebase onto the remote first so a concurrent push never rejects ours.
  git pull --rebase --autostash -q origin "$BRANCH" || { git rebase --abort 2>/dev/null; echo "✗ FAIL: git pull --rebase origin $BRANCH failed (conflict with the remote) — rebase aborted, nothing pushed. Resolve manually (git pull --rebase origin $BRANCH), then re-run. Never force-push." >&2; exit 1; }
  git push origin "$BRANCH"
fi
```

### 4. Sync → `hub/sync.json` (check 2)

```bash
curl -s -X POST "${WORKER_URL}/api/tenants/${TENANT_ID}/sync" > "$HUB/sync.json"
jq . "$HUB/sync.json"
OK=$(jq -r '.ok' "$HUB/sync.json")
INDEXED=$(jq -r '.content.indexed // 0' "$HUB/sync.json")
# `{file, warning}` entries are non-fatal warnings — not counted as errors.
N_ERR=$(jq '[.errors // [] | .[] | select((.warning != null and .error == null) | not)] | length' "$HUB/sync.json" 2>/dev/null)
echo "Sync: ok=$OK synced=$(jq -c '.synced' "$HUB/sync.json") errors=${N_ERR:-0} content.indexed=$INDEXED"
# `if`, not `[ … ] && …`: a bare && as the block's last command would leave a
# non-zero status when there are no errors.
if [ "${N_ERR:-0}" -gt 0 ]; then
  echo "✗ sync reported $N_ERR error(s) (a failure even though ok=$OK):" >&2
  jq -c '.errors[] | select((.warning != null and .error == null) | not)' "$HUB/sync.json" >&2
fi
jq -r '.errors // [] | .[] | select(.warning != null and .error == null) | "⚠ \(.file // "sync"): \(.warning)"' "$HUB/sync.json" 2>/dev/null
```

Pass: `ok: true` **and** `errors` empty **and** `content.indexed > 0`. The worker returns `ok: true` even when individual files failed — a non-empty `errors` array is a failure. Entries come as `{file, error}`, `{file, status}`, `{content, status}` or `{content, error}` — e.g. `brand-voice: empty document` means `/of1/brand-voice` wasn't previewed. If `content.indexed` is 0 while `$OF1_STATE_DIR/knowledge-pages.json` is non-empty, the knowledge pages aren't in the index the worker reads (`/query-index.json`, or `contentIngestion.indexPath` set in step 2b): check the site's `helix-query.yaml` (or, for config-service sites, the AEM config-service index) covers `/of1/knowledge/**` (an existing file is never edited by the skills — `of1-check-dependencies` warns when it doesn't), that `.hlxignore` doesn't exclude them, and that the pages are **published** (live), not just previewed. Don't stop on failure yet — finish steps 5–8 so the hub shows what failed, then fail in the checklist.

### 5. Tenant status → `hub/status.json` (check 3)

```bash
curl -s "${WORKER_URL}/api/tenants/${TENANT_ID}/status" > "$HUB/status.json"
jq . "$HUB/status.json"
echo "ready=$(jq -r .ready "$HUB/status.json")"
# Gated flags → failures; everything else → info only.
jq -r --argjson g "$GATED_FLAGS" '.config // {} | to_entries[]
  | if (.key | IN($g[])) then
      (if (.value == false or .value == 0) then "  ✗ \(.key) (gates ready)" else "  ✓ \(.key)" end)
    else "  · \(.key)=\(.value) (info)" end' "$HUB/status.json"
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

Reads `$OF1_STATE_DIR/repo-config.json`, `of1-discovery-output.md` (optional — absent in standalone runs; the hub falls back to defaults and only warns when prototypes exist), `pipeline-audit.json`, every `$OF1_STATE_DIR/of1-*-status.json`, and the `hub/` files staged above; links prototypes (`deliverables/prototype-*.html`, committed by Stage 2b — a content-only demo has none) and `deliverables/discovery.html` when present. Writes `deliverables/index.html` with DA edit links for each authored item (brand voice, personas, suggestions, `/of1`, `/templates`, `/of1/knowledge`) and a **"What worked"** panel (per-skill status, sync `synced`/`errors`/`content.indexed`, `ready` + failing `/status` flags). Do NOT hand-write the hub HTML.

### 8. Commit and push the hub

```bash
git add -- deliverables/index.html
# Same guard as step 3: an identical hub (same-day re-run) leaves nothing staged,
# and an unguarded `git commit` would exit 1.
if ! git diff --cached --quiet -- deliverables/index.html; then
  git commit -m "feat: OF1 demo hub for ${DOMAIN}" -- deliverables/index.html
  # Rebase onto the remote first so a concurrent push never rejects ours.
  git pull --rebase --autostash -q origin "$BRANCH" || { git rebase --abort 2>/dev/null; echo "✗ FAIL: git pull --rebase origin $BRANCH failed (conflict with the remote) — rebase aborted, nothing pushed. Resolve manually (git pull --rebase origin $BRANCH), then re-run. Never force-push." >&2; exit 1; }
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
[ "$(jq '[.errors // [] | .[] | select((.warning != null and .error == null) | not)] | length' "$HUB/sync.json" 2>/dev/null || echo 1)" -eq 0 ] || { echo "✗ FAIL (check 2): sync errors (ok=true is not enough):" >&2; jq -c '.errors[]' "$HUB/sync.json" >&2; exit 1; }
[ "$(jq -r '.content.indexed // 0' "$HUB/sync.json")" -gt 0 ] || { echo "✗ FAIL (check 2): content.indexed = 0 — /of1/knowledge/** not in the worker's index (query-index.json or contentIngestion.indexPath — see step 2b; pages must be published live)" >&2; exit 1; }
echo "✓ sync ok, $(jq -r .content.indexed "$HUB/sync.json") chunk(s) indexed"
```

### Check 3: Tenant ready

```bash
[ "$(jq -r .ready "$HUB/status.json")" = "true" ] || {
  echo "✗ FAIL (check 3): tenant not ready; failing gated flags:" >&2
  jq -r --argjson g "$GATED_FLAGS" '.config // {} | to_entries[]
    | select((.key | IN($g[])) and (.value == false or .value == 0)) | "  \(.key)"' "$HUB/status.json" >&2
  exit 1
}
echo "✓ tenant ready"
# Not gated — informational only (never fail on these):
jq -r --argjson g "$GATED_FLAGS" '.config // {} | to_entries[] | select(.key | IN($g[]) | not) | "  · \(.key)=\(.value)"' "$HUB/status.json"
```

### Check 4: `/of1` renders header, footer and the `of1` block with the authored title and ≥1 chip

```bash
# `pw` (Process preamble) runs playwright-cli from $OF1_STATE_DIR so its
# .playwright-cli/ folder never lands in the repo; `pw_result` keeps only the
# `### Result` section of eval's Markdown output.
pw open "${PREVIEW_BASE}/of1"
sleep 6
pw screenshot --full-page --filename "$OF1_STATE_DIR/check-of1.png"
pw eval "() => (document.querySelector('header .header a') ? 'header OK' : 'HEADER MISSING')" | pw_result
pw eval "() => (document.querySelector('footer .footer') && document.querySelector('footer .footer').textContent.trim() ? 'footer OK' : 'FOOTER MISSING')" | pw_result
pw eval "() => (document.querySelector('main .of1') ? 'of1 block OK' : 'OF1 BLOCK MISSING')" | pw_result
pw eval "() => (document.querySelector('.of1 .of1-title')?.textContent.trim() || 'TITLE MISSING')" | pw_result
pw eval "() => ('chips: ' + document.querySelectorAll('.of1 .of1-chip').length)" | pw_result
pw close >/dev/null 2>&1 || true
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

### Check 6: `/api/generate` returns ≥2 sections, no errors

```bash
RESPONSE=$(curl -s -X POST "${WORKER_URL}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"domain\":\"${TENANT_ID}\",\"query\":\"show me your best products\",\"followUp\":false,\"context\":{\"browsing\":[],\"conversationHistory\":[]}}")
# The response is NDJSON (one event per line). Count real section events; any
# {"type":"error"} line is a failure even if sections were also emitted.
# (`grep -c … || echo 0` printed "0" twice on no match — never use it.)
SECTIONS=$(printf '%s\n' "$RESPONSE" | jq -R 'fromjson? | select(.type == "section")' | jq -s 'length')
GEN_ERRORS=$(printf '%s\n' "$RESPONSE" | jq -R -c 'fromjson? | select(.type == "error")')
if [ -n "$GEN_ERRORS" ]; then
  echo "✗ FAIL (check 6): generation streamed error event(s):" >&2
  printf '%s\n' "$GEN_ERRORS" >&2
  exit 1
elif [ "$SECTIONS" -ge 2 ]; then
  echo "✓ Generation returned ${SECTIONS} sections"
else
  echo "✗ FAIL (check 6): generation returned ${SECTIONS} sections (expected ≥2)" >&2
  printf '%s\n' "$RESPONSE" | head -20
  exit 1
fi
```

**If fails:** check `hasTemplates`/`hasContent` in `hub/status.json`; an error event like `template not selected` means no synced template matched (re-run sync after `of1-build-templates` assemble; for config-service sites see step 2b `templates.names`).

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
| 2 | Sync `ok: true`, `errors` empty; `content.indexed > 0` |
| 3 | `/api/tenants/<id>/status` → `ready: true` (only `hasTemplates`/`hasContent` gate it; other flags are info) |
| 4 | `/of1` renders header, footer and the `of1` block, with the authored title and ≥1 chip |
| 5 | `nav.plain.html`, `footer.plain.html`, `/of1`, `deliverables/index.html` return 200 |
| 6 | `/api/generate` streams ≥2 `type:"section"` events and no `type:"error"` |
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
