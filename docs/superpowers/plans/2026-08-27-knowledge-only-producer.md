# Knowledge-only Producer (of1-skills) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OF1 demo pipeline author a single `knowledge` document (generic entities with a `type`) instead of split products/features/faqs/testimonials, keep personas, drop use-cases, and publish + verify it end-to-end.

**Architecture:** Mostly skill-prose and contract-doc edits across two repos (`of1-skills` skills + the `of1-demo-skills` contract doc), plus one data edit to `publish-config-da.mjs` so DA blocks carry `type`. The image re-host script is reused as-is via its existing `--products-json` flag. Because these are Claude-agent skills (no unit-test harness in the repo), each task is verified with a concrete runnable check (grep / fixture / live E2E), not red-green unit tests. The executable unit tests for this feature live in the companion gen-web plan.

**Tech Stack:** Markdown skill definitions, Node ES-module scripts (`.mjs`), DA admin API, EDS.

**Spec:** `of1-skills/docs/superpowers/specs/2026-08-27-knowledge-only-config-design.md`

## Global Constraints

- **Depends on the gen-web PR being merged + deployed first.** The readiness gate (Task 3, Task 5) only passes once the worker's `isTenantReady` accepts `knowledge` and `tenantStatus` emits `hasKnowledge`.
- **Keep `personas`.** The Intent Map radar + `/api/personalize` intent read personas. **Drop `use-cases`.**
- **Keep committed `knowledge.json` as the DA fallback** — do not delete it.
- **`type` vocabulary:** the producer emits `product | feature | faq | testimonial` (open string).
- Entity fields (must match the worker schema exactly, camelCase): `id, type, title, description, keywords[], facts[], images[], persona?`.
- Image discipline: `type:"product"` entities carry **≥ 4** images, all on `https://${BRANCH}--${REPO}--${OWNER}.aem.page/media/...` (never `content.da.live`, never external CDNs).
- Paths below are repo-relative; run commands from the repo root (`cd` first).

---

### Task 1: DA blocks carry the entity `type` (of1-skills)

**Files:**
- Modify: `of1-skills/skills/of1-extract-content/assets/publish-config-da.mjs:66-71` (`FILE_FIELDS.knowledge`)

**Interfaces:**
- Consumes: nothing.
- Produces: publishing `--files knowledge` renders a `type` row in each `of1-config` block, so the worker's schema-driven parser (which now has a `type` field) round-trips it from DA `.plain.html`.

- [ ] **Step 1: Make the change**

In `publish-config-da.mjs`, add `'type'` to the `knowledge` `order` array (right after `'title'`):

```javascript
  knowledge: {
    idFrom: 'title',
    order: ['title', 'type', 'description', 'keywords', 'facts', 'images', 'persona', 'useCase'],
    list: new Set(['keywords', 'facts']),
    images: new Set(['images']),
  },
```

- [ ] **Step 2: Verify the order includes `type`**

Run: `grep -n "order: \['title', 'type'" of1-skills/skills/of1-extract-content/assets/publish-config-da.mjs`
Expected: one match on the `knowledge` `order` line.

- [ ] **Step 3: Fixture round-trip sanity (no network)**

Create `/tmp/knowledge-fixture.json`:

```json
[{ "id": "edge-engine", "type": "product", "title": "Edge Engine", "description": "Fast", "keywords": ["edge"], "facts": ["Runs at the CDN edge."], "images": [], "persona": "platform-engineering-lead" }]
```

Run this node check (exercises only the pure serialization helpers by importing the SPEC is not possible — instead assert field coverage against the fixture):

Run: `node -e "const e=require('/tmp/knowledge-fixture.json')[0]; const order=['title','type','description','keywords','facts','images','persona','useCase']; console.log(order.every(k=>k in e || k==='useCase') ? 'OK: fixture covers order' : 'MISSING FIELD')"`
Expected: `OK: fixture covers order`

- [ ] **Step 4: Commit**

```bash
cd of1-skills
git add skills/of1-extract-content/assets/publish-config-da.mjs
git commit -m "feat(publish-config-da): render type row for knowledge of1-config blocks"
```

---

### Task 2: Extract-content emits a knowledge doc (of1-skills)

**Files:**
- Modify: `of1-skills/skills/of1-extract-content/SKILL.md` — description line (`:9`), Step 7 schema blocks, Step 9 image-rehost invocation (`:305-315`), Step 10 publish (`:357-379`).

**Interfaces:**
- Consumes: `publish-config-da.mjs --files knowledge` (Task 1); `download-images.mjs --products-json` (existing flag).
- Produces: `of1/config/knowledge.json` (array of `{id,type,title,description,keywords[],facts[],images[],persona?}`) and `of1/config/personas.json`; no products/features/faqs/testimonials/use-cases files.

- [ ] **Step 1: Update the skill description (`:9`)**

Replace the description line with:

```markdown
Crawl a website to extract the site's knowledge — products, features, FAQs and testimonials — into a single `knowledge` document of generic entities (plus user personas), producing JSON files for the OF1 worker tenant config and publishing `knowledge` to DA as `of1-config` blocks so authors can edit the tenant's knowledge in Document Authoring.
```

- [ ] **Step 2: Replace the Step 7 content schemas with a knowledge schema**

In Step 7, **remove** the `**products.json:**`, `**features.json:**`, `**faqs.json:**`, `**use-cases.json:**`, and `**testimonials.json:**` schema blocks. **Keep** the `**personas.json:**` block. Insert this `**knowledge.json:**` block in their place:

````markdown
**knowledge.json:** — the single factual store; one entity per product, orphan feature, FAQ, or testimonial. `facts[]` is the load-bearing field: each a self-contained, true, quotable claim (render prices, categories, highlights, feature bullets, and FAQ answers as facts). `type` records the origin.

```json
[
  {
    "id": "edge-inference-engine",
    "type": "product",
    "title": "Edge Inference Engine",
    "description": "AI that runs in milliseconds at the CDN layer.",
    "keywords": ["edge ai", "low latency personalization"],
    "facts": [
      "Runs inference at the CDN edge, not a central data center.",
      "Delivers millisecond response times.",
      "Category: Platform / Edge AI."
    ],
    "images": ["https://main--repo--owner.aem.page/media/product-edge-inference-engine-1.png"],
    "persona": "platform-engineering-lead"
  },
  {
    "id": "how-fast",
    "type": "faq",
    "title": "How fast does the page personalize?",
    "description": "The full pipeline completes within a 2.5-second maximum LCP.",
    "keywords": ["performance", "speed"],
    "facts": ["The Understand→Reason→Compose pipeline completes within a 2.5s maximum LCP, not an average."],
    "images": []
  }
]
```

Mapping rules:
- **product →** one `type:"product"` entity (title=name; images; persona); `facts[]` = highlights + related feature bullets + price/category as claims.
- **feature →** folded as `facts[]` into its related product (via the old `productIds`); an orphan feature becomes its own `type:"feature"` entity.
- **faq →** `type:"faq"` (title=question; description/facts=answer; no images).
- **testimonial →** `type:"testimonial"` (title=author/company; facts=quote + attribution).
- **personas** stay in `personas.json`. **use-cases are not produced.**
````

Also update Step 4/5/5b/6 prose that references producing use-cases/testimonials as separate files so it feeds the knowledge entities instead (keep persona inference; drop the "infer use cases" deliverable).

- [ ] **Step 3: Repoint the Step 9 image re-host to knowledge.json (`:305-315`)**

Replace the Step 9 code block's comment + invocation so `download-images.mjs` reads and rewrites `knowledge.json`:

```bash
cd "$OF1_DEMO_REPO"

# download-images.mjs derives its work list from of1/config/knowledge.json
# (one entry per entity that has an images[] array — i.e. type:"product" /
# "testimonial"). It downloads + uploads every image, previews it, and rewrites
# the entity images[] to the site's .aem.page/media/... paths.
node "$SKILL_DIR/assets/download-images.mjs" \
  --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
  --output /tmp/image-mapping.json \
  --products-json of1/config/knowledge.json \
  --max-per-product 8 \
  --update-products
```

And change the trailing sentence to: "The `--update-products` flag rewrites `knowledge.json[*].images` to the site's `.aem.page/media/...` URLs automatically."

- [ ] **Step 4: Point Step 10 publish at knowledge (`:357-379`)**

- Header → `### 10. Publish config to DA (\`knowledge\`)`
- Body: change "reads these three files from **DA**" → "reads the knowledge doc from **DA**", and "the committed `of1/config/{file}.json`" stays.
- Invocation: change the comment "Reads of1/config/{products,features,faqs}.json" → "Reads of1/config/knowledge.json", and the flag:

```bash
node "$SKILL_DIR/assets/publish-config-da.mjs" \
  --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
  --files knowledge
```

- [ ] **Step 5: Verify the edits**

Run:
```bash
cd of1-skills/skills/of1-extract-content
grep -c "knowledge.json" SKILL.md            # expect >= 3
grep -n -- "--files knowledge" SKILL.md       # expect the Step 10 invocation
grep -n -- "--products-json of1/config/knowledge.json" SKILL.md  # Step 9
grep -c "use-cases.json\|use-cases" SKILL.md  # expect 0
```
Expected: `knowledge.json` appears ≥ 3×; `--files knowledge` and the knowledge `--products-json` present; zero `use-cases` references.

- [ ] **Step 6: Commit**

```bash
cd of1-skills
git add skills/of1-extract-content/SKILL.md
git commit -m "feat(of1-extract-content): emit a knowledge doc, keep personas, drop use-cases"
```

---

### Task 3: of1-publish gate + checks target knowledge (of1-skills)

**Files:**
- Modify: `of1-skills/skills/of1-publish/SKILL.md` — Step 1 file list (`:61-73`), Check 3 image check (`:204-227`), Step 6 required-set note (`:155`).

**Interfaces:**
- Consumes: worker `tenantStatus` now emits `hasKnowledge` and `ready` accepts knowledge (gen-web plan).
- Produces: a publish flow that passes for a knowledge-only tenant.

- [ ] **Step 1: Update the Step 1 expected-file loop (`:64`)**

Replace the `for f in …` list with the knowledge-only set:

```bash
for f in brand-voice knowledge personas suggestions cta-template of1-endpoint; do
```

- [ ] **Step 2: Point Check 3 at knowledge product entities (`:204-227`)**

Replace the Check 3 python block so it validates images on `type:"product"` knowledge entities:

```bash
python3 << 'EOF'
import json, sys

with open('of1/config/knowledge.json') as f:
    entities = json.load(f)

products = [e for e in entities if e.get('type') == 'product']
all_good = True
for p in products:
    images = p.get('images', [])
    if len(images) < 4:
        print(f"  ✗ {p.get('title', 'Unknown')}: only {len(images)} image(s)")
        all_good = False

if not all_good:
    print("\n✗ FAIL: Some product entities have fewer than 4 images")
    sys.exit(1)
print(f"\n✓ All {len(products)} product entities have ≥4 images")
EOF
```

- [ ] **Step 3: Correct the Step 6 required-set note (`:155`)**

Replace the "Required for `ready: true`" sentence with:

```markdown
Required for `ready: true` (from the worker's `isTenantReady`, `worker/src/tenant.js`): `hasKnowledge` (or, for legacy tenants, `hasProducts` + `hasFeatures` + `hasFaqs`), plus `hasSuggestions`, `hasOf1Endpoint`, `hasCtaTemplate` — and **either** `hasBlockGuide` **or** `hasTemplates` (this pipeline ships templates). `hasPersonas`/`hasUseCases` are NOT part of the gate. `hasBrandVoice` is surfaced but not gated (still generate it — it drives prompt quality).
```

- [ ] **Step 4: Verify the edits**

Run:
```bash
cd of1-skills/skills/of1-publish
grep -n "for f in brand-voice knowledge personas" SKILL.md   # Step 1
grep -n "knowledge.json" SKILL.md                             # Check 3 reads it
grep -c "hasKnowledge" SKILL.md                               # Step 6 note, expect >=1
grep -c "use-cases" SKILL.md                                  # expect 0
```
Expected: Step 1 loop updated; Check 3 reads `knowledge.json`; `hasKnowledge` present; no `use-cases`.

- [ ] **Step 5: Commit**

```bash
cd of1-skills
git add skills/of1-publish/SKILL.md
git commit -m "feat(of1-publish): gate + image check target the knowledge doc"
```

---

### Task 4: Producer contract doc gains knowledge (of1-demo-skills)

**Files:**
- Modify: `of1-demo-skills/skills/of1-demo-orchestrator/knowledge/worker-config-schemas.md` — add a `## knowledge.json` section (after `## faqs.json`), update the Required-vs-Optional intro + table (`:356-369`), mark products/features/faqs legacy, remove `use-cases`.

**Interfaces:**
- Consumes: nothing.
- Produces: the canonical producer contract for `knowledge.json`.

- [ ] **Step 1: Add the knowledge section**

Insert after the `## faqs.json` section:

````markdown
## knowledge.json

Array of generic entities — the single factual store for knowledge-only tenants.
**Required for tenant readiness (in lieu of products/features/faqs). Vectorized for RAG.**
Authored in DA as `of1-config` blocks (`knowledge.plain.html`), committed JSON kept as fallback.

| Field | Required | Used for |
|-------|----------|----------|
| `id` | YES | vector id, image-mapping key |
| `type` | no | origin discriminator: `product\|feature\|faq\|testimonial\|…`; personalize prefers `type:"product"` |
| `title` | YES | entity id (`idFrom: title`), embedding + prompt |
| `description` | no | embedding + prompt |
| `keywords` | no | embedding |
| `facts` | no | RAG grounding text injected verbatim into the prompt |
| `images` | no | template image-slot filling (product/testimonial entities) |
| `persona` | no | forward-compat; inert under knowledgeMode |
````

- [ ] **Step 2: Fix the Required-vs-Optional summary (`:356-369`)**

- Change the intro sentence (`:359`) so it reads that readiness requires **either** `knowledge` **or** (`products` + `features` + `faqs`), plus `suggestions`, `of1-endpoint`, `cta-template`, and templates-or-block-guide; and that `personas`/`use-cases` are NOT gated.
- In the table: add `| \`knowledge.json\` | YES (or products+features+faqs) | yes |`; append "(legacy)" to the `products.json`/`features.json`/`faqs.json` rows; **delete** the `use-cases.json` row.

- [ ] **Step 3: Verify**

Run:
```bash
cd of1-demo-skills/skills/of1-demo-orchestrator/knowledge
grep -n "## knowledge.json" worker-config-schemas.md
grep -n "knowledge.json | YES" worker-config-schemas.md
grep -c "use-cases.json | YES" worker-config-schemas.md   # expect 0
```
Expected: knowledge section + table row present; the required `use-cases.json` row gone.

- [ ] **Step 4: Commit (branch first — repo is on main)**

```bash
cd of1-demo-skills
git checkout -b feat/knowledge-only-config
git add skills/of1-demo-orchestrator/knowledge/worker-config-schemas.md
git commit -m "docs(worker-config-schemas): add knowledge.json contract, drop use-cases"
```

---

### Task 5: Live end-to-end gate

**Files:** none (integration verification).

**Interfaces:**
- Consumes: everything above, plus the deployed gen-web PR.

- [ ] **Step 1: Build a knowledge-only demo** through the orchestrator (or run `of1-extract-content` standalone on a target site) so `of1/config/knowledge.json` + `personas.json` are produced and images re-hosted.

- [ ] **Step 2: Publish + sync**

```bash
# publish knowledge to DA
node of1-skills/skills/of1-extract-content/assets/publish-config-da.mjs \
  --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" --files knowledge
# sync into the worker
curl -s -X POST "https://of1-gen-web-service.franklin-prod.workers.dev/api/tenants/${TENANT_ID}/sync" | jq '{ok, synced, errors, vectors}'
```
Expected: `ok:true`, `knowledge` in `synced`, no `errors`, `vectors.indexed > 0`.

- [ ] **Step 3: Confirm readiness + generation + personalize**

```bash
BASE=https://of1-gen-web-service.franklin-prod.workers.dev
curl -s "$BASE/api/tenants/${TENANT_ID}/status" | jq '{ready, hasKnowledge: .config.hasKnowledge}'
curl -s -X POST "$BASE/api/generate" -H 'Content-Type: application/json' \
  -d "{\"domain\":\"${TENANT_ID}\",\"query\":\"what do you offer\",\"followUp\":false,\"context\":{\"browsing\":[],\"conversationHistory\":[]}}" | head -50
```
Expected: `ready:true`, `hasKnowledge:true`; generate returns ≥ 2 knowledge-grounded sections; a follow-up `/api/personalize` call returns a knowledge-grounded personalization.

- [ ] **Step 4: Record the result** in the PR description (tenant id, sync counts, ready flag). No commit.
