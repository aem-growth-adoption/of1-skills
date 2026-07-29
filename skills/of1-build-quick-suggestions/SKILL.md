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
| `OF1_STATE_DIR` | state + IPC dir; receives `step-9-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local `of1-demo-orchestrator` git clone |

Read repo config:

```bash
REPO_CONFIG=$(cat "$OF1_STATE_DIR/repo-config.json")
DOMAIN=$(jq -r .domain <<<"$REPO_CONFIG")
cd "$OF1_DEMO_REPO"
mkdir -p of1/config
```

Schema reference: `of1-demo-orchestrator/knowledge/worker-config-schemas.md` § `suggestions.json`.

## Inputs

- `DOMAIN` (e.g. `frescopa.coffee`). In pipeline mode, read from repo-config. Only ask the user if not provided.
- Discovery output at `$OF1_STATE_DIR/step-2-output.md` (for product/category knowledge)

**REQUIRED — read step 8 outputs before generating suggestions.** This step runs AFTER step 8 completes, so these files exist:

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
- Cover different intents (compare, recommend, explore, deep-dive, budget)
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
    { "type": "explore", "label": "Short Chip Label", "query": "full natural language query the user would type" },
    { "type": "explore", "label": "Another Chip", "query": "another full query" }
  ]
}
```

**Field requirements:**
- `title` → the `<h1>` heading on the /of1 page (e.g. "Find Your Next Adventure")
- `subtitle` → supporting text below the heading
- `placeholder` → input field placeholder text
- `suggestions[].type` → always `"explore"` (used by the OF1 block for chip styling)
- `suggestions[].label` → short text shown on the chip (under 40 chars)
- `suggestions[].query` → the full query string sent to `/api/generate` when clicked

**Intent coverage:** Ensure suggestions cover all intent types so demos can showcase different generation behaviors:
- `deep-dive`: "Tell me about [specific product]" — detailed single-product pages
- `comparison`: "Compare [A] vs [B]" — side-by-side layouts
- `recommendation`: "Best [category] for [persona need]" — featured product + alternatives
- `discovery`: "Show me [broad category]" — diverse card grids
- `budget`: "[Category] under $[price]" — price-focused results

## Completion (pipeline mode)

```bash
cat > "$OF1_STATE_DIR/step-9-status.json" <<EOF
{"step":9,"status":"done","summary":"Generated [N] suggestion chips covering [intents covered]."}
EOF
```
