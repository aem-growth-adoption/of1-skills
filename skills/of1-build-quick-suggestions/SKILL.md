---
name: of1-build-quick-suggestions
description: Generate domain-specific quick suggestion chips and search UI copy for the demo
user-invocable: true
---

# Quick Suggestions Generator

Generate domain-specific quick suggestion chips, placeholder text, and search UI copy based on the site's products and content.

## Env — orchestrator exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-build-quick-suggestions-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local `of1-demo-orchestrator` git clone |

Read repo config:

```bash
REPO_CONFIG=$(cat "$OF1_STATE_DIR/repo-config.json")
OWNER=$(jq -r .owner   <<<"$REPO_CONFIG")
REPO=$(jq -r .repo     <<<"$REPO_CONFIG")
BRANCH=$(jq -r .branch <<<"$REPO_CONFIG")
DOMAIN=$(jq -r .domain <<<"$REPO_CONFIG")
cd "$OF1_DEMO_REPO"
mkdir -p of1/config
```

Schema reference: `of1-demo-orchestrator/knowledge/worker-config-schemas.md` § `suggestions.json`.

This skill does not crawl the site — it is a pure transform over `products.json`, `personas.json`,
and `brand-voice.json` (already produced by `of1-extract-content` and `of1-extract-brand-voice`, which
own the live-site-vs-replica source resolution). There is no `OF1_CONTENT_SOURCE` handling here; output
files and JSON shapes are identical in pipeline and standalone modes.

## Inputs

- `DOMAIN` (e.g. `frescopa.coffee`). In pipeline mode, read from repo-config. Only ask the user if not provided.
- Discovery output at `$OF1_STATE_DIR/of1-discovery-output.md` (for product/category knowledge)

**REQUIRED — read the content-extraction outputs before generating suggestions.** This skill runs AFTER `of1-extract-brand-voice` and `of1-extract-content` complete, so these files exist:

```bash
# Product names — suggestions MUST reference only real products that exist
cat of1/config/products.json | jq -r '.[].name'

# Personas — each suggestion should target a real persona
cat of1/config/personas.json | jq -r '.[].name'

# Brand voice — respect avoid words; use vocabulary terms
cat of1/config/brand-voice.json | jq '{tone, vocabulary, avoidWords}'
```

**Every suggestion chip must reference products/activities that actually exist in `products.json`.** Do NOT invent product names from memory — if the site doesn't have snowboarding trips, don't suggest "skiing vs snowboarding." The product list is the ground truth.

## Process

### 1. Generate suggestions

Based on the actual product catalog, personas, and brand voice, generate 8–12 quick suggestion chips that:
- **Only reference products/categories that exist in products.json**
- Cover different personas (from personas.json)
- Cover different intents (`comparison`, `recommendation`, `deep-dive`, `discovery`, `budget` — the same five the templates use; see the Intent coverage list below)
- Use natural language a real user would type
- Are concise (under 40 characters each)

Also generate:
- Search bar placeholder text
- Page title
- Page subtitle

### 2. Write `of1/config/suggestions.json`

The OF1 block fetches this on page load to populate the search UI (randomly picks 5 to display):

```json
{
  "title": "...",
  "subtitle": "...",
  "placeholder": "...",
  "suggestions": [
    { "type": "comparison", "label": "Short Chip Label", "query": "full natural language query the user would type" },
    { "type": "budget", "label": "Another Chip", "query": "another full query" }
  ]
}
```

**Field requirements:**
- `title` → the `<h1>` heading on the /of1 page (e.g. "Find Your Next Adventure")
- `subtitle` → supporting text below the heading
- `placeholder` → input field placeholder text
- `suggestions[].type` → the chip's **intent**: one of `comparison`, `recommendation`, `deep-dive`, `discovery`, `budget` (the same five the templates use; see Intent coverage below). Set it to the intent that produced this chip's query. Note: the OF1 worker/SDK does not read `type` today — landing chips render from `label` + `query` only, and follow-up ranking uses `query`/`label` — so this is currently descriptive metadata that travels with the config, correct and ready for a future consumer (e.g. per-intent chip styling or analytics). It is NOT validated, so an accurate value is free and a wrong one is harmless; use the real intent.
- `suggestions[].label` → short text shown on the chip (under 40 chars)
- `suggestions[].query` → the full query string sent to `/api/generate` when clicked

**Intent coverage:** each chip's intent is recorded in its `type` field (above). Spread your 8–12 chips across all five intents so demos can showcase different generation behaviors:
- `deep-dive`: "Tell me about [specific product]" — detailed single-product pages
- `comparison`: "Compare [A] vs [B]" — side-by-side layouts
- `recommendation`: "Best [category] for [persona need]" — featured product + alternatives
- `discovery`: "Show me [broad category]" — diverse card grids
- `budget`: "[Category] under $[price]" — price-focused results

## Completion (pipeline mode)

```bash
cat > "$OF1_STATE_DIR/of1-build-quick-suggestions-status.json" <<EOF
{"stage":3,"skill":"of1-build-quick-suggestions","status":"done","summary":"Generated [N] suggestion chips covering [intents covered]."}
EOF
```
