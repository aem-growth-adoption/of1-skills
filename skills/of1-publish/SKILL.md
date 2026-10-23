---
name: of1-publish
description: Assert no OF1 config is in git, refresh the /of1 page, sync the OF1 worker (preview and publish stage), generate the demo hub (DA edit links + "what worked" panel), and run the pre-launch checks.
user-invocable: true
---

# OF1 Deploy

Assert no git config, refresh the `/of1` page, sync the OF1 worker, generate the demo hub, commit, and run the pre-launch checklist. Author-tunable config (brand voice, personas, chips, landing copy, templates, knowledge pages) already lives in DA; config.json and the CTA template are DA sheets too; this skill commits only `deliverables/index.html`. Never `git add of1/config/` or `git add -A`.

Each step is a script in `$SKILL_DIR/scripts/`; every script sources `common.sh` (env, DA token + probe, `cd "$OF1_DEMO_REPO"`, `HUB`, helpers). Run each as `bash "$SKILL_DIR/scripts/<name>"`.

## Env (the driver exports these; see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; reads `repo-config.json`, writes `of1-publish-status.json` and staged hub inputs under `hub/` |
| `OF1_DEMO_REPO` | absolute path to the local EDS site repo |
| `SKILL_DIR` | absolute path to this skill |
| `OF1_CTA_TEMPLATE` | `1`: CTA template sheet expected and checked (check 7) |
| `OF1_PUBLISH_LIVE` | `1`: publish config sheets + pages live (step 4b) before the publish sync |
| `OF1_GENWEB_URL` | optional gen-web worker override (default prod) |
| `ADOBE_IMS_TOKEN` / `OF1_TOKEN_FILE` | DA token (raw / JSON file fallback) |
| `OF1_NON_INTERACTIVE` | `1`: never ask the user (step 2b) |

## How config sync works

The worker pulls each source from `https://main--{repo}--{owner}.aem.page` (stage `preview`) or `.aem.live` (stage `publish`) on `POST $WORKER_URL/api/tenants/$TENANT_ID/sync?stage=<stage>` (no `ref`; gen-web reads `main`): the `/of1/config/config` sheet, `/of1/config/cta-template` (CTA only), `/of1/brand-voice`, `/of1/config/suggestions`, `/of1/strategy` (optional), `/of1/config/template-list`, `/templates/*`, and `/of1/knowledge/**` via `query-index.json`. `/of1/config/personas` and `/of1` are read by the extension/SDK, not synced. Response: `{ok, id, stage, ref, publishSource, synced, removed, errors, content: {indexed} | null}`; `{file, warning}` errors are non-fatal. Shapes: `of1-integration/knowledge/worker-config-schemas.md`. Tenant id (`$TENANT_ID`): `org/repo`, lowercased. Proxy host (`$PROXY_HOST`): `main--{repo}--{owner}` lowercased; `$PROXY_BASE` = `https://$PROXY_HOST.of1.live`, the preview twin is `https://prev--$PROXY_HOST.of1.live`. Sync needs `Authorization: Bearer <DA token>`; `04-sync.sh` sends it via curl stdin config so it never appears in `ps` or `hub/`. HTTP 401 → `{ok:false,error:"sync rejected …"}`; check 2 fails. Product APIs (`/api/generate`, `/api/personalize`) go through the proxy host (the edge proxy holds the gen-web credential); override with `OF1_GENERATE_BASE_URL`.

## Steps (in order)

| # | Command | What it does |
|---|---------|--------------|
| 1 | `01-assert-git-config.sh` | Resets this run's status to `running`; only allowed `of1/config/*` files may be tracked (check 1). Fails listing extras; never deletes (`of1-check-dependencies` step 3b does) |
| 2 | `02-refresh-of1-page.sh` | Re-uploads `/of1` via `of1-style-generative-block/scripts/upload-of1-page.sh` (override path: `OF1_UPLOAD_PAGE_SCRIPT`) so the landing copy from `of1-build-quick-suggestions` is present |
| 2b | `02b-index-overrides.sh` | Probes `/query-index.json`; when it lacks `/of1/knowledge/`, upserts the `contentIngestion.indexPath` row (from `/sitemap.json`) of the `/of1/config/config` sheet via `da-write.mjs sheet` (no git). A user-set `indexPath` is left alone. If no index lists the knowledge pages, ask the user for another index (add it to `INDEX_CANDIDATES`, re-run; with `OF1_NON_INTERACTIVE=1` just continue). |
| 3 | `03-push-config.sh` | Previews the config sheets present in DA (`config`, `cta-template`, `suggestions`, `template-list`, `personas`, `audiences`, `signals`, `llmquestions`, `context-endpoints`; absent ones are skipped; nothing is committed). `signals`, `llmquestions`, `context-endpoints` are read by the edge proxy at request time. A failed preview (not HTTP 200/201) prints `✗ preview failed <path> (HTTP <code>)` to stderr; the step goes through every sheet, prints `previewed N, failed M` and always exits 0 (check 2 and the sync catch real problems) |
| 3b | `03b-wait-config.sh` | Polls the preview host until it serves the config sheet JSON (24 x 5 s, warns on timeout) |
| 4 | `04-sync.sh` | Preview sync, then (only `OF1_PUBLISH_LIVE=1`) `04b-publish-live.sh` (`da-write.mjs live` for the same config sheets as step 3 (incl. the proxy sheets `signals`, `llmquestions`, `context-endpoints`, which the publish host's proxy reads from aem.live), `/of1`, brand-voice, strategy, knowledge and template pages; a failed probe (401/403/5xx) or page is counted in `hub/publish-live.json`, `04b` exits 1, `04-sync.sh` still runs the publish sync and check 2 fails on it), then publish sync. Writes `hub/sync-preview.json`, `hub/sync-publish.json`, `hub/sync.json` (= preview). A site too big for one call (error `Too many subrequests`, ~40+ pages) is re-synced automatically in content batches by `of1_sync`; then wait a few minutes for Vectorize before checks 2/6 |
| 5 | `05-status.sh` | `/status?stage=preview` → `hub/status.json` (gated flags `hasTemplates`/`hasContent`); publish status → `hub/status-publish.json` (informational) |
| 6 | `06-da-listings.sh` | `hub/da-{pages,templates,knowledge}.txt` from DA |
| 7 | `07-hub.sh` | Generates `deliverables/index.html` via `assets/fill-demo-hub.mjs` (never hand-write the hub) |
| 8 | `08-publish-hub.sh` | Regenerates the hub, commits only if changed, rebases, pushes — **before the checks** (check 5 needs the hub live at `${PREVIEW_BASE}/deliverables/index.html`) |
| after checks | `finish.sh done\|failed "<summary>"` | Writes the final status, regenerates the hub, commits only if changed, rebases, pushes; prints the Completion values |

## Failure flow

- Steps 1, 2, 2b, 3 failing: stop and report; fix and re-run from that step.
- Step 4 exits `3` with `legacy-tenant-present` when the publish sync answers 409 `Tenant not migrated` (legacy gen-web data): an admin must delete or migrate the gen-web tenant, then re-run; check 2 names this reason.
- Steps 4-6 may report a bad sync or status: do NOT stop. Finish 7 and 8 so the hub's "What worked" panel shows what failed and is live for check 5, then let the checks fail.
- `checks.sh all` runs every applicable check, prints each result and exits 1 if any failed. Fix the cause (usually: preview the DA item, re-run the producing skill) and re-run from step 4.
- On any failed check call `finish.sh failed "Check <N> failed: <reason>"`, then stop. On success call `finish.sh done` (default summary names the indexed chunk count and the check count). `finish.sh` re-generates and re-commits the hub after the checks so the committed hub reflects the final status of this run, never the previous one.

## Pre-Launch Checklist (MANDATORY)

`bash "$SKILL_DIR/scripts/checks.sh" <N|all>`. Check 7 runs only with `OF1_CTA_TEMPLATE=1` (7 checks, otherwise 6). Check 4 is not machine-judged: it ends with a `REVIEW check 4 output above: …` line — read the output; any `HEADER/FOOTER/OF1 BLOCK MISSING`, `TITLE MISSING` or `chips: 0` is a failure. `all` therefore ends `checks 1-3,5-6(,7) passed; check 4 needs your review` (exit codes cover only the machine-checkable checks).

| # | Check | Hint when it fails |
|---|-------|--------------------|
| 1 | `config.json`, `cta-template.json`, `signals.json`, `llmquestions.json`, `context-endpoints.json` not tracked under `of1/config/` | Run `of1-migrate` |
| 2 | Preview sync strict: `ok: true`, no non-warning `errors`, `content.indexed > 0`. Publish sync: `ok: true` and every error a warning (404s, an unpublished site and empty results pass; 401/403/5xx fail) | `brand-voice: empty document` = doc not previewed; indexed 0 = knowledge pages not in the index (check `helix-query.yaml` / config-service index, `.hlxignore`, and that pages are published live); see step 2b |
| 3 | `/status` has `ready: true` (only `hasTemplates`/`hasContent` gate it; `hasBrandVoice`/`hasSuggestions` should still be true) | Re-run `of1-build-templates` / content steps, then step 4 |
| 4 | `/of1` renders header, footer, the `of1` block, the authored title (from `of1-landing.json`) and >=1 chip | Default title: step 2 ran before `of1-build-quick-suggestions`. No chips: suggestions sheet not previewed. No header/footer: `/nav` `/footer` missing (`of1-style-generative-block` step 4). No block: `blocks/of1/` not pushed |
| 5 | `nav.plain.html`, `footer.plain.html`, `/of1`, `deliverables/index.html` (+ `discovery.html` if discovery output exists) return 200 | Chrome fragment 404 makes every page chromeless |
| 6 | `https://prev--$PROXY_HOST.of1.live/api/generate` and `$PROXY_BASE/api/generate` (body `{id, index, …}`; the live host warns on 404 only while the publish sync synced nothing) stream >=2 `type:"section"` events **or one section carrying >=2 blocks** (the da-blocks-slots engine emits a whole page as one section), no `type:"error"` | HTTP 401/403/404 from the proxy fails (credential not accepted / no passthrough or host not proxied); an HTML or unreachable response only warns and the smoke test is NOT run — verify manually. `template not selected`: re-sync after `of1-build-templates`; check the `/of1/config/template-list` sheet exists and is previewed (`of1-build-templates` assemble), and that `config.json` has no `templates.names` override (step 2b removes it) |
| 7 | CTA only: CTA template sheet synced and `/api/personalize` streams `inject_cta` | Check `hasCtaTemplate` in `hub/status.json` |

## Completion

`finish.sh` prints the values (`DOMAIN`, hub URL, OF1 URL, DA config link, tenant id `org/repo`) — they come from `$OF1_STATE_DIR/repo-config.json` (`DOMAIN`, `PREVIEW_BASE`, `TENANT_ID`, `OWNER`/`REPO`); copy them. Report: `## Demo Ready: ${DOMAIN}` with the Demo Hub (`${PREVIEW_BASE}/deliverables/index.html`), the OF1 page (`${PREVIEW_BASE}/of1`), the DA config link (`https://da.live/#/${OWNER}/${REPO}/of1`), the worker tenant, and `Pre-launch checklist: N/N passed` (count check 4 only after your review). `playwright-cli` is driven through `lib/pw.sh` (run from the state dir, never the repo).
