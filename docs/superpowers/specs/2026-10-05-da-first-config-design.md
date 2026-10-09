# DA-first OF1 config — stop committing generated JSON to customer repos

Date: 2026-10-05
Status: Implemented (PRs #11, #12)
Repos: `of1-skills` (primary), `of1-gen-web-service`, `of1-preview-extension`, `of1-labs`, `of1-demo-skills`
Unchanged: `of1-edge-proxy`, `of1-portal`

## Problem

Running `of1-integration` against an existing customer EDS site (seen in Zorna's
masterclass demo) commits nine generated JSON files to `of1/config/`, plus demo
artefacts. Three things go wrong:

1. **The customer's git repo fills up** with OF1 config that isn't code.
2. **Authors can't edit config.** Brand voice, chips and personas sit in git JSON
   that only developers touch.
3. **The AI does pointless work.** Several files are boilerplate (`of1-endpoint`,
   `templates`), intermediate (`knowledge-pages`), or have fields nothing reads
   (`brand-voice.sentenceStyle`/`toneByContext`, `suggestions.type`/`title`/`subtitle`/`placeholder`,
   `cta-template.slots`).

Separately, `of1-check-dependencies` "clean slate" `rm -rf`s `content/ drafts/ tools/ …`
and deletes **every top-level DA document**. That is destructive on a real customer site.

## Goals / success criteria

- A standalone `of1-integration` run commits only:
  `blocks/of1/`, any new general-purpose `blocks/<name>/`, `helix-query.yaml` (only if
  absent), `.hlxignore` (only if it blocked `of1/config`), `of1/config/config.json`,
  `stardust/` + `PRODUCT.md` (only when extraction ran), `deliverables/index.html`
  (+ `deliverables/brand-review.html` when extraction ran).
  In pipeline mode (`OF1_PIPELINE_MODE=1`), also `of1/config/cta-template.json`.
- Author-tunable config lives in DA: brand voice, chips, landing copy, personas,
  templates, knowledge pages.
- No skill deletes anything outside OF1-owned paths.
- One model for both the standalone integration and the full demo pipeline.

## Non-goals

- `audiences`, `generative-images`, `generative-fragments`, `signals`, `llmquestions`
  config. The skills don't produce these; they're untouched.
- Migrating existing tenants. **Hard cut**: see Rollout.

## Per-file decisions

| File | What it did | Decision | New home |
|---|---|---|---|
| `config.json` | `domain` → edge-proxy 404 domain fallback; `knowledgeMode` → skips persona/use-case match; `contentIngestion` → page indexing, content mode, top-K; `owner/repo/branch` → unread | **Keep**, trimmed to `domain`, optional `contentIngestion` override, optional `of1Endpoint` and `templates` overrides | git |
| `of1-endpoint.json` | CTA href base; `/status.of1Endpoint` (read by the preview extension); ready gate; `strategyEnabled` opt-in | **Eliminate.** Worker derives `config.of1Endpoint ?? https://<id>.aem.page/of1`. Strategy turns on when DA doc `/of1/strategy` exists | — |
| `templates.json` | Selects sync materialization + request flow; always `{engine: da-blocks-slots, daPath: /templates}` | **Eliminate.** `da-blocks-slots` + `/templates` is the only engine and the default. `config.templates.daPath` may override the folder | — |
| `personas.json` | **Preview extension / edge-proxy injected build** "apply persona" demo feature (seeds a behaviour profile); labs experiments proxy; worker persona-match (already disabled) | **Move** | DA sheet `/of1/config/personas` (served at the same `.json` URL) |
| `brand-voice.json` | `## Brand Voice` section in every generation prompt (`personality`, `tone`, `vocabulary`, `avoidWords`; string form also supported) | **Move**, as prose | DA document `/of1/brand-voice` |
| `suggestions.json` | Chips on `/of1` landing (`/api/suggest`) + follow-up picks; ready gate. `title/subtitle/placeholder` are **never delivered** (`/api/suggest` returns only `suggestions`) — bug | **Split** | chips → DA sheet `/of1/config/suggestions` (`label`, `query`); landing copy → rows on the `/of1` page's `of1` block |
| `cta-template.json` | Inline-styled CTA banner injected into customer pages by the extension / edge proxy via `/api/personalize` | **Keep**, produced in pipeline mode only, removed from ready gate | git |
| `knowledge.json` | Structured knowledge vectors; product source for personalize; image fallback; ready gate | **Eliminate** | `/of1/knowledge/**` page chunks (already produced) |
| `knowledge-pages.json` | Intermediate scrape → DA publish | **Move out of repo** | `$OF1_STATE_DIR/knowledge-pages.json` |

### DA shapes

**`/of1/config/personas` (sheet)**, one row per persona:

| id | name | description | keywords | priorities | explore | research | compare | purchase | deals | support |
|---|---|---|---|---|---|---|---|---|---|---|

`keywords`/`priorities` are comma-separated. The six intent columns are numbers in 0–1.
`recommendedProducts` is dropped (there are no product ids any more).

**`/of1/config/suggestions` (sheet)**: columns `label`, `query`, one row per chip (8–12).

**`/of1/brand-voice` (document)**: plain prose with suggested headings
*Personality*, *Tone*, *Words we use*, *Words we avoid*. Authors may paste brand
guidelines freely. Sync strips it to text (`stripHtml`) and stores it as the string brand voice.

**`/of1` page `of1` block**: existing rows `api-endpoint`, `domain`, `engine`, plus new
optional rows `title`, `subtitle`, `placeholder`.

EDS precedence caveat: a git-committed file beats a DA sheet at the same path. Skills
must never commit `of1/config/{personas,suggestions}.json`. `of1-publish` asserts they're
absent from git.

## Destructive clean-up → OF1-owned paths only (`of1-check-dependencies`)

- **Default (fresh run):** no clean-up. Every step overwrites only OF1-owned paths, so
  re-runs are idempotent.
- **"Restart":** delete only OF1-owned paths. In DA: `/of1/**`, `/templates/**`. In git:
  `blocks/of1/`, `of1/config/`. Never `/nav`, `/footer`, the home page, `content/`, or
  new general blocks.
- **`helix-query.yaml`:** created only if absent. If present and missing
  `/of1/knowledge`, warn; never edit it.
- **`.hlxignore`:** edited only when it actually excludes `of1/config/` (needed so
  `config.json` is served).
- **`ensure-nav-footer.mjs`:** unchanged (creates `/nav`/`/footer` only if missing,
  never overwrites).
- **Full wipe for throwaway demo repos:** moves to an `of1-demo-skills` orchestrator step.

## `of1-skills` changes

| Skill | Change |
|---|---|
| `of1-check-dependencies` | Clean-up as above. Stops writing `of1-endpoint.json`. Writes trimmed `config.json` |
| `of1-extract-design` | Unchanged: commits `stardust/`, `PRODUCT.md`, `deliverables/brand-review.html` |
| `of1-extract-brand-voice` | Writes + previews DA doc `/of1/brand-voice`. Drops `sentenceStyle`/`toneByContext` |
| `of1-extract-content` | Stops `knowledge.json`, the per-product image pipeline (step 9) and the ≥4-images gate. Page capture goes to `$OF1_STATE_DIR/knowledge-pages.json`. Keeps step 10 (image rehost + `/of1/knowledge/**` publish). Writes + previews the personas DA sheet |
| `of1-build-quick-suggestions` | Inputs: knowledge pages (state) + personas + brand voice. Writes + previews the suggestions DA sheet. Writes `title`/`subtitle`/`placeholder` to `$OF1_STATE_DIR/of1-landing.json` |
| `of1-style-generative-block` | `/of1` block gets `title`/`subtitle`/`placeholder` rows from `of1-landing.json`. Writes `engine: da-blocks-slots` as a literal (no longer reads `templates.json`) |
| `of1-build-templates` | Assemble stops writing `templates.json`. Use cases come from knowledge pages, not `knowledge.json` |
| `of1-build-cta-template` | Unchanged output (git `cta-template.json`). In `of1-integration`'s graph it becomes a **pipeline-mode-only node**, so `of1-demo-orchestrator` (which dispatches from that graph) keeps calling it |
| `of1-integration` | New step graph: no `config-review`; CTA pipeline-only. `assets/config-review.html` deleted. `knowledge/worker-config-schemas.md` rewritten for the new shapes |
| `of1-publish` | Commits `of1/config/config.json` (+ `cta-template.json` in pipeline mode) and `deliverables/index.html`. Checks listed below |
| `fill-demo-hub.mjs` (kept, both flows) | Inputs: DA sheet `.json` URLs, DA listings (`/templates`, `/of1/knowledge`), `$OF1_STATE_DIR` status files, saved sync + status responses. Adds DA edit links for each authored item and a **"what worked" panel** (per-skill status, sync `synced`/`errors`/`content.indexed`, `ready` + failing checks) |
| new `of1-integration/assets/da-write.mjs` (shared) | Writes a DA document or sheet and triggers preview. Used for brand voice, personas, suggestions |
| deleted | `publish-config-da.mjs`, `assets/config-review.html` |
| docs | README skills table, removed "15 templates / gallery / catalog" remnants |

### `of1-publish` checks (replace the current 6)

1. No `of1/config/*.json` in git other than `config.json` (and `cta-template.json` in pipeline mode).
2. Sync `ok: true`; `content.indexed > 0`.
3. `/api/tenants/<id>/status` → `ready: true`.
4. `/of1` renders header, footer and the `of1` block, with the authored title and ≥1 chip.
5. `nav.plain.html`, `footer.plain.html`, `/of1`, `deliverables/index.html` return 200.
6. `/api/generate` returns ≥2 sections.
7. Pipeline mode only: `cta-template.json` present and `/api/personalize` streams an `inject_cta`.

## `of1-gen-web-service` changes

Prerequisite: PR #44 (`vectorId` ≤ 64 bytes for long tenant ids).

### Sync sources

| Source | Behaviour |
|---|---|
| `of1/config/config.json` (git) | read |
| `of1/config/cta-template.json` (git) | read, optional |
| `/of1/brand-voice.plain.html` | stripped to text → `tenant.brandVoice` (string) |
| `/of1/config/suggestions.json` (DA sheet) | unwrap `{data:[{label,query}]}` → `{suggestions:[…]}` |
| `/of1/strategy.plain.html` | snapshot at sync if present (replaces per-request fetch + `strategyEnabled`) |
| DA `/templates` (or `config.templates.daPath`) | always materialized as `da-blocks-slots` |
| `/of1/knowledge/**` via `query-index.json` | always indexed. Defaults `includePaths ["/of1/knowledge/**"]`, `maxChunkTokens 400`, `contentTopK 4`. `config.contentIngestion` overrides; `enabled: false` opts out. Indexed chunk count recorded on the tenant |
| `audiences`, `generative-images`, `generative-fragments` | unchanged |
| everything else (`products`, `features`, `faqs`, `knowledge`, `personas`, `use-cases`, `of1-endpoint`, `templates`, `brand-voice` JSON, `block-guide`) | no longer read |

On every sync, purge legacy structured vectors (`product`/`feature`/`faq`/`knowledge`
prefixes) via the existing `deleteTenantVectors` logic, restricted to those prefixes.

A shared helper `unwrapSheet(json)` handles single-sheet (`:type: sheet`) and returns
rows. Multi-sheet isn't needed.

### Runtime

- `isTenantReady` = renderable templates **and** indexed content chunks > 0. `/status`
  reports `hasTemplates`, `hasContent`, `contentChunks`, `hasBrandVoice`,
  `hasSuggestions`, `hasCtaTemplate`, `hasStrategy` and `of1Endpoint` (derived).
- Content mode (`build-template-prompt`, `rag-vectorize`) keys off indexed content,
  not a flag.
- `of1Endpoint` derived (CTA href, `/status`).
- `/api/personalize` and `/api/generate-slots` ground on **content-chunk retrieval**
  (Vectorize, `contentType: content`), queried with the visitor's interests /
  slot text, replacing `tenant.products`/`knowledge`/`features`/`faqs`.

### Legacy deletion (same change)

- Flows `default`/`recommender`, `template-routing`, `da-blocks`. Only
  `da-blocks-slots` remains; `resolveFlowId` / `body.engine` override removed.
- Steps/prompts used only by those flows (to be confirmed per module by import graph):
  `generate`, `generate-json`, `template-fill`, `block-template-fill`, `render-template`,
  `llm-generate`, `json-to-html`, block-guide handling, `persona-match`,
  `use-case-match`, git-catalog `materializeTemplates`.
- Structured RAG: product/feature/faq/knowledge indexing in `indexTenantContent`,
  `config-parse.js`, `config-schemas.js`, `selectKnowledgeProducts`,
  `docs/da-config-authoring.md`.
- SDK: `/api/products` call (route doesn't exist), `products.json` fallback, legacy
  content stylesheet path. `engine` defaults to `da-blocks-slots`. `renderSearchUI`
  uses block-config `title`/`subtitle`/`placeholder` with current defaults as fallback.
- DA sync app + admin: per-file list becomes `config`, `brand-voice`, `suggestions`,
  `cta-template`, `strategy`, `templates`, `content`.
- Docs: README, `worker/API.md`, `AGENTS.md`s updated.

## Other repos

| Repo | Change |
|---|---|
| `of1-preview-extension` | `persona-config.ts` accepts the DA sheet shape and the legacy array. Row → persona mapping as above. `recommendedProducts` optional; verify `persona-profile.ts` seeding without it. The edge-proxy injected build picks this up on rebuild |
| `of1-labs` | `experiments-config.ts` allowlist → `personas` only, normalized to the array shape. Gym `instances.ts:212` drops the `template-routing` label |
| `of1-demo-skills` | `pipeline-contract.md` + orchestrator docs: new Stage-3 graph (CTA pipeline-only, no config-review), hub kept, optional full-wipe step for throwaway repos, schema reference updated |
| `of1-edge-proxy`, `of1-portal` | none (`config.json`, `cta-template.json` keep their git URLs) |

## Rollout

1. Merge `of1-gen-web-service` PR #44.
2. Ship the extension + labs adapters (they accept both shapes, so nothing breaks).
3. Build worker + skills changes together. Verify on the **dev worker**
   (`OF1_GENWEB_URL`) against a scratch EDS repo.
4. Deploy the worker to prod; merge the skills.
5. **Existing tenants (hard cut):** they keep serving from R2 until their next sync. A
   re-sync purges structured vectors and requires indexed pages, so they report
   `ready: false` until `of1-integration` is re-run. Documented in the worker README
   and the DA sync app.

## Testing

- **Worker (vitest):** sheet unwrap; brand-voice doc → string; default templates
  materialization + `daPath` override; default content ingestion + override + opt-out;
  ready gate; endpoint derivation; strategy snapshot; personalize + generate-slots
  content grounding; legacy vector purge. Deleted modules take their tests with them;
  the full suite stays green.
- **Skills:** `da-write.mjs` unit tests (rows → DA sheet payload); `fill-demo-hub.mjs`
  tests with the new inputs.
- **E2E acceptance (dev worker, scratch EDS repo):**
  - Standalone: committed paths ⊆ the allowed set (Goals); no DA deletions outside
    OF1 paths; `ready: true`; `/of1` shows authored title + chips; generate ≥2
    sections; `/api/personalize` returns grounded mutations.
  - Pipeline mode: the above + `cta-template.json` + an `inject_cta` event.
