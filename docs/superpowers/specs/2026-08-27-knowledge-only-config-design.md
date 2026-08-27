# Knowledge-only tenant config — design

**Date:** 2026-08-27
**Status:** Design (approved in brainstorming; pending spec review)
**Repos:** `of1-skills` (producer, primary), `of1-gen-web` (consumer)

## Summary

Move the OF1 demo pipeline from producing split factual config
(`products` / `features` / `faqs` / `testimonials`) to producing a single
`knowledge` document of generic entities. The gen-web worker already
supports a `knowledge` entity end-to-end (sync → embed → retrieve →
ground); what is missing is (a) a producer that generates and publishes
the knowledge doc, and (b) a small set of gen-web changes so a
products-empty, knowledge-only tenant is "ready", personalizes, and
carries an entity `type`. Both product-based (legacy) and knowledge-only
tenants must keep working — backward compatibility is mandatory because
existing demos call the live APIs.

## Background / current state

- **Split config, DA-authored.** `of1-extract-content` (an LLM-driven
  skill) writes `of1/config/{products,personas,use-cases,features,faqs,testimonials}.json`
  and publishes `products`/`features`/`faqs` to DA as `of1-config` blocks
  (`of1-extract-content/SKILL.md:150-266,357-379`). `publish-config-da.mjs`
  renders JSON → DA blocks and already supports a `knowledge` file in its
  SPECS (`FILE_FIELDS.knowledge`, order `title,description,keywords,facts,images,persona,useCase`).
- **Consumer is ready.** On `of1-gen-web` `main`, `knowledge` is a
  first-class DA-backed + vectorized entity: `CONFIG_FILES`/`VECTOR_FILES`/`DA_BACKED_FILES`
  include it (`sync.js`), it has a schema (`config-schemas.js` `knowledge`),
  it embeds and retrieves into `ctx.rag.knowledge`, and the
  `default` + `template-routing` flows inject it and use its images.
- **Render flow.** Pipeline-built demos always run **`template-routing`**
  (`of1-build-templates/assets/assemble-catalog.mjs:112` writes
  `useRouting:true`); `knowledgeMode:"da-document"` is set by
  `of1-check-dependencies`. `template-routing` already grounds on knowledge
  and fills image slots from knowledge (`build-template-prompt.js:55`,
  `validate-image-urls.js:34`).
- **Generation is not gated on readiness.** `/api/generate` only checks the
  tenant exists; `isTenantReady` drives `/api/tenants/:id/status` only. But
  `of1-publish` Step 6 gates on `/status .ready`, which today requires
  `products && features && faqs`.

## Decisions (locked)

1. **Knowledge-only producer.** New demos author `knowledge`; stop
   producing `products`/`features`/`faqs`/`testimonials`/`use-cases`.
2. **Keep `personas`.** The demo's Intent Map radar and `/api/personalize`
   intent context read personas. `use-cases` is dropped (worker ignores it
   under knowledgeMode).
3. **Both paths coexist in gen-web.** Legacy product-based tenants keep
   working unchanged; knowledge-only is an additive path selected by tenant
   config.
4. **`personalize` must reach parity** on knowledge-only tenants (in scope,
   not deferred).
5. **Entity `type` field** is added so consumers can distinguish a
   product-like entity from a faq, etc.

## Content model

`of1/config/knowledge.json` — a non-empty array of entities:

```json
{
  "id": "edge-inference-engine",
  "type": "product",
  "title": "Edge Inference Engine",
  "description": "AI that runs in milliseconds at the CDN layer…",
  "keywords": ["edge ai", "low latency personalization"],
  "facts": [
    "Runs inference at the CDN edge, not a central data center.",
    "Delivers millisecond response times.",
    "Category: Platform / Edge AI."
  ],
  "images": ["https://…aem.page/media/product-edge-inference-engine-1.png"],
  "persona": "platform-engineering-lead"
}
```

- **`type`** — open string; the producer emits `product | feature | faq | testimonial`.
  Extensible to `concept | person | service | …`. Optional on read (legacy
  hand-authored entities may omit it).
- **`facts[]`** — the load-bearing field: each a self-contained, true,
  quotable claim. It is the RAG grounding text and is injected verbatim into
  the prompt. Mapping must render structured fields (price, category,
  highlights, feature bullets, FAQ answers) as facts.

### Mapping from today's extraction

| Source | → knowledge entity |
|--------|--------------------|
| product | `type:"product"`; title=name, description, images, persona; `facts[]` = highlights + related feature bullets + price/category as claims |
| feature | folded as `facts[]` into its related product (via `productIds`); an orphan feature becomes its own `type:"feature"` entity |
| faq | `type:"faq"`; title=question, description=answer, `facts:[answer]`, no images |
| testimonial | `type:"testimonial"`; title=author/company, `facts[]`=quote + attribution |
| personas | **kept** as `of1/config/personas.json` (unchanged; not knowledge) |
| use-cases | **dropped** |

Machinery config unchanged: `suggestions`, `brand-voice`, `cta-template`,
`templates`, `of1-endpoint`.

## Producer changes (`of1-skills`)

1. **`of1-extract-content`**
   - Step 7 emits `of1/config/knowledge.json` (schema + mapping above) with
     `type` per entity; keep emitting `personas.json`; stop emitting
     `products/features/faqs/testimonials/use-cases`.
   - Update the skill description line (`SKILL.md:9`) and the Step 7 schema
     block. Cross-reference check (Step 8) updated for knowledge entity ids
     (`persona` refs resolve against personas).
   - Image discipline (≥ 4 images, matching today's product rule) applies
     to `type:"product"` entities.
2. **`assets/download-images.mjs`** — repoint the image re-host worklist and
   the `--update-products` rewrite from `products.json[*].images` to
   `knowledge.json[*].images` (rewrite entities whose `images` hold source
   URLs). Preserve behavior (download → upload to DA → preview → rewrite to
   `.aem.page/media/...`).
3. **Step 10 publish** — `publish-config-da.mjs --files knowledge` (SPEC
   already supports it; no script change). `personas.json` stays a
   committed-JSON fallback (not DA-published, as today for non-vector files).
4. **`of1-publish`**
   - Step 1 expected-file list → `knowledge` (+ `personas`), drop
     products/features/faqs/use-cases.
   - Step 6 readiness gate → still reads `/status .ready`; now satisfied by
     `hasKnowledge` (see gen-web change). Update the documented required-set.
   - Check 3 (image count) → over `type:"product"` knowledge entities.
   - Check 6 (`/api/generate` smoke test) → query unchanged; still expects
     ≥ 2 grounded sections.
5. **`of1-demo-orchestrator/knowledge/worker-config-schemas.md`** — add a
   `knowledge.json` section + a Required-vs-Ready table row (required for
   knowledge-only tenants); remove `use-cases`; mark products/features/faqs
   as legacy.
6. **`of1-check-dependencies`** — no change (already writes
   `knowledgeMode:"da-document"`); drop `use-cases` from any listed
   dependency set if present.

## Consumer changes (`of1-gen-web`) — in scope now

1. **`tenant.js` `isTenantReady`** — content requirement becomes
   `((products && features && faqs) || knowledge)`; keep `suggestions &&
   of1Endpoint && ctaTemplate` and `blockGuide || templates`. Legacy tenants
   pass via the products branch; knowledge-only via the knowledge branch.
2. **`tenant.js` `tenantStatus`** — add `hasKnowledge: !!tenant.knowledge`
   to the `config` object so `of1-publish` can verify.
3. **`config-schemas.js`** — add `type: { type: "string" }` to the
   `knowledge` entity `fields`. Carry `type` in the Vectorize metadata
   (`embeddings.js`) so retrieval/personalize can filter by it.
4. **`personalize.js`** — ground on knowledge with parity to the product
   path: when `tenant.products` is empty, build interest-match candidates
   from `tenant.knowledge` (prefer `type:"product"`, fall back to all
   entities), reusing the existing interest-scoring and CTA/page-mutation
   behavior. Legacy product tenants keep the current path unchanged.

## Backward compatibility

- `isTenantReady` and `personalize` branch on which config is present; no
  legacy behavior changes when `products` exists.
- `type` is optional on read; hand-authored knowledge entities without it
  still validate.
- gen-web changes are additive; existing tests must stay green as the
  compat proof.

## Deferred — "full B" (documented, not built now)

These live in rendering engines the pipeline's demos do **not** use
(`template-routing` is unaffected), so they do not block knowledge-only
demos. They **will** be needed when a knowledge-only tenant runs on those
engines:

- **`da-blocks` / `da-blocks-slots` engines** — `build-block-template-prompt.js`
  and `build-block-slot-prompt.js` do not inject `ctx.rag.knowledge`; and
  `validate-image-urls` (knowledge-image slotting) is excluded from these
  flows (`flows.js`). A knowledge-only tenant here gets ungrounded copy and
  no knowledge images.
- **`default` flow prompt copy** — `generate/template.njk` uses
  "product advisor" phrasing that biases wording toward products.

Action: add a short follow-up note in `of1-gen-web/docs/` (e.g. append to
the knowledge-entities plan) pointing at these files, so gen-web devs find
the gap when they enable knowledge on those engines.

## Testing

- **gen-web (unit):** `isTenantReady` — knowledge-only ready, legacy ready,
  neither → not ready; `tenantStatus.hasKnowledge`; `config-schemas`
  accepts `type`; `personalize` matches over knowledge (prefers
  `type:"product"`) and preserves the legacy products path. Full suite stays
  green.
- **of1-skills:** `publish-config-da.mjs --files knowledge` round-trips a
  `knowledge.json`; `download-images.mjs` rewrites `knowledge.json[*].images`.
- **E2E:** build a knowledge-only demo → publish (`--files knowledge`) →
  sync → `/status` `ready:true` with `hasKnowledge:true` → `/api/generate`
  returns knowledge-grounded sections → `/api/personalize` returns a
  knowledge-grounded personalization.

## Rollout

- Two PRs. **gen-web merges first** (the producer's readiness gate depends
  on `isTenantReady` accepting knowledge and `tenantStatus` emitting
  `hasKnowledge`), then of1-skills.
- Existing product-based demos are untouched and require no re-sync.

## Out of scope

- Deprecating/removing the `products`/`features`/`faqs` code paths in
  gen-web (both paths coexist).
- Deriving personas/use-cases from the knowledge base (future research
  direction, per `of1-gen-web/docs/superpowers/specs/2026-08-25-personas-usecases-rethink-idea.md`).
- The deferred "full B" engine work above.
