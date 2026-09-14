# of1-build-templates → da-blocks-slots Migration — Spec

**Date:** 2026-08-31
**Author:** Florian Froese
**Status:** Draft — pending review
**Repos touched:** `of1-skills` (4 skills), `of1-demo-skills` (conditional — 3 orchestrator docs)
**Repos NOT touched:** `of1-gen-web-service` (da-blocks-slots engine already merged to main)

## Goal

Replace today's `of1-build-templates` — which generates 15 standalone slot-based HTML
templates with invented `of1-*` classes and per-template CSS — with a producer that authors
**DA block templates for the `da-blocks-slots` worker engine**: real EDS documents in a
tenant's `/templates` DA folder, composed from the tenant's EDS blocks
(`columns`, `cards`, `hero`, `spotlight`, …) — reusing existing blocks first, authoring new
**general-purpose** blocks only where genuinely useful — filled with realistic example content.
DA is the source of truth; the worker syncs, selects one per request, and asks the LLM for
content-only slot values it splices into the authored skeleton.

## Background — where blocks actually come from

A key correction that reshapes this migration:

- **The old `of1-build-templates` does NOT compose real EDS blocks.** It emits standalone
  slot-HTML with its own invented classes (`of1-cmp-grid`, `of1-hero`) plus per-template CSS
  (`styles/of1-{name}.css` importing `styles/of1-template-base.css`). Prototypes and
  `DESIGN.json` are read only as a *visual* reference. The output is a parallel HTML system,
  not the site's blocks.
- **Real EDS blocks are generated upstream in Stage 2c**, by `of1-deploy` → `stardust:deploy`
  ("one EDS block per distinct prototype pattern" → `blocks/columns/columns.js`,
  `blocks/cards/cards.js`, `styles/styles.css`, …). The prototype+snowflake pipeline does the
  equivalent via `of1-snowflake`.
- **da-blocks-slots consumes those Stage-2 blocks.** The producer's `inventory` mode reads
  `blocks/*` directly. Templates become compositions of blocks that already exist — nothing in
  Stage 3 generates `columns`/`cards`; they are present by the time templates run.

**Consequence — Stage 2 is the reuse baseline, and its block set is a starting point, not a
ceiling.** `of1-build-templates` reads the tenant repo's `blocks/*` to know what is available to
reuse. The pipeline already gates the Stage-3 site-track on `OF1_STAGE2_DONE_FILE`, so the
baseline exists by the time templates run. Two direct effects:

1. **Thin vocabulary is no longer a hard constraint — it is solved by authoring new *general*
   blocks (see Block Strategy).** Measured per design doc Risk 4: `of1-af1bb1a3` has 16 usable
   blocks; the two minimal demos have 3 (`hero`, `cards`, `columns`). Where existing blocks +
   variants can't express an intent's template well, the producer may author a **new,
   general-purpose** block (e.g. `product-cards`, `comparison-grid`) — never a slot-specific,
   single-template block. Reuse is preferred; invention is the fallback, bounded by generality.
2. **`inventory` must confirm positional.** Non-positional/label-value blocks (the snowflake
   overlay engine's `readBlockSlots` convention: `cells[0]`=name, `cells[1]`=value) must be
   excluded from the reuse set — mixing them silently decorates into the wrong shape. Any new
   block authored here must itself be positional. Keep this gate hard.

## Block Strategy (use-cases first, reuse-first, general-only)

This is the core methodology of the new skill and its most important guardrail.

**Deviation from the da-blocks design doc (intentional):** design doc decision 6 ("only blocks
present in the site's `blocks/` directory may appear in a template; no invented block names") is
**relaxed** here. New blocks are permitted — but only general-purpose, reusable ones, committed as
real positional EDS blocks. The spirit of decision 6 (no bespoke per-template block soup) is
preserved by the generality rule below; only its "never invent" letter is loosened.

**Order of reasoning:**
1. **Figure out the use cases first** — from the discovery narrative + extracted content
   (personas, use cases, products, FAQs). These are what the generative-search experience must
   actually answer.
2. **Derive intents from the use cases** (`comparison`, `recommendation`, `deep-dive`, `budget`,
   `discovery`) — each intent needs one or more template shapes.
3. **For each intent's template needs, choose the block palette in this priority order:**
   - **Reuse an existing block** from the tenant's `blocks/*` (Stage-2 output) — first choice
     whenever an existing block, possibly with a single-hyphen **variant** or the
     `no-static-labels`/`key-value` knob, can express the shape.
   - **Author a new *general-purpose* block** only when reuse genuinely can't express the shape
     *and* the new block is a broadly reusable pattern — e.g. `product-cards`, `comparison-grid`,
     `feature-list`, `stat-row`. It must be usable across multiple templates/intents and other
     sites, positional, with real `blocks/<name>/<name>.{js,css}`.
4. **Build the DA example templates** (the da-blocks-slots authored-template contract) composing
   the chosen blocks with realistic example content.

**CRITICAL RULE — blocks stay general; never slot-specific.** The failure mode this migration
exists to kill is the old system's bespoke per-template markup (`of1-comparison-table` with its
own `of1-cmp-grid` classes and per-template CSS). A new block is only justified if it is a general
pattern a marketer would recognize and reuse — `product-cards` is fine; a
`comparison-hero-with-three-fixed-tiers` block is not. Generality and reusability over
template-specific convenience, always. When in doubt, reuse an existing block with a variant
rather than invent.

**Ordering dependency introduced by new blocks:** a newly authored block's code lives on the
**code bus** (git → aem.live), while the DA template that references it lives on the **content
bus** (DA → `.plain.html`). The block's `.js`/`.css` must be committed, pushed, and picked up by
code sync **before** the DA template that uses it is previewed — otherwise the template composes a
class that has no decorator and renders undecorated (silent failure, "styles just don't work").
So new-block authoring is a distinct sub-step that gates the compose/preview of any template that
uses it. Templates composed purely of reused, already-deployed blocks have no such wait.

## The da-blocks-slots authored-template contract (verified against worker source)

The authored DA doc is **byte-identical in shape** to the `da-blocks` engine's — both engines
read the same docs; the difference is worker-side only (`da-blocks` re-emits markup, `da-blocks-slots`
splices content values into the authored skeleton). What the producer must satisfy
(`materialize-da-templates.js`, `block-tree.js`, `slot-address.js`, `slot-splice.js`,
`prompts/block-slot-fill/template.njk`):

- **Composition:** real EDS doc at `/templates/<name>`, built from the tenant's own `blocks/*`,
  positional rows, filled with realistic example content. Body wrapped
  `<body><header></header><main><div>…</div></main><footer></footer></body>`.
- **No slot schema, no `data-slot` attributes.** Slots are addressed structurally
  (`s{S}-b{B}-r{R}-c{C}`), derived by the worker at sync time.
- **Cell roles are auto-detected** (`slot-address.js` `roleOf`): `image` (`<picture>`/`<img>`),
  `link` (whole-cell `<a>`), `html` (a cell with >1 block-level element — heading + paragraph),
  `text` (default), `static` (empty/icon-only — never filled). The example content the producer
  authors determines the role, so it must be representative.
- **Label/value rows auto-detected:** 2–3 cells, cell 0 short plain text (≤4 words, no
  image/link), pattern repeats across ≥2 rows. Cell 0 stays static (kept verbatim, never sent to
  the LLM). Two variant knobs give the author control: `no-static-labels` forces every cell
  dynamic; `key-value` lowers the repeat threshold to 1 row.
- **Section metadata carries routing/selection data:** a `section-metadata` block with keys
  `Template Intent`, `Template Description`, `Template Min Items`, `Template Max Items`
  (→ `data-template-*` on the section). **No commas in values** (markdown intermediate drops the
  following space).
- **Enumeration:** worker reads `/query-index.json` filtered to the `/templates/` prefix
  (fallback: explicit `cfg.templates` list). The tenant config is
  `of1/config/templates.json = { "engine": "da-blocks-slots", "daPath": "/templates" }`.
- **Preview is MANDATORY.** A DA doc that was never previewed has no `.plain.html`, so the worker
  syncs zero templates. Preview needs AEM write authorization — a **separate grant from DA
  write**, with a known org-level 403 gap on `of1-labs` (design doc Verification Results). Fail
  loud on 403; never report success after a DA write that never became visible.
- **Markdown-intermediate caveats:** single-hyphen variant class names only (`variant-double`,
  never `variant--double`); positional rows only, never the snowflake label/value convention.

## Scope & Boundaries

### CSS ownership — the crux (fundamentally shifted by da-blocks-slots)

The old template-routing flow injected a per-template stylesheet at runtime, which
`of1-build-templates` authored (`styles/of1-{name}.css` + `of1-template-base.css`). **da-blocks-slots
has no runtime-injected stylesheet** — `llm-fill-block-slots.js` emits `stylesheet: null`; generated
sections are real EDS blocks decorated by the client's own `decorate()` pipeline, so their CSS comes
from the **code bus** (`blocks/<name>/<name>.css`). The ownership matrix becomes:

| CSS | Owner | Bus |
|---|---|---|
| OF1 shell/chrome UI (search landing, skeleton, streamed-section container, suggestion chips) | `of1-style-generative-block` (`blocks/of1/of1.css`) | code |
| **Reused** block's section styling | already exists from Stage 2 (`blocks/<name>/<name>.css`) — **nobody re-authors in Stage 3** | code |
| **New** block's section styling | `of1-build-templates` authors it with the block (`blocks/<name>/<name>.css`) | code |
| Per-template stylesheet | **deleted** — no longer exists | — |

Two hard rules fall out: `of1-build-templates` **must not restyle existing (reused) blocks**, and it
**must not touch `blocks/of1/of1.css`** (that's `of1-style-generative-block`'s, CRITICAL RULE 1).
No double-authoring: the two skills own disjoint files.

**Doc bug this exposes (fix in this migration):** `of1-style-generative-block`'s SKILL.md still says
*"the per-section visual design of generated content is owned by each template's own stylesheet
(produced by of1-build-templates and injected by the OF1 client SDK at runtime)."* That is now false
for da-blocks-slots — section CSS is code-bus block CSS, not runtime-injected. Update that sentence to
point at `blocks/<name>/<name>.css` and note `stylesheet: null`.

### generative-images / generative-fragments — NOT owned here

`select-images` + `select-fragments` in the da-blocks-slots flow are **worker-side RAG selection**
(cosine over the tenant's pre-embedded `generative-images.json` / `generative-fragments.json`, synced
+ embedded at sync time; landed 2026-08-26 / 2026-08-28, newer than every current skill). They write
`ctx.rag.images` / `ctx.rag.fragments`, which feed the slot-fill LLM. `of1-build-templates` does **not**
own these:

- It authors **representative image-role cells** (`<img>`/`<picture>` example content) so `roleOf`
  tags them `image` and the worker+LLM can swap in a real selected image URL. That is its only
  image-related obligation.
- The **config producers** for `of1/config/generative-images.json` / `generative-fragments.json` do
  not yet exist in `of1-skills` (the worker features postdate the skills). Building them is a
  **separate, out-of-scope** concern — do not fold it into this migration.

### of1-build-templates ↔ Stage 2 (of1-deploy / of1-snowflake)

Stage 2 generates the block baseline from prototype sections. `of1-build-templates` reads that
baseline, reuses first, and only **adds** new general blocks under disjoint names. It never modifies
or restyles a Stage-2 block. Both commit into `blocks/`, but their file sets are disjoint.

## Repos & skills that change

### of1-gen-web-service — ZERO change
The `da-blocks-slots` engine is already on main (`flows.js` `DA_BLOCK_SLOTS_FLOW`,
`materialize-da-templates.js`, `slot-address.js`, `slot-splice.js`, `prompts/block-slot-fill`).
This migration is producer-only.

### of1-skills — the work (5 skills)

**1. `of1-build-templates` — rewrite (largest change).**
- Replace the entire slot-HTML contract (`data-slot`, `metadata.json`, `sample.json`, catalog,
  gallery, base CSS, per-template CSS) with the da-blocks-slots authored-template contract above.
- Port engine-agnostic assets from the unmerged `of1-da-template-authoring` skill (in
  `of1-demo-skills` branch `feat/of1-da-template-authoring-skill`): `assets/da-api.sh`
  (`da_put`/`da_delete`/`da_list`/`aem_preview`) and `assets/inventory.sh` — verbatim.
- New per-phase logic (see phase decision D1 below for names):
  - **harvest** (run once): determine use cases (from discovery narrative + extracted content) →
    intents → per-intent template needs. `inventory.sh` → usable positional block list + live
    `.plain.html` per-block row/cell fingerprints + real example content. Produce a **block plan**
    per intent: which existing blocks/variants to reuse, and where a new *general* block is
    genuinely warranted (Block Strategy). Adapt template count to the (baseline + planned) block
    vocabulary — don't blindly target 15.
  - **new-block authoring** (conditional, gates any template that uses a new block): write
    positional `blocks/<name>/<name>.{js,css}` for each planned new **general** block; commit,
    push, wait for code sync so the decorator is live before its templates preview. Skipped
    entirely when every intent is covered by reuse.
  - **intent-\*** (parallel, one per intent): compose that intent's template docs from the block
    plan (reused + newly deployed blocks), filled with realistic content; author roles correctly
    (multi-element intros as `html`-role cells, label columns as label/value rows,
    `no-static-labels`/`key-value` variants where needed); `section-metadata` carrying
    intent/description/min/max; `da_put` each to `/templates/<name>`.
  - **assemble** (run once): `aem_preview` every composed doc (MANDATORY, fail loud on 403);
    verify round-trip `.plain.html` 200 + row/cell counts match authored; write
    `of1/config/templates.json = { engine: "da-blocks-slots", daPath: "/templates" }` (git-committed).
- DELETE assets: `assemble-catalog.mjs`, `fill-template.mjs`, `gallery.html`. No git commit of
  template HTML (DA is source of truth); `templates.json` and any **new block** `blocks/<name>/*`
  are still committed.
- Update SKILL frontmatter description (drop "15 slot-based HTML templates").

**2. `of1-publish` — deliverable + config surgery.**
- Check 4: drop the hard-require of `templates/templates-catalog.json`; replace with a check that
  `of1/config/templates.json` has `engine: "da-blocks-slots"` and the DA `/templates` list is
  non-empty.
- Check 5: drop `gallery/index.html` from the deliverable 200-checks (no gallery exists).
- `assets/fill-demo-hub.mjs` + SKILL: add DA template edit links
  (`da.live/edit#/{org}/{repo}/templates/{name}`) to the demo hub — the **"show authoring"**
  showcase, near-free since `da_put` already returns `editUrl`.
- If the `templates.json` write moves fully into `of1-build-templates(assemble)`, remove any
  duplicate write here.

**3. `of1-style-generative-block` — one doc-line fix (no behavior change).**
- Correct the "Why this skill exists" sentence that claims section CSS is a per-template stylesheet
  injected by the SDK at runtime — for da-blocks-slots it is code-bus `blocks/<name>/<name>.css`,
  `stylesheet: null`. The skill's actual scope (`blocks/of1/of1.css` only) is unchanged and stays
  correct. Purely a doc-accuracy fix; keep it in this migration so the boundary isn't left stated
  wrong.

**4. `of1-check-dependencies` — add an AEM preview probe.**
- Today only GETs branch preview via `aem.page`. Add a probe against
  `admin.hlx.page/preview/{org}/{repo}/main/<probe>` (or a status GET) asserting NOT 403 —
  preview is now mandatory and there is a known org-level 403 gap. Fail early with the exact
  provisioning diagnostic. `DA_TOKEN` derivation already exists here; verify whether the same IMS
  token carries AEM preview scope or a separate `AEM_TOKEN` grant is required.
- `REQUIRED_SKILLS` array unchanged (skill name stays `of1-build-templates`).

**5. `of1-integration` — step graph.**
- D1 = keep phases: only the prose describing what `of1-build-templates` produces needs a wording
  update (DA docs, not git HTML/gallery). Trigger table + ASCII graph unchanged.
- D1 = rename phases: rewrite the ASCII graph + trigger table phase names.

### of1-demo-skills — conditional
- D1 = keep the `base/intent-*/assemble` phase shape → **no change.**
- D1 = rename phases → update `of1-demo-orchestrator/knowledge/dispatch-cc.md`,
  `dispatch-slicc.md` (incl. the `of1-build-templates*` case-match), `pipeline-contract.md`.
- The unmerged `of1-da-template-authoring` skill/branch: do NOT merge as a separate skill —
  cannibalize its assets into `of1-skills/of1-build-templates`, then abandon the branch.

## Decisions (locked)

- **D1 — LOCKED: keep the `base/intent-*/assemble` phase interface**, fold new-block authoring into
  `base`. of1-demo-skills needs no change.
- **Generative images/fragments config producers — LOCKED: out of scope, separate follow-up PR.**

**D1 — keep the `base/intent×5/assemble` phase interface, or replace it with
inventory/harvest/compose/preview?**

- **Recommend: keep the skill name `of1-build-templates` and remap the three phases**:
  `base` (run once: use-cases → intents → block plan + inventory/harvest + **new-block authoring**
  when the plan warrants it — the git/code-sync wait lives here, before any intent composes) →
  `intent-*` (parallel: compose that intent's docs to DA) → `assemble` (preview + verify + write
  `templates.json`). This preserves the of1-integration trigger table AND the of1-demo-skills
  dispatch docs' phase-name pattern, so **of1-demo-skills needs no change** — the cheapest path.
  New-block authoring folds into `base` so the code-bus deploy completes before the intent
  fan-out, satisfying the code-before-content ordering dependency without adding a phase.
- Alternative (rename/add phases, e.g. plan/author-blocks/compose/preview): cleaner semantics but
  forces edits to of1-integration + 3 of1-demo-skills docs, for no functional gain.

## Order of work

1. Lock D1 (recommend: keep phases; fold new-block authoring into `base`).
2. Rewrite `of1-build-templates` + port `da-api.sh` / `inventory.sh`; add use-case→intent→block
   plan, reuse-first/general-only new-block authoring (positional, committed, code-sync wait), and
   the positional gate.
3. `of1-style-generative-block` — one-line doc fix (section CSS is code-bus, not runtime-injected).
4. `of1-check-dependencies` AEM preview probe.
5. `of1-publish` deliverable/config changes + demo-hub editUrl showcase.
6. `of1-integration` prose (+ graph if D1 = rename).
7. of1-demo-skills docs (only if D1 = rename).
8. E2E test against a real multi-block tenant (`of1-af1bb1a3` — 16 usable blocks, best coverage).

## Out of scope

- Any change to `of1-gen-web-service` (engine exists).
- The `da-blocks` (markup re-emit) engine — this migration targets `da-blocks-slots` only.
- Migrating the existing git-committed slot templates into DA (they coexist additively; the old
  `TEMPLATE_ROUTING_FLOW` is untouched for tenants still on `useRouting`).
