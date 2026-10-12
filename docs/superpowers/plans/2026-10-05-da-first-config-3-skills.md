# DA-first config — Plan 3/4: of1-skills Implementation Plan

Status: Implemented (PRs #11, #12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The OF1 skills author config in DA (brand-voice doc, personas + suggestions sheets, `/of1` block rows), commit only the allowed paths, never delete non-OF1 content, and keep the demo hub.

**Architecture:** One shared Node helper `skills/of1-integration/assets/da-write.mjs` (DA doc/sheet write + preview) replaces the per-skill copies for new writes; SKILL.md files change to call it. Intermediate data moves to `$OF1_STATE_DIR`. `fill-demo-hub.mjs` becomes importable and testable, reading only local files that `of1-publish` stages.

**Tech Stack:** Bash-in-Markdown skills, Node ESM `.mjs` assets, `node --test` (run from repo root, e.g. `node --test skills/of1-integration/assets/da-write.test.mjs`).

**Spec:** `of1-skills/docs/superpowers/specs/2026-10-05-da-first-config-design.md`

## Global Constraints

- Branch: continue on `spec/da-first-config` (spec + plans already there) or a new `feat/da-first-config` from it.
- Allowed committed paths, standalone (verbatim from spec): `blocks/of1/`, new `blocks/<name>/`, `helix-query.yaml` (only if absent), `of1/config/config.json`, `stardust/` + `PRODUCT.md` (only when extraction ran), `deliverables/index.html` (+ `deliverables/brand-review.html` when extraction ran). Pipeline mode adds `of1/config/cta-template.json`.
- Never commit `of1/config/{personas,suggestions}.json` (git shadows the DA sheet).
- DA paths: doc `/of1/brand-voice`; sheets `/of1/config/personas` (cols `id,name,description,keywords,priorities,explore,research,compare,purchase,deals,support`) and `/of1/config/suggestions` (cols `label,query`); `/of1` block extra rows `title`, `subtitle`, `placeholder`.
- `config.json` contents written by skills: `{ "domain": "<DOMAIN>" }` only (contentIngestion uses worker defaults).
- OF1-owned paths (the only ones "Restart" may delete): DA `/of1/**`, `/templates/**`; git `blocks/of1/`, `of1/config/`.
- Worker sync file names: `config, brand-voice, suggestions, cta-template, strategy, templates, content`.

## Review Focus

- DA sheet cell containing a comma inside a persona keyword list authored by the AI (e.g. `"sugar, free"`) → written as-is in the `keywords` cell; consumers split on comma — the skill must not author keywords containing commas. Pin in Task 3's SKILL.md and a `da-write` validation that rejects a `keywords`/`priorities` array item containing `,`.
- Re-running `of1-integration` on a site that already has `/of1/brand-voice` edited by an author → the skill must not overwrite it without asking in standalone mode (pipeline mode overwrites). Pin in Task 3.
- Site with an existing `helix-query.yaml` lacking `/of1/knowledge` → warning only, file untouched; `of1-publish` check 2 (`content.indexed > 0`) fails with an actionable message. Pin in Task 2 + Task 6.
- `.hlxignore` containing `of1/knowledge/` (not `of1/config/`) → left alone. Pin in Task 2.
- DA preview 401/403 on a sheet write → `da-write.mjs` exits non-zero with the path and status; skill stops (no silent "done"). Pin in Task 1.

---

### Task 1: `da-write.mjs` — DA doc/sheet writer + preview

**Files:**
- Create: `skills/of1-integration/assets/da-write.mjs`, `skills/of1-integration/assets/da-write.test.mjs`

**Interfaces:**
- Produces (exported, pure): `buildSheetJson(rows: object[], columns: string[]): object` → `{ total, limit, offset: 0, data, ":type": "sheet" }` with every row projected to `columns` (missing → `""`, arrays → `", "`-joined, numbers → string); throws if any array item contains `,`.
- Produces (exported, pure): `buildMultipart(content: string|Uint8Array, filename: string, contentType: string): { body, contentType }` (field name `data`).
- Produces (exported): `resolveToken(): Promise<string>` — order `$DA_TOKEN`, `$ADOBE_IMS_TOKEN`, `$OF1_TOKEN_FILE`, `oauth-token adobe`, `./.hlx/.da-token.json`, `$OF1_DEMO_REPO/.hlx/.da-token.json`.
- CLI (runs only when executed directly):
  - `node da-write.mjs doc --owner O --repo R --branch B --path of1/brand-voice --file <html>` → POST multipart `admin.da.live/source/O/R/of1/brand-voice.html`, then POST `admin.hlx.page/preview/O/R/B/of1/brand-voice` with `Authorization` + `x-content-source-authorization`.
  - `node da-write.mjs sheet --owner O --repo R --branch B --path of1/config/personas --columns a,b,c --rows <json-file>` → same, with `.json` source and preview of `of1/config/personas.json`.
  - Non-2xx on upload or preview → stderr `FAIL <step> <path> HTTP <status>`, exit 1. Success → stdout `✓ <path> previewed`.

- [ ] **Step 0: Verify DA sheet contract (spike, keep notes in the commit message).** On a scratch repo you own, run the CLI `sheet` command with 2 rows, then `curl https://<branch>--<repo>--<owner>.aem.page/of1/config/personas.json` → expect `{"total":2,…,"data":[…],":type":"sheet"}` and the sheet opens in `da.live`. If DA rejects the payload, capture what `da.live` itself saves for a hand-made sheet (`GET admin.da.live/source/O/R/<path>.json`) and make `buildSheetJson` emit that shape; update the tests in Step 1 accordingly.
- [ ] **Step 1: Failing tests:** `buildSheetJson([{name:"A",keywords:["x","y"],explore:0.2}], ["id","name","keywords","explore"])` deep-equals `{total:1,limit:1,offset:0,data:[{id:"",name:"A",keywords:"x, y",explore:"0.2"}],":type":"sheet"}`; item `"a,b"` in an array → throws `/comma/`; `buildMultipart("<p>x</p>","b.html","text/html")` body contains `name="data"; filename="b.html"` and `Content-Type: text/html`.
- [ ] **Step 2:** `node --test skills/of1-integration/assets/da-write.test.mjs` → FAIL.
- [ ] **Step 3: Implement** (CLI guard: `import.meta.url === pathToFileURL(process.argv[1]).href`).
- [ ] **Step 4:** test → PASS.
- [ ] **Step 5: Commit** `feat(of1-integration): shared da-write helper for DA docs and sheets`

### Task 2: `of1-check-dependencies` — no destructive clean-up, trimmed config

**Files:**
- Modify: `skills/of1-check-dependencies/SKILL.md` §3 (L113-160), §6 (L216-230), §7 (L232-271), §8 (L273-314)

- [ ] **Step 1:** §3 → rename "Restart: remove OF1-owned content only". Fresh run (no `repo-config.json`): **no deletion**. Restart: DA — list and DELETE recursively only under `/of1` and `/templates` (use `admin.da.live/list/O/R/of1` and `/templates`); git — `git rm -r --ignore-unmatch blocks/of1 of1/config`, commit `chore: reset OF1 artefacts for ${BRANCH}`, push. Delete the old `rm -rf` line, the `styles/of1-*.css`/`PRODUCT.md` removal and the top-level DA wipe loop. Add an explicit "Never delete" list: `/nav`, `/footer`, `/index`, `content/`, `drafts/`, `tools/`, any `blocks/<name>/` other than `blocks/of1/`.
- [ ] **Step 2:** §6 → only edit when a line matches `^of1/?$` or `^of1/config`; otherwise print `✓ .hlxignore does not block of1/config`.
- [ ] **Step 3:** §7 → stop writing `of1-endpoint.json`; write `of1/config/config.json` = `{ "domain": "${DOMAIN}" }`; commit only that file. Remove the `knowledgeMode`/`contentIngestion` paragraph; replace with one line: "content ingestion uses the worker default `/of1/knowledge/**`; add `contentIngestion` here only to override."
- [ ] **Step 4:** §8 → keep create-if-absent; replace the "exists but doesn't mention" branch text with "warn only — never edit a customer's helix-query.yaml".
- [ ] **Step 5: Verify:** `grep -n "rm -rf\|of1-endpoint\|knowledgeMode\|DELETE" skills/of1-check-dependencies/SKILL.md` → only the scoped Restart DELETE under `/of1`, `/templates`.
- [ ] **Step 6: Commit** `fix(of1-check-dependencies)!: restart deletes only OF1-owned paths; trim config.json`

### Task 3: Content track — brand voice doc, personas sheet, knowledge pages to state

**Files:**
- Modify: `skills/of1-extract-brand-voice/SKILL.md` (L9, L26-29, L114-132, completion)
- Modify: `skills/of1-extract-content/SKILL.md` (L9, L42, L50, L132-144, L154-336 step 7-9, L338-375, completion L385-403)
- Modify: `skills/of1-extract-content/assets/build-image-manifest.mjs:7,33,43`, `publish-knowledge-da.mjs:7,11,137,176,179` (default input `$OF1_STATE_DIR/knowledge-pages.json`; flag `--pages <file>` replaces `--config-dir`) + their tests
- Delete: `skills/of1-extract-content/assets/publish-config-da.mjs`

- [ ] **Step 1: Failing tests:** in `publish-knowledge-da.test.mjs` / `build-image-manifest.test.mjs`, `parseArgs(["--pages","/tmp/x.json"])` yields `pages:"/tmp/x.json"`; default `pages` = `${process.env.OF1_STATE_DIR}/knowledge-pages.json` (export `parseArgs` if needed). Run `node --test …` → FAIL; implement; → PASS.
- [ ] **Step 2: brand voice SKILL.md:** output = `$OF1_STATE_DIR/brand-voice.html` with `<body><header></header><main><div><h2>Personality</h2><p>…</p><h2>Tone</h2><p>…</p><h2>Words we use</h2><ul>…</ul><h2>Words we avoid</h2><ul>…</ul></div></main><footer></footer></body>`, then `node "$SKILL_DIR/../of1-integration/assets/da-write.mjs" doc --path of1/brand-voice --file …`. Standalone mode: if `https://${PREVIEW}/of1/brand-voice.plain.html` already returns 200, ask before overwriting. Drop `sentenceStyle`/`toneByContext`. Remove `mkdir of1/config`.
- [ ] **Step 3: extract-content SKILL.md:** page capture appends to `$OF1_STATE_DIR/knowledge-pages.json`; delete step 7 `knowledge.json`, step 8 cross-reference, step 9 (images/≥4 gate/verify script); keep step 10 (image rehost + publish) pointed at `--pages "$OF1_STATE_DIR/knowledge-pages.json"`. New step "Write personas sheet": rows as JSON to `$OF1_STATE_DIR/personas-rows.json`, then `da-write.mjs sheet --path of1/config/personas --columns id,name,description,keywords,priorities,explore,research,compare,purchase,deals,support --rows …`; rule: no commas inside a keyword/priority. Completion checklist: knowledge pages published + personas sheet previewed.
- [ ] **Step 4: Verify:** `grep -rn "knowledge.json\|of1/config/personas.json\|publish-config-da\|download-images.mjs.*--update-products" skills/of1-extract-*` → no hits.
- [ ] **Step 5: Commit** `feat(content-track)!: brand voice + personas to DA, knowledge pages via state`

### Task 4: Quick suggestions → DA sheet + landing copy

**Files:**
- Modify: `skills/of1-build-quick-suggestions/SKILL.md` (L9-50 inputs, L54-97)

- [ ] **Step 1:** Inputs: `$OF1_STATE_DIR/knowledge-pages.json` titles/headings (ground truth for chip subjects), personas rows, `/of1/brand-voice.plain.html` (or the state HTML). Remove all `of1/config/*.json` reads and `knowledge.json` jq.
- [ ] **Step 2:** Outputs: chips → `$OF1_STATE_DIR/suggestions-rows.json` → `da-write.mjs sheet --path of1/config/suggestions --columns label,query`; landing copy → `$OF1_STATE_DIR/of1-landing.json` = `{ "title", "subtitle", "placeholder" }`. Drop the `type` field and its paragraph; keep the 5-intent spread guidance.
- [ ] **Step 3: Verify:** `grep -n "of1/config/\|knowledge.json\|\"type\"" skills/of1-build-quick-suggestions/SKILL.md` → only the DA sheet path.
- [ ] **Step 4: Commit** `feat(of1-build-quick-suggestions)!: chips as DA sheet, landing copy via state`

### Task 5: `/of1` page rows, templates without templates.json

**Files:**
- Modify: `skills/of1-style-generative-block/SKILL.md` Step 5 (L144-178)
- Modify: `skills/of1-build-templates/SKILL.md` (L1-19 deliverables, L62-64, L175, L271-327 assemble, L334-341)

- [ ] **Step 1:** style-generative-block: `ENGINE="da-blocks-slots"` literal; read `TITLE/SUBTITLE/PLACEHOLDER` from `$OF1_STATE_DIR/of1-landing.json` (`jq -r '.title // empty'`), append a `<tr>` per non-empty value after the `engine` row. Document that authors edit these rows in DA. If `of1-landing.json` is absent (suggestions not done yet in pipeline ordering), omit the rows — the SDK defaults apply.
- [ ] **Step 2:** build-templates: use cases from `$OF1_STATE_DIR/knowledge-pages.json` + discovery; assemble step 4 → delete the `templates.json` write/commit; deliverables list drops it; note "the worker defaults to da-blocks-slots + /templates".
- [ ] **Step 3: Verify:** `grep -rn "templates.json\|knowledge.json" skills/of1-style-generative-block skills/of1-build-templates` → no hits.
- [ ] **Step 4: Commit** `feat(templates,of1-page)!: drop templates.json; landing copy rows on /of1 block`

### Task 6: `of1-integration` graph, `of1-publish`, demo hub

**Files:**
- Modify: `skills/of1-integration/SKILL.md` (graph L67-107, pipeline timing L111-140, Config review L170-190 → delete, Deploy L192-196, re-sync L198-200)
- Delete: `skills/of1-integration/assets/config-review.html`
- Rewrite: `skills/of1-integration/knowledge/worker-config-schemas.md` (sections per spec: `config.json`, `cta-template.json` (pipeline only), DA `/of1/brand-voice`, DA sheets personas/suggestions, `/of1` block rows, `/of1/strategy`, `/templates`, `/of1/knowledge/**`, new ready gate; delete eliminated sections)
- Modify: `skills/of1-integration/knowledge/da-sync-app.md` (L3, L31-33 remove the false "of1-labs installs it automatically" claim; L37, L45 new file list)
- Modify: `skills/of1-publish/SKILL.md` (L51-60, Process 1-7, checklist), `skills/of1-publish/assets/fill-demo-hub.mjs`, `skills/of1-publish/assets/demo-hub.html`
- Create: `skills/of1-publish/assets/fill-demo-hub.test.mjs`
- Modify: `README.md` (skills table, remove "15 templates")

**Interfaces:**
- `fill-demo-hub.mjs` exports `renderConfigLinks({owner, repo, previewBase}) : string`, `renderStatusPanel({statuses: object[], sync: object|null, status: object|null}) : string`, `buildHub({repoConfig, domain, stateDir, repoDir, template}) : string`; CLI guarded; reads staged files from `$OF1_STATE_DIR/hub/`: `sync.json`, `status.json`, `da-templates.txt`, `da-pages.txt`, `da-knowledge.txt`, plus `$OF1_STATE_DIR/of1-*-status.json`.

- [ ] **Step 1: Failing tests** (`fill-demo-hub.test.mjs`): `renderConfigLinks({owner:"o",repo:"r",previewBase:"https://b--r--o.aem.page"})` contains `https://da.live/edit#/o/r/of1/brand-voice`, `https://da.live/sheet#/o/r/of1/config/personas`, `https://da.live/sheet#/o/r/of1/config/suggestions`, `https://da.live/#/o/r/templates`, `https://da.live/#/o/r/of1/knowledge`; `renderStatusPanel({statuses:[{skill:"of1-extract-content",status:"failed",summary:"x"}],sync:{ok:true,synced:["config"],errors:[{file:"brand-voice",error:"empty document"}],content:{indexed:0}},status:{ready:false,config:{hasTemplates:true,hasContent:false}}})` contains `of1-extract-content`, `failed`, `empty document`, `indexed: 0`, `hasContent`; `buildHub` output contains no `of1/config/knowledge.json` / `config-review.html`.
- [ ] **Step 2:** `node --test skills/of1-publish/assets/fill-demo-hub.test.mjs` → FAIL.
- [ ] **Step 3: Implement** fill-demo-hub refactor + `demo-hub.html` (remove L52 config-review link and L64-69 JSON links; add `{{CONFIG_LINKS}}`, `{{STATUS_PANEL}}`; drop `{{NUM_PRODUCTS}}`).
- [ ] **Step 4:** `of1-integration/SKILL.md`: graph without `config-review`; `of1-build-cta-template` node marked **pipeline mode only** (`OF1_PIPELINE_MODE=1`) in the graph, Trigger table and "Pipeline-mode timing"; `of1-publish` waits for `of1-build-templates`(assemble) + `of1-style-generative-block` + `of1-build-quick-suggestions` (+ `of1-build-cta-template` in pipeline mode). Delete the Config review section.
- [ ] **Step 5:** `of1-publish/SKILL.md` Process: (1) assert git config set: `git ls-files of1/config` ⊆ `{of1/config/config.json}` (+ `cta-template.json` when `OF1_PIPELINE_MODE=1`), else FAIL listing extras; (2) sync, save response to `$OF1_STATE_DIR/hub/sync.json`; (3) status → `hub/status.json`; (4) DA listings → `hub/da-{pages,templates,knowledge}.txt`; (5) `fill-demo-hub.mjs`; (6) `git add of1/config/config.json deliverables/index.html` (+ cta in pipeline mode) commit/push. Replace the 6 checks with the spec's 7 checks (verbatim list in spec § `of1-publish` checks). Remove image and catalog checks, `knowledge-pages.json` repo read (use state path).
- [ ] **Step 6: Verify:** `node --test skills/**/assets/*.test.mjs` all PASS; `grep -rn "config-review\|knowledge.json\|of1-endpoint\|templates.json\|personas.json\|suggestions.json\|brand-voice.json" skills README.md` → hits only in `worker-config-schemas.md` "removed in 2026-10" note (if any) and `of1-build-cta-template` (cta).
- [ ] **Step 7: Commit** `feat(of1-integration,of1-publish)!: DA-first graph, publish checks, hub with DA links + status panel`

### Task 7: End-to-end acceptance (dev worker)

- [ ] **Step 1:** Prereq: Plan 2 deployed to dev (`OF1_GENWEB_URL=<dev worker>`), Plan 1 merged.
- [ ] **Step 2:** Scratch EDS repo (clean boilerplate + one content page), standalone `/of1-integration`.
- [ ] **Step 3: Assert:** `git log -p --name-only <start>..HEAD | grep -v '^commit'` paths ⊆ allowed set (Global Constraints); `admin.da.live/list` shows no deletions outside `/of1`, `/templates`; `/status` `ready:true`; `/of1` shows authored title + ≥1 chip; generate ≥2 sections; personalize returns mutations; hub at `deliverables/index.html` shows DA links + green status panel.
- [ ] **Step 4:** Re-run once in pipeline mode (`OF1_PIPELINE_MODE=1`) → additionally `of1/config/cta-template.json` committed and personalize streams `inject_cta`.
- [ ] **Step 5:** Record results in the PR description; push; open PR `feat!: DA-first OF1 config`.
