# DA-first config — Plan 1/4: consumer adapters (extension + labs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every consumer of `/of1/config/personas.json` accept the DA-sheet shape (and still the legacy array) before the producers switch, so nothing breaks during rollout.

**Architecture:** One pure normalizer per repo turns `{data:[row…]}` / multi-sheet / legacy array into `Persona[]`. The extension also seeds a usable profile when a persona has no `recommendedProducts` (DA personas never do). Ships first; both shapes keep working.

**Tech Stack:** TypeScript, vitest (extension: `npm test`; labs: `npm test` at root → `service` vitest), Biome.

**Spec:** `of1-skills/docs/superpowers/specs/2026-10-05-da-first-config-design.md`

## Global Constraints

- Personas DA sheet columns (verbatim from spec): `id | name | description | keywords | priorities | explore | research | compare | purchase | deals | support`. `keywords`/`priorities` are comma-separated; the six intent columns are numbers 0–1. `recommendedProducts` is dropped.
- DA sheet cells arrive as **strings** (`"0.8"`, `""`). Empty cells must not produce keys.
- Legacy array `personas.json` must keep working unchanged.
- Extension CI gate: `biome check .`, `npx tsc --noEmit`, `npm test` all green. Labs: `biome check .`, `npm test`, `node scripts/complexity.js --threshold=20`.
- Each repo: work on a new branch `feat/da-sheet-personas` off its default branch; one PR per repo.

## Review Focus

- Sheet with a `shared-` prefixed tab or a multi-sheet payload (`{":type":"multi-sheet",":names":[…]}`) → personas still load (first named sheet).
- Intent cell `"0.85 "` (whitespace) or `"abc"` → `"0.85"` parsed, `"abc"` dropped, never `NaN` in `intentProfile`.
- Row with empty `name` → skipped (a persona without a name breaks the picker UI).
- Keywords cell `"zero sugar, diet ,"` → `["zero sugar","diet"]` (trimmed, empties removed).
- Persona with neither `recommendedProducts` nor `keywords` → profile still has `persona` + `personaIntentSignals`, no throw.

---

### Task 1: Extension — normalize sheet-shaped personas

**Files:**
- Create: `of1-preview-extension/src/core/persona-sheet.ts`
- Modify: `of1-preview-extension/src/core/persona-config.ts:14-34`
- Test: `of1-preview-extension/tests/core/persona-sheet.test.ts`, `tests/core/persona-config.test.ts`

**Interfaces:**
- Produces: `export function normalizePersonas(data: unknown): Persona[] | null` — legacy array → returned as-is (filtered to objects with a `name`); `{data:[…]}` → rows mapped; multi-sheet → rows of the first name in `":names"`; anything else → `null`.
- Produces: `export function personaFromRow(row: Record<string, unknown>): Persona | null`.

- [ ] **Step 1: Write failing tests** in `persona-sheet.test.ts`:
  - `personaFromRow({id:"zs",name:"Zero Sugar",description:"d",keywords:"zero sugar, diet ,",priorities:"labels",explore:"0.2",research:"0.9 ",compare:"",purchase:"abc",deals:"0",support:"1"})` → `{id:"zs",name:"Zero Sugar",description:"d",keywords:["zero sugar","diet"],priorities:["labels"],intentProfile:{explore:0.2,research:0.9,deals:0,support:1}}` (no `compare`, no `purchase`, no `recommendedProducts`).
  - `personaFromRow({name:""})` → `null`.
  - `normalizePersonas({data:[{name:"A"},{name:""}],":type":"sheet"})` → one persona `A`.
  - `normalizePersonas({":type":"multi-sheet",":names":["personas"],personas:{data:[{name:"B"}]}})` → one persona `B`.
  - `normalizePersonas([{name:"Legacy",recommendedProducts:["x"]}])` → returned unchanged.
  - `normalizePersonas({foo:1})` → `null`; `normalizePersonas({data:[]})` → `null`.
- [ ] **Step 2:** `npx vitest run tests/core/persona-sheet.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `persona-sheet.ts` (numbers via `Number(String(v).trim())`, keep only finite values; lists split on `,`, trimmed, empties dropped).
- [ ] **Step 4:** Change `persona-config.ts` so the personas fetch uses `normalizePersonas(await res.json())` instead of `fetchJsonArray`'s `Array.isArray` check (products fetch unchanged). Update `persona-config.test.ts`: the existing case "`personas: null` when personas.json is `{"data":[]}`" stays null; add "loads personas from a DA sheet `{data:[{name:'A'}]}`".
- [ ] **Step 5:** `npm test && npx tsc --noEmit && npx biome check .` → all PASS.
- [ ] **Step 6: Commit** `feat(personas): accept DA-sheet personas.json`

### Task 2: Extension — seed a profile without recommendedProducts

**Files:**
- Modify: `of1-preview-extension/src/core/persona-profile.ts:195-230` (`buildSeedVisitsFromPersona`)
- Test: `of1-preview-extension/tests/core/persona-profile.test.ts`

**Interfaces:**
- Consumes: `Persona` (Task 1 shape). Produces: unchanged `buildPersonaProfile(persona, products, domain, now)` signature.

- [ ] **Step 1: Write failing test** `"seeds interests from keywords when a persona has no recommendedProducts"`: persona `{name:"Zero Sugar Seeker", keywords:["zero sugar","diet","aspartame"], intentProfile:{research:0.9}}`, `products=[]` → `profile.interests.map(i=>i.topic)` equals `["Zero Sugar","Diet","Aspartame"]` (humanized, same order), `profile.pageVisits.length === 3`, `profile.intentProfile` defined.
- [ ] **Step 2: Write test** `"no products and no keywords → empty visits, still tagged"`: `{name:"Bare"}` → `pageVisits.length===0`, `profile.persona.name==="Bare"`, no throw.
- [ ] **Step 3:** run → first test FAILS.
- [ ] **Step 4: Implement:** when `recommendedProducts` is empty, use the first 5 `keywords` as seed visit subjects (path `/of1?q=<encoded keyword>`, same dwell/scroll/click pattern and `focusAreas` as product seeds). Existing product-seed behaviour unchanged.
- [ ] **Step 5:** `npm test && npx tsc --noEmit && npx biome check .` → PASS (existing Coca-Cola fixture tests unchanged).
- [ ] **Step 6: Commit** `feat(personas): seed profile from keywords when no recommended products`; push branch, open PR. Note in PR body: edge-proxy picks this up via the `of1-tracker-release` dispatch on next extension release.

### Task 3: Labs — personas-only config proxy, normalized

**Files:**
- Create: `of1-labs/service/src/lib/persona-sheet.ts` (same normalizer contract as extension Task 1 — copy, do not cross-import repos)
- Modify: `of1-labs/service/src/handlers/experiments-config.ts:9,55-56`
- Modify: `of1-labs/service/src/lib/gym/instances.ts:208-213`
- Test: `of1-labs/service/tests/handlers/experiments-config.test.ts` (new), `service/tests/lib/persona-sheet.test.ts` (new)

**Interfaces:**
- Produces: `normalizePersonas(data: unknown): Persona[] | null` (labs copy); endpoint `GET /api/experiments/:id/config/personas` returns `Persona[]` (array) or 502 `config_unavailable` when null.

- [ ] **Step 1: Failing tests:** `persona-sheet.test.ts` mirrors extension Task 1 assertions. `experiments-config.test.ts` (follow the mocking style of `tests/handlers/experiments-collaborator.test.ts`): `file=products` → 400 `invalid_file` with `allowed:["personas"]`; upstream `{data:[{name:"A"}]}` → 200 body `[{name:"A"}]`; upstream `{foo:1}` → 502 `config_unavailable`.
- [ ] **Step 2:** `cd service && npx vitest run tests/handlers/experiments-config.test.ts tests/lib/persona-sheet.test.ts` → FAIL.
- [ ] **Step 3: Implement:** `ALLOWED_FILES = new Set(["personas"])`; respond `c.json(normalizePersonas(data))` or 502. `tenantEngine`: `return blob?.engine ?? null` (drop the `useRouting → "template-routing"` branch). Fix `docs/api.md:279-281` host to `<branch>--<repo>--<org>`.
- [ ] **Step 4:** `npm test && npx biome check . && node scripts/complexity.js --threshold=20` → PASS.
- [ ] **Step 5: Commit** `feat(experiments-config): personas-only, accept DA-sheet shape`; push, open PR.
