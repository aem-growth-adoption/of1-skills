---
name: of1-build-templates
description: Author DA block templates for the OF1 worker's da-blocks-slots engine — real EDS documents in a tenant's /templates DA folder, composed from the site's own EDS blocks (reused first, new general-purpose blocks only where useful) filled with realistic example content. The worker syncs them, selects one per request, and asks the LLM for content-only slot values it splices into the authored skeleton.
user-invocable: true
---

# OF1 Template Authoring (da-blocks-slots)

Produce the OF1 worker's template library as **DA-authored block templates**: real EDS documents in
a tenant's `/templates` DA folder, each composed of the site's **own** EDS blocks (`hero`, `cards`,
`columns`, `spotlight`, …) filled with realistic example content, carrying a `section-metadata` block
that describes the template's intent. DA is the source of truth — no git-committed template HTML, no
`.metadata.json`, no `templates-catalog.json`, no gallery.

At request time the worker (`da-blocks-slots` engine) selects one template by intent, asks the LLM for
**content-only slot values** addressed by structural id, and splices them into the authored skeleton —
the browser then runs the site's real `decorate()` pipeline, so generated pages look and behave exactly
like authored ones. See `of1-gen-web-service/docs/superpowers/specs/2026-08-10-da-block-templates-design.md`
and this repo's `docs/superpowers/specs/2026-08-31-of1-build-templates-da-blocks-slots-migration.md`.

## Env — orchestrator exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives status JSON |
| `OF1_DEMO_REPO` | absolute path to the local tenant EDS repo clone (also `TENANT_REPO_DIR` for `inventory.sh`) |
| `SKILL_DIR` | absolute path to this skill (finds `assets/da-api.sh`, `assets/inventory.sh`) |
| `ADOBE_IMS_TOKEN` / `OF1_TOKEN_FILE` | source of `DA_TOKEN` (see resolution below) |

Resolve tokens and repo config once at the top:

```bash
# DA_TOKEN resolution (same order every OF1 skill uses):
# ADOBE_IMS_TOKEN -> OF1_TOKEN_FILE -> $PWD/.hlx/.da-token.json -> $OF1_DEMO_REPO/.hlx/.da-token.json
DA_TOKEN="${ADOBE_IMS_TOKEN:-}"
for f in "$OF1_TOKEN_FILE" "$PWD/.hlx/.da-token.json" "$OF1_DEMO_REPO/.hlx/.da-token.json"; do
  [ -n "$DA_TOKEN" ] && [ "$DA_TOKEN" != "null" ] && break
  [ -n "$f" ] && [ -f "$f" ] && DA_TOKEN=$(jq -r .access_token "$f")
done
[ -n "$DA_TOKEN" ] && [ "$DA_TOKEN" != "null" ] \
  || { echo "FAIL: no DA token (set ADOBE_IMS_TOKEN or OF1_TOKEN_FILE)" >&2; exit 1; }

# AEM preview uses the SAME IMS token — the design doc's 403 was an org-permission
# gap, not a token-scope gap. of1-check-dependencies probes the org's preview
# authorization up front; here we just pass the token through.
AEM_TOKEN="${AEM_TOKEN:-$DA_TOKEN}"

REPO_CONFIG=$(cat "$OF1_STATE_DIR/repo-config.json")
OWNER=$(jq -r .owner   <<<"$REPO_CONFIG")   # DA org, e.g. of1-labs
REPO=$(jq -r .repo     <<<"$REPO_CONFIG")   # DA repo,  e.g. of1-af1bb1a3
BRANCH=$(jq -r .branch <<<"$REPO_CONFIG")
DOMAIN=$(jq -r .domain <<<"$REPO_CONFIG")
export ORG="$OWNER" REPO DA_TOKEN AEM_TOKEN   # da-api.sh reads ORG/REPO/DA_TOKEN/AEM_TOKEN
cd "$OF1_DEMO_REPO"
```

## Block Strategy — the core methodology (read before authoring anything)

Reason in this order. **Reuse first; invent general blocks only when genuinely useful; never author a
slot-specific, single-template block.**

1. **Use cases first.** From `$OF1_STATE_DIR/of1-discovery-output.md` (discovery narrative) +
   `of1/config/knowledge.json` (personas, products, features, FAQs, when present) determine what the
   generative-search experience must actually answer.
2. **Derive intents** — `comparison`, `recommendation`, `deep-dive`, `budget`, `discovery`. Each maps
   to one or more template shapes.
3. **Choose the block palette per template, in priority order:**
   - **Reuse an existing block** from the tenant's `blocks/*` (Stage-2 output) — first choice whenever
     an existing block, optionally with a single-hyphen **variant** or a `no-static-labels` /
     `key-value` knob, can express the shape.
   - **Author a new *general-purpose* block** only when reuse genuinely can't express the shape AND the
     block is a broadly reusable pattern — e.g. `product-cards`, `comparison-grid`, `feature-list`,
     `stat-row`. Positional, with real `blocks/<name>/<name>.{js,css}`, usable across templates/intents
     and other sites.
4. **Compose the DA template** from the chosen blocks with realistic example content.

### CRITICAL RULES

1. **General, never slot-specific.** `product-cards` is fine; `comparison-hero-with-three-fixed-tiers`
   is not. The whole point of this engine is to kill the old bespoke-per-template markup. When in doubt,
   reuse an existing block with a variant rather than invent one.
2. **Never modify or restyle a reused (Stage-2) block.** Its `blocks/<name>/<name>.css` already exists
   and is owned upstream. New blocks you author get disjoint names.
3. **Never touch `blocks/of1/of1.{js,css}`.** That is `of1-style-generative-block`'s (the OF1 shell UI).
   You own section blocks only.
4. **New blocks must be positional** (read `block.children` by index, like `cards.js`). Never author the
   snowflake label/value convention (`cells[0]`=name, `cells[1]`=value) — it decorates into the wrong
   shape here.

## The da-blocks-slots authored-template contract

An authored template is a normal EDS document. What the worker requires
(`materialize-da-templates.js`, `block-tree.js`, `slot-address.js`, `slot-splice.js`):

- **Body shape:** `<body><header></header><main><div>…sections…</div></main><footer></footer></body>`,
  matching the tenant repo's own `content/*.html`.
- **Composition:** positional rows of the tenant's own blocks, filled with realistic example content.
- **No `data-slot` attributes, no slot schema.** Slots are addressed structurally
  (`s{S}-b{B}-r{R}-c{C}`), derived by the worker at sync time. You only author example content; the
  cell's **role is auto-detected** from it:
  - `<picture>`/`<img>` → `image` · whole-cell `<a>…</a>` → `link` · a cell with **>1** block-level
    element (e.g. an `<h2>` + `<p>` intro) → `html` · empty/icon-only → `static` (never filled) ·
    otherwise → `text`.
  - So: put an `<img>` where you want a fillable image, a whole-cell `<a>` for a fillable link, and keep
    multi-element intros in one cell if you want them preserved as markup.
- **Label/value rows** (spec/price tables) are auto-detected: 2–3 cells, cell 0 short plain text
  (≤4 words, no image/link), pattern repeating across ≥2 rows. Cell 0 stays **static** (kept verbatim,
  never sent to the LLM). Two variant knobs:
  - add `no-static-labels` to a block's classes to force **every** cell dynamic;
  - add `key-value` to lower the label-detection threshold to a single row.
- **Section metadata** carries routing/selection data — author a `section-metadata` block in the
  relevant section with keys **`Template Intent`**, **`Template Description`**, **`Template Min Items`**,
  **`Template Max Items`**. **No commas in any value** (the markdown intermediate drops the following
  space). `minItems`/`maxItems` gate template selection against available product count.
- **Class-name caveats:** single-hyphen variant names only (`variant-double`, never `variant--double`
  — double hyphens don't survive the markdown intermediate). Positional rows only.
- **Naming:** EDS strips a leading underscore from a path (`templates/_foo` → `/templates/foo`). Use a
  `templates/_drafts/` subfolder for scratch, not an underscore prefix.

`assets/da-api.sh` provides `da_put` / `da_delete` / `da_list` / `aem_preview`. `assets/inventory.sh`
enumerates usable positional blocks in `$TENANT_REPO_DIR/blocks/*`.

## Phases

Selected by `OF1_TG_MODE`. The orchestrator runs them in order: `base` → `intent × 5` (parallel) →
`assemble`. Same three-phase interface as before, so orchestrator/SLICC dispatch is unchanged.

| Mode | What it does | Dispatched by |
|---|---|---|
| `base` | Use-cases → intents → **block plan**; run `inventory.sh` + harvest live `.plain.html`; author any planned **new general blocks** (`blocks/<name>/*`), commit + push, and wait for code sync so their decorators are live before any template uses them. | Orchestrator FIRST (1 agent) |
| `intent` | Compose the DA template documents for ONE intent (`$OF1_TG_INTENT`) from the block plan, `da_put` each to `/templates/<name>`. Does NOT preview, does NOT commit. | Orchestrator fan-out (5 agents) after `base` |
| `assemble` | Run ONCE after all intents. `aem_preview` every composed doc (MANDATORY), verify the round-trip, write `of1/config/templates.json` (`engine: da-blocks-slots`), single commit + push. | Orchestrator after all intents return |
| `all` (default) | Fallback — `base` → 5 intents serially → `assemble` inline in one agent. | Single agent when no fan-out |

**Race-safety:** intent agents write disjoint DA paths (`/templates/<intent>-*`). New-block code and
`templates.json` are owned by `base` and `assemble` respectively, never by intent agents.

### Phase: `base`

1. **Determine use cases → intents → block plan.** Read discovery + knowledge; decide, per intent, the
   template shapes and the block palette (reuse vs new) per Block Strategy.
2. **Inventory the reusable blocks:**
   ```bash
   export TENANT_REPO_DIR="$OF1_DEMO_REPO"
   USABLE_BLOCKS=$("$SKILL_DIR/assets/inventory.sh" "$TENANT_REPO_DIR")
   echo "$USABLE_BLOCKS"
   ```
   For each, read `blocks/<name>/<name>.js` to confirm it is **positional** (reads `block.children` by
   index). Exclude any block using the label/value convention.
3. **Harvest known-good compositions.** For each usable block, fetch the tenant's live pages'
   `.plain.html` (`https://{BRANCH}--{REPO}--{OWNER}.aem.page/{path}.plain.html`) and extract that
   block's real row/cell shape + example content — a composition *known to render* is stronger evidence
   than the `.js` alone. Record a per-block fingerprint (row count, per-row cell count).
4. **Adapt the template count to the vocabulary.** A rich site (e.g. 16 blocks) supports ~5 intents ×
   ~3 variations; a 3-block site gets fewer, or leans on variants + the `no-static-labels`/`key-value`
   knobs. Do **not** blindly target 15 — target what the block vocabulary can express well.
5. **Author any planned NEW general blocks** (only if the plan calls for them):
   - Write positional `blocks/<name>/<name>.js` + `blocks/<name>/<name>.css`. General, reusable, brand
     tokens from `styles/styles.css` + `DESIGN.json` (resolve via
     `of1-integration/knowledge/design-tokens-resolution.md`).
   - Commit + push so the code bus picks them up **before** any template previews them:
     ```bash
     git add blocks/<name>/
     git commit -m "feat: add general-purpose <name> block for OF1 templates"
     git push origin "$BRANCH"
     # Wait for code sync — poll the block JS on the code bus until 200:
     for i in $(seq 1 30); do
       curl -sf -o /dev/null "https://${BRANCH}--${REPO}--${OWNER}.aem.page/blocks/<name>/<name>.js" && break
       sleep 5
     done
     ```
   - Skip this whole step when every intent is covered by reuse.
6. **Persist the block plan** for the intent agents to read (so each composes consistently):
   ```bash
   # Write the plan (usable blocks, fingerprints, per-intent template list) where intent agents read it.
   printf '%s' "$BLOCK_PLAN_JSON" > "$OF1_STATE_DIR/of1-build-templates-plan.json"
   ```
7. **Status file** (SLICC IPC; CC ignores):
   ```bash
   echo '{"stage":3,"skill":"of1-build-templates","phase":"base","status":"done","summary":"Block plan ready; N new general block(s) authored + deployed."}' \
     > "$OF1_STATE_DIR/of1-build-templates-base-status.json"
   ```

### Phase: `intent`

Precondition: `$OF1_TG_INTENT` ∈ {`comparison`, `recommendation`, `deep-dive`, `budget`, `discovery`}
and `base` has finished (`of1-build-templates-plan.json` exists, new blocks deployed).

```bash
INTENT="${OF1_TG_INTENT:?OF1_TG_INTENT required in intent mode}"
case "$INTENT" in comparison|recommendation|deep-dive|budget|discovery) ;;
  *) echo "OF1_TG_INTENT must be one of: comparison recommendation deep-dive budget discovery" >&2; exit 2;; esac
PLAN=$(cat "$OF1_STATE_DIR/of1-build-templates-plan.json")
```

For each template variation this intent's plan calls for:

1. **Compose the document** from the planned blocks (reused + any new ones, all now deployed), filled
   with realistic example content per the contract above. Author image-role cells (`<img>`/`<picture>`)
   where the worker+LLM should swap a real image; author label/value rows for spec/price tables; use
   single-hyphen variants.
2. **Add the `section-metadata` block** with `Template Intent = <intent>`, a short structurally-distinct
   `Template Description`, and `Template Min Items` / `Template Max Items`. No commas in values.
3. **Wrap** the body `<body><header></header><main><div>…</div></main><footer></footer></body>` and
   `da_put` to DA:
   ```bash
   source "$SKILL_DIR/assets/da-api.sh"
   da_put "./<intent>-<variation>.html" "templates/<intent>-<variation>.html"
   ```
   `da_put` returns the `editUrl` (`da.live/edit#/…`) — capture it; `of1-publish` surfaces it in the
   demo hub as the authoring showcase.
4. Do **not** preview or commit here (assemble owns both).

Status file (one per intent):
```bash
echo "{\"stage\":3,\"skill\":\"of1-build-templates\",\"phase\":\"intent-${INTENT}\",\"status\":\"done\",\"summary\":\"Composed ${INTENT} template docs to DA.\"}" \
  > "$OF1_STATE_DIR/of1-build-templates-intent-${INTENT}-status.json"
```

### Phase: `assemble`

Run once after all 5 intent agents complete.

1. **Preview every composed document (MANDATORY).** A DA doc that was never previewed has no
   `.plain.html`, so the worker syncs nothing.
   ```bash
   source "$SKILL_DIR/assets/da-api.sh"
   for path in $(da_list templates | jq -r '.[].path' 2>/dev/null); do
     aem_preview "${path#/}" || { echo "ABORT: preview failed for $path — org lacks AEM preview rights (see of1-check-dependencies)" >&2; exit 1; }
   done
   ```
   `aem_preview` exits non-zero on 403. **Stop and report the org-authorization gap** — do NOT report
   templates as ready with unpublished docs.
2. **Verify the round-trip** for each template: fetch
   `https://{BRANCH}--{REPO}--{OWNER}.aem.page/templates/{name}.plain.html` and confirm 200 + that each
   block's row count and per-row cell count match what was authored (the harvested fingerprint). A 404
   means preview didn't materialize; a shape mismatch means markdown-intermediate mangling — fix before
   proceeding.
3. **Write the tenant config** (git-committed — this is the only committed template artifact besides new
   block code):
   ```bash
   mkdir -p of1/config
   cat > of1/config/templates.json <<'JSON'
   { "engine": "da-blocks-slots", "daPath": "/templates" }
   JSON
   git add of1/config/templates.json
   git commit -m "feat: route ${DOMAIN} to da-blocks-slots engine (/templates in DA)"
   git push origin "$BRANCH"
   ```
4. **Final status file** (the deliverable status the orchestrator reports):
   ```bash
   EDIT_BASE="https://da.live/edit#/${OWNER}/${REPO}/templates"
   cat > "$OF1_STATE_DIR/of1-build-templates-status.json" <<EOF
   { "stage": 3, "skill": "of1-build-templates", "status": "review",
     "deliverables": [ { "url": "${EDIT_BASE}", "label": "Edit templates in DA" } ],
     "summary": "Authored, previewed, and verified DA block templates; routed tenant to da-blocks-slots." }
   EOF
   ```

### Phase: `all` (fallback)

If `OF1_TG_MODE` is unset, run `base` → 5 intents serially → `assemble` inline. Same artifacts, ~3×
slower wall-clock.

## Deliverables

- DA documents at `/templates/<intent>-<variation>` (source of truth; not git-committed).
- `of1/config/templates.json` — `{ "engine": "da-blocks-slots", "daPath": "/templates" }` (committed).
- Any **new general-purpose** `blocks/<name>/{<name>.js,<name>.css}` (committed) — reused blocks are
  never modified.
- Editable in DA at `da.live/edit#/{org}/{repo}/templates/*` (the authoring showcase `of1-publish`
  surfaces).

## Notes

- **Preview is not optional.** The single most common failure is a DA write with no preview → worker
  syncs zero templates → empty generative page.
- **Reuse over invention, generality over convenience.** A new block must earn its place by being a
  general pattern reused across templates — not a one-off.
- **This skill does not author `blocks/of1/of1.css`, generative-images.json, or
  generative-fragments.json** — those belong to other skills (the last two are a separate future PR).
