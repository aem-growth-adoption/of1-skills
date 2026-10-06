# DA-first config — Plan 2/4: gen-web worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The worker syncs config from DA (brand-voice doc, suggestions sheet, strategy doc, `/templates`, `/of1/knowledge/**`) plus git `config.json`/`cta-template.json`, gates readiness on templates + indexed content, grounds personalize/generate-slots on content chunks, and drops every legacy engine and structured-RAG path.

**Architecture:** Two new small modules (`sheet.js`, `content-retrieval.js`) become the shared primitives; `sync.js` is reorganised around a fixed `CONFIG_FILES` list with one fetcher per source; `tenant.js` owns defaults (endpoint URL, content ingestion) and the ready gate. Legacy deletion happens last, after nothing live reads the legacy data.

**Tech Stack:** Cloudflare Workers JS, Vectorize, Workers AI (`@cf/baai/bge-base-en-v1.5`), R2, KV, Nunjucks prompts (compiled by `scripts/build-prompts.mjs`), vitest (`cd worker && npx vitest run`).

**Spec:** `of1-skills/docs/superpowers/specs/2026-10-05-da-first-config-design.md`

## Global Constraints

- **Setup:** local checkout is behind `origin/main` with unrelated WIP. Create a worktree: `git fetch origin && git worktree add -b feat/da-first-config ../of1-gen-web-service-da-first origin/main`, `npm ci` at root and in `worker/`. PR #44 (vectorId) is already in `origin/main`.
- `CONFIG_FILES` (sync.js **and** tenant.js, same list, same order): `config, brand-voice, suggestions, cta-template, strategy, templates, content, audiences, generative-images, generative-fragments`.
- Default content ingestion (verbatim): `{ enabled: true, includePaths: ["/of1/knowledge/**"], maxChunkTokens: 400, contentTopK: 4 }`; `config.contentIngestion` fields override individually; `enabled: false` opts out.
- Default endpoint: `config.of1Endpoint ?? \`https://${id}.aem.page/of1\``.
- Default templates: engine `da-blocks-slots`, `daPath` = `config.templates?.daPath ?? "/templates"`, `baseUrl` `https://${id}.aem.page`.
- Ready gate: `hasRenderableTemplates(tenant) && (tenant.content?.indexed ?? 0) > 0`. Nothing else.
- R2 value shapes (camelCased tenant keys): `brandVoice` = string; `suggestions` = `{suggestions:[{label,query}]}`; `strategy` = string; `templates` = materialize blob; `content` = `{indexed:number}`; `ctaTemplate`, `config` = raw JSON.
- `/status.config` keys (exactly): `hasTemplates, hasContent, contentChunks, hasBrandVoice, hasSuggestions, hasCtaTemplate, hasStrategy`; top-level `ready`, `of1Endpoint` (derived, never null).
- Hard cut: no reading of `products, features, faqs, knowledge, personas, use-cases, of1-endpoint, block-guide, testimonials` JSON anywhere.
- Every task ends with `cd worker && npx vitest run` fully green (vitest globalSetup rebuilds prompts).

## Review Focus

- Tenant id at the 64-byte boundary (e.g. `llm-traffic-tracking--masterclass-demo--znikolovski`) through the whole sync → content vectors upsert succeeds (regression of PR #44 path). Add to Task 3.
- `/of1/brand-voice` exists but is empty/whitespace → `brandVoice` not stored (keep prior R2 copy), `errors[]` gets `{file:"brand-voice", error:"empty document"}`; never store `""`. Add to Task 2.
- Suggestions sheet rows with only `label` or only `query` → kept with the missing field copied from the other; rows with both empty dropped. Add to Task 2.
- Sync with `?file=content` on a tenant whose `query-index.json` 404s → `content` R2 entry unchanged (not zeroed) and `errors[]` has `{content:"query-index", status:404}`; tenant not flipped to unready by a transient EDS failure. Add to Task 3.
- `/api/personalize` for a tenant with zero content chunks → still streams mutations (empty `documents`), no throw. Add to Task 5.

---

### Task 1: Shared primitives — `unwrapSheet` and content retrieval

**Files:**
- Create: `worker/src/sheet.js`, `worker/src/content-retrieval.js`
- Modify: `worker/src/pipeline/steps/rag-vectorize.js:95-116` (use the helper), `worker/src/generative-images.js:11-32`, `worker/src/generative-fragments.js:5-26` (reuse `unwrapSheet` for the single-sheet fallback only if behaviour is identical; otherwise leave)
- Test: `worker/src/sheet.test.js`, `worker/src/content-retrieval.test.js`

**Interfaces:**
- Produces: `unwrapSheet(json: unknown): object[]` — array → itself; `{data:[…]}` → `data`; `{":type":"multi-sheet", ":names":[n…]}` → `json[n0].data`; else `[]`.
- Produces: `embedQuery(env, text: string): Promise<number[]|null>` (null when `!env.AI` or blank text).
- Produces: `retrieveContentDocuments(env, tenantId: string, {query?: string, queryVector?: number[], topK?: number = 4}): Promise<Array<{path,title,heading,text,images:{src,alt}[],_score}>>` — `[]` when `!env.VECTORIZE`, no vector, or `topK <= 0`; filter `{tenant: tenantId, contentType: "content"}`, `returnMetadata: "all"`; mapping identical to current `rag-vectorize.js:105-115`.

- [ ] **Step 1: Failing tests** — `sheet.test.js`: the four shapes above + `null`/`"x"` → `[]`. `content-retrieval.test.js` (use `fakeEnv`, `fakeVectorize({matches:[{score:0.9,metadata:{path:"/of1/knowledge/a",title:"A",heading:"H",text:"T",images:'[{"src":"s","alt":""}]'}}]})`): returns `[{path:"/of1/knowledge/a",title:"A",heading:"H",text:"T",images:[{src:"s",alt:""}],_score:0.9}]`; asserts `env.VECTORIZE.calls.query[0][1].filter` equals `{tenant:"acme",contentType:"content"}` and `topK` 4; `topK:0` → `[]` with no query call; `embedQuery(env,"  ")` → `null`.
- [ ] **Step 2:** run the two files → FAIL.
- [ ] **Step 3: Implement** both modules; `rag-vectorize.js` calls `retrieveContentDocuments(env, ctx.tenant.id, { queryVector, topK })` for the documents branch.
- [ ] **Step 4:** full suite → PASS (`rag-vectorize.test.js` unchanged).
- [ ] **Step 5: Commit** `refactor: extract unwrapSheet + content retrieval helpers`

### Task 2: Sync — DA sources for brand voice, suggestions, strategy

**Files:**
- Modify: `worker/src/sync.js` (CONFIG_FILES, per-file fetchers), `worker/src/tenant.js:2-20` (CONFIG_FILES)
- Test: `worker/src/sync-da-sources.test.js` (new); update `worker/src/sync.test.js` invalid-file + cache cases to new names

**Interfaces:**
- Consumes: `unwrapSheet` (Task 1), `stripHtml`, `formatStrategyEntries`, `MAX_STRATEGY_CHARS` from `strategy.js`, `edsAuthHeaders`.
- Produces: `export const CONFIG_FILES` (Global Constraints list) from both `sync.js` and `tenant.js`; R2 writes per Global Constraints shapes. Sources:
  - `brand-voice` ← `https://${id}.aem.page/of1/brand-voice.plain.html` → `stripHtml`
  - `suggestions` ← `https://${id}.aem.page/of1/config/suggestions.json` → `unwrapSheet` → `{suggestions:[{label,query}]}`
  - `strategy` ← `https://${id}.aem.page/of1/strategy.plain.html` → `formatStrategyEntries`, capped at `MAX_STRATEGY_CHARS`
  - `config`, `cta-template`, `audiences`, `generative-*` ← `.../of1/config/<file>.json` (unchanged handling)
  - Source 404 → skip silently (prior R2 copy kept), as today.

- [ ] **Step 1: Failing tests** (`stubFetchRoutes`, `fakeEnv`, call `handleSync({}, new URL("https://w/api/tenants/acme/sync?file=<f>"), env)`):
  - brand-voice: `.plain.html` `"<h2>Tone</h2><p>Warm &amp; direct</p>"` → R2 `tenants/acme/brand-voice.json` parses to string containing `"Tone"` and `"Warm & direct"`; `synced` includes `"brand-voice"`.
  - brand-voice empty doc `"<div> </div>"` → not written; `errors` contains `{file:"brand-voice", error:"empty document"}`.
  - suggestions: sheet `{":type":"sheet",data:[{label:"Compare",query:"Compare A vs B"},{label:"",query:"Only query"},{label:"",query:""}]}` → stored `{suggestions:[{label:"Compare",query:"Compare A vs B"},{label:"Only query",query:"Only query"}]}`.
  - strategy: 404 → not written, no error; 200 doc → stored string ≤ 8000 chars.
  - `?file=products` → 400 `Invalid config file: products`.
  - Old DA-backed path gone: no fetch of any `.plain.html` under `/of1/config/` (assert stub not hit).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Remove `DA_BACKED_FILES`, the `parsePlainHtml` branch, `VECTOR_FILES` vector phase, `materializeTemplates` (git catalog) and their imports. Keep `isSyncAuthorized`, `isSafeTenantId` guard, cache delete.
- [ ] **Step 4:** delete `worker/src/sync-daconfig.test.js` (covers removed DA-backed products/knowledge); full suite → PASS.
- [ ] **Step 5: Commit** `feat(sync): read brand voice, suggestions, strategy from DA`

### Task 3: Sync — default templates, default content ingestion, legacy vector purge

**Files:**
- Modify: `worker/src/sync.js` (templates + content phases), `worker/src/embeddings.js:215-243`, `worker/src/tenant.js` (defaults)
- Test: `worker/src/sync-defaults.test.js` (new); update `worker/src/sync-content.test.js`, `sync-content-images.test.js`, `embeddings.test.js` (deleteTenantVectors)

**Interfaces:**
- Consumes: `materializeDaTemplates(cfg)`, `indexTenantPages(id, chunks, env)`.
- Produces (tenant.js): `export const DEFAULT_CONTENT_INGESTION`; `export function contentIngestionFor(config): {enabled,includePaths,maxChunkTokens,contentTopK}`.
- Produces (sync.js): `export async function syncTemplates(id, config, errors, env): Promise<boolean>`; `export async function syncContent(id, authHeaders, errors, env): Promise<{indexed:number}|null>` (renamed `ingestTenantPages`; reads `config` from R2, applies `contentIngestionFor`; on success writes R2 `tenants/${id}/content.json` = `{indexed}`; on query-index failure returns `null` and leaves `content.json` untouched).
- Produces (embeddings.js): `export async function purgeLegacyVectors(id, env): Promise<number>` — deletes ids from `query` over contentTypes `product, feature, faq, knowledge` (loop pages of 100 until a page returns < 100); `deleteTenantVectors(id, env)` = `purgeLegacyVectors` + content manifest delete (tenant delete keeps working).
- Full sync order: per-file sources (Task 2) → `syncTemplates` → `purgeLegacyVectors` → `syncContent` → cache delete. `?file=templates` / `?file=content` run only that phase. Response: `{ok,id,domain,synced,errors,content}` (`vectors` key removed).

- [ ] **Step 1: Failing tests:**
  - No `templates` override: `query-index.json` lists `/templates/comparison-a`, `.plain.html` served → R2 `templates.json` blob `engine === "da-blocks-slots"`, `daPath === "/templates"`, `templates.length === 1`; `synced` includes `"templates"`.
  - `config.json` `{templates:{daPath:"/of1-templates"}}` → materialize reads `/of1-templates/…`.
  - No `config.json` at all, `query-index` lists `/of1/knowledge/a` → `content.indexed === 1`, R2 `content.json` = `{indexed:1}`.
  - `config.json` `{contentIngestion:{enabled:false}}` → `content` is `null`, no upsert.
  - `config.json` `{contentIngestion:{includePaths:["/blog/**"]}}` → `/of1/knowledge/a` skipped, `/blog/x` indexed.
  - query-index 404 with prior `content.json` `{indexed:5}` → still `{indexed:5}`; `errors` has `{content:"query-index",status:404}`.
  - Long tenant id `llm-traffic-tracking--masterclass-demo--znikolovski` full sync → every upserted id ≤ 64 bytes.
  - `purgeLegacyVectors` calls `deleteByIds` with ids returned for the four legacy types and never queries `contentType:"content"`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** full suite → PASS.
- [ ] **Step 5: Commit** `feat(sync): default da-blocks-slots templates + content ingestion, purge legacy vectors`

### Task 4: Tenant readiness, status, endpoint, strategy, admin reindex, DA app

**Files:**
- Modify: `worker/src/tenant.js:74-111`, `worker/src/index.js:68-75,167`, `worker/src/personalize.js:97-103,154-160,365-368`, `worker/src/admin-routes.js:166-263,288-309`, `worker/src/da-app.js:7-14,97-115`
- Test: `worker/src/tenant.test.js` (rewrite isTenantReady/tenantStatus cases), `worker/src/personalize.strategy.test.js`, `worker/src/admin-routes.test.js`, `worker/src/da-app.test.js`

**Interfaces:**
- Produces (tenant.js): `export function of1EndpointUrl(tenant): string`; `isTenantReady(tenant)` per Global Constraints; `tenantStatus(tenant)` → `{ready, of1Endpoint, config:{…7 keys}}`.
- Produces (personalize.js): `resolveStrategyForTenant(tenant): string|null` → `tenant.strategy || null` (no fetch, no flag).
- Admin: `POST /api/admin/tenants/:id/reindex` and `POST /api/admin/reindex` → `purgeLegacyVectors` + `syncContent` (fixes the wipe-without-rebuild bug). `PUT /api/admin/tenants/:id/config` accepts only `CONFIG_FILES` keys and no longer calls `indexTenantContent`.
- DA app: `deriveConfigFile` maps `/of1/brand-voice` → `brand-voice`, `/of1/strategy` → `strategy`, `/of1/config/<f>` → `<f>` if in `CONFIG_FILES`, `/templates/*` → `templates`, `/of1/knowledge/*` → `content`; shows `body.content.indexed`.

- [ ] **Step 1: Failing tests:**
  - `isTenantReady({templates:{engine:"da-blocks-slots",templates:[{}]}, content:{indexed:3}})` → true; with `content:{indexed:0}` → false; templates empty → false; no suggestions/cta/endpoint needed.
  - `tenantStatus` exact key set; `of1Endpoint` `"https://acme--r--o.aem.page/of1"` for id `acme--r--o` with no config; `config.of1Endpoint` override wins.
  - CTA href in personalize stream uses derived endpoint (existing personalize-stream test adjusted).
  - `resolveStrategyForTenant({strategy:"S"})` → `"S"`; `{}` → `null`; no `fetch` call.
  - admin reindex: `syncContent` path upserts content vectors (fake query-index + page).
  - da-app: `/of1/brand-voice` → `brand-voice`, `/of1/knowledge/x` → `content`, `/of1/config/products` → not a sync file.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Remove `ctx.strategy` assignment in `index.js:167`.
- [ ] **Step 4:** full suite → PASS.
- [ ] **Step 5: Commit** `feat(tenant): ready = templates + indexed content; derive endpoint; strategy from sync`

### Task 5: Ground personalize and generate-slots on content chunks

**Files:**
- Modify: `worker/src/personalize.js:100-101,261-275,9-35,180-182`, `worker/src/generate-slots.js:182-212,463-508`
- Modify: `prompts/shared/macros.njk` (add `siteContent`), `prompts/personalize/template.njk:12-13,80`, `prompts/generate-slots/template.njk:10,50-51`, `prompts/block-slot-fill/template.njk:37-43` (switch to the macro), each `prompt.yaml` var list
- Test: `worker/src/personalize.test.js`, `worker/src/generate-slots.test.js`, `worker/src/prompts/generate-slots-render.test.js`, new `worker/src/prompts/site-content-macro.test.js`

**Interfaces:**
- Consumes: `embedQuery`, `retrieveContentDocuments` (Task 1).
- Produces: `buildPersonalizeVars(tenant, opts)` takes `documents` instead of `products`; personalize query text = `[...interests.map(i=>i.topic), behaviorProfile.intent].filter(Boolean).join(" ")`, topK 5. generate-slots query text = `slots.map(s=>s.instruction).join(" ")` (+ `buildSelectionQuery(reqContext)`), topK 6; pass `documents` instead of `products`/`content`.
- Macro: `siteContent(documents)` renders `## Site content` + one line per doc `- {heading: }{text} (source: {path})` exactly as block-slot-fill does today.

- [ ] **Step 1: Failing tests:** personalize with `fakeVectorize` returning one content match → rendered system prompt contains `## Site content` and the chunk text, not `## Available Products`; zero matches → stream still completes with mutations. generate-slots: same assertion; `pickRelevantProducts`/`pickRelevantContent` no longer exported/used. Macro test renders the exact line format.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement**; delete `matchProductsToInterests`, `selectKnowledgeProducts`, `pickRelevantProducts`, `pickRelevantContent` and their tests; debug payloads report `documents` count instead of products.
- [ ] **Step 4:** full suite → PASS.
- [ ] **Step 5: Commit** `feat: ground personalize + generate-slots on content chunks`

### Task 6: Delete legacy flows (keep only da-blocks-slots)

**Files:**
- Modify: `worker/src/pipeline/flows.js` (only `DA_BLOCK_SLOTS_FLOW`, without `persona-match`/`use-case-match`; `STATIC_FLOWS = { "da-blocks-slots": … }`, `resolveFlow` falls back to it), `worker/src/pipeline/steps/index.js:26-51`, `worker/src/index.js:137-172` (delete `resolveFlowId`, always `da-blocks-slots`), `worker/src/pipeline/steps/template-select.js` (drop `useRouting` gate, `buildStaticDebugUrl`, `ctx.rag.products` item-count filter), `build-block-slot-prompt.js:57,68,71-72`, `pick-suggestions.js:68-69`, `pipeline/lib/debug-payload.js` (persona/useCase/products fields), `prompts/block-slot-fill/template.njk:35-36,54-55`, `prompts/pick-suggestions/template.njk:15-16`, `pipeline/lib/link-allowlist.js:42` (products source removed)
- Delete (modules + their tests): steps `build-prompt, llm-generate, build-template-prompt, llm-fill-slots, validate-image-urls, render-template, build-block-template-prompt, llm-fill-blocks, validate-block-structure, emit-block-sections, rag-products, rag-content, persona-match, use-case-match`; libs `json-to-html.js, sanitize.js, stream-parser.js, pipeline/lib/slot-cleanup.js, pipeline/lib/products.js`; `block-parser.js` exports `parseBlocks`/`extractJsonObjects` only (keep `IncrementalArrayParser`); prompts `generate/, template-fill/, block-template-fill/, generate-json/, shared/default-block-guide.njk, shared/json-block-guide.njk`, macros `dynamicBlockGuide`, `ragKnowledge`, `ragProducts`, `ragContent` and the `autoExample` filter in `scripts/build-prompts.mjs`
- Edit (mixed tests): `llm-fill-model-override.test.js`, `stage-params.test.js`, `pipeline/flows.test.js`, `index.test.js:85-108`, `prompts/strategy-render.test.js` (keep personalize cases); promptfoo `tests/promptfoo/prompt-loader.js:44-50`, delete `perf.generate*.yaml`, `regression.generate.yaml`, root `package.json` `prompts:regression`/`prompts:perf:generate*` scripts

**Interfaces:**
- Produces: `/api/generate` always runs `da-blocks-slots`; `body.engine` ignored.

- [ ] **Step 1: Failing test** in `flows.test.js`: `Object.keys(STATIC_FLOWS)` equals `["da-blocks-slots"]`; its step names contain neither `persona-match` nor `use-case-match`; `resolveFlow("default", env)` returns the slots flow.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Delete/modify** per Files. Before deleting each module run `grep -rn "<module basename>" worker/src prompts scripts` and confirm the only importers are in the delete list.
- [ ] **Step 4:** `cd worker && npx vitest run` → PASS; `npm run build:prompts` (or vitest globalSetup) succeeds; `npx wrangler deploy --dry-run` bundles.
- [ ] **Step 5: Commit** `refactor!: remove legacy generation flows, persona/use-case matching`

### Task 7: Delete structured RAG

**Files:**
- Modify: `worker/src/embeddings.js` (delete `indexTenantContent`), `worker/src/pipeline/steps/rag-vectorize.js` (only the content query; drop product/feature/faq/knowledge buckets, `normalizeKnowledgeItem`, `contentEnabled` → `contentIngestionFor(ctx.tenant.config).enabled && (ctx.tenant.content?.indexed ?? 0) > 0`), `worker/src/admin-routes.js:265-286` (rag endpoint returns `{query, documents}`)
- Delete: `worker/src/config-parse.js`, `worker/src/config-schemas.js` + tests, `docs/da-config-authoring.md`
- Test: `rag-vectorize.test.js` (rewrite), `embeddings.test.js` (drop indexTenantContent cases), `admin-routes.test.js`

- [ ] **Step 1: Failing test** in `rag-vectorize.test.js`: tenant `{id:"acme",config:{},content:{indexed:2}}` → exactly one Vectorize query with filter `{tenant:"acme",contentType:"content"}`, `ctx.rag.documents` populated, `ctx.rag.products` undefined; tenant with `content:{indexed:0}` → zero queries, `documents` `[]`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement/delete.**
- [ ] **Step 4:** full suite → PASS; `grep -rn "indexTenantContent\|config-parse\|config-schemas\|tenant.products\|tenant.knowledge" worker/src` → no hits.
- [ ] **Step 5: Commit** `refactor!: remove structured RAG (products/features/faqs/knowledge)`

### Task 8: SDK + admin UI

**Files:**
- Modify: `worker/src/sdk/of1-client.js` — `init` (1415-1529): search UI copy from `config.title`/`config.subtitle`/`config.placeholder`, falling back to `loadSuggestionsFromAPI` defaults; delete legacy stylesheet block (1432-1444), `_loadProductImages` + `_fixBrokenImages` + `productImages` state (21, 614-686), `handleStreamEvent` `page` branch (862-881), `injectSection` `skipDecoration` branch (943-971); JSDoc `engine` note → "defaults to da-blocks-slots". Delete `worker/src/sdk/of1-client-legacy-content.css` if no other reference.
- Modify: `worker/admin/src/components/TenantDetail.tsx:8-21`, `worker/admin/src/lib/api.ts:50-64`, `worker/admin/src/components/RetrievalTester.tsx:20-26,74-77` to the new file list / `{query, documents}` shape
- Test: SDK tests under `worker/src/sdk/` (follow existing pattern) — new case: block config `{title:"Ask Frescopa"}` → rendered `<h1>` text `Ask Frescopa`; absent → `"What can we help you find?"`.

- [ ] **Step 1: Failing SDK test** (as above).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `cd worker && npx vitest run` PASS; `cd worker/admin && npm run build` PASS (typecheck).
- [ ] **Step 5: Commit** `feat(sdk): landing copy from block config; drop legacy paths`

### Task 9: Docs, dev deploy, smoke

**Files:**
- Modify: `README.md`, `worker/API.md` (sync response, status keys, removed `engine`), `AGENTS.md:17`, `worker/src/AGENTS.md` (flows, contracts), `worker/docs/da-sync-app.md` (file list; add "Hard cut: tenants synced before <deploy date> need `of1-integration` re-run")

- [ ] **Step 1:** update docs.
- [ ] **Step 2:** `npm run deploy:dev` (personal/dev env). Smoke against a scratch tenant prepared by Plan 3 Task 1 (or any tenant with `/templates` + `/of1/knowledge`): `curl -X POST <dev>/api/tenants/<id>/sync` → `ok:true`, `content.indexed>0`; `/status` → `ready:true`; `POST /api/generate` → ≥2 `section` events; `POST /api/personalize` → mutations.
- [ ] **Step 3: Commit** `docs: DA-first config`; push; open PR (title `feat!: DA-first tenant config`), body lists breaking changes + hard-cut note. **Do not deploy prod** until Plan 3 is ready to merge (rollout step 4).
