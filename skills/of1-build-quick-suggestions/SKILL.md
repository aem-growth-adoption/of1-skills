---
name: of1-build-quick-suggestions
description: Generate domain-specific quick suggestion chips (DA sheet /of1/config/suggestions) and search UI copy for the demo
user-invocable: true
---

# Quick Suggestions Generator

Generate domain-specific quick suggestion chips, placeholder text, and search UI copy based on the site's captured content, personas, and brand voice.

## Env — the driver exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; holds the inputs below, receives `suggestions-rows.json`, `of1-landing.json`, and `of1-build-quick-suggestions-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local EDS site repo |
| `SKILL_DIR` | absolute path to this skill (used to find `../of1-integration/assets/da-write.mjs`) |
| `ADOBE_IMS_TOKEN` / `OF1_TOKEN_FILE` | DA token (resolved by `da-write.mjs`) |

Each command step is a script in `$SKILL_DIR/scripts/` (run as `bash "$SKILL_DIR/scripts/<name>"`). Every script sources `common.sh`: env from `repo-config.json`, DA token probe (warns and continues if no token resolves), `PREVIEW`, then `cd "$OF1_DEMO_REPO"`.

Nothing is written to git — chips live only in the DA sheet `/of1/config/suggestions` (never commit a
suggestions file into the repo: it would shadow the DA sheet), and the landing copy is handed to
`of1-style-generative-block` via `$OF1_STATE_DIR/of1-landing.json`, which writes it as rows on the `/of1` block.

This skill does not crawl the site — it is a pure transform over the outputs of `of1-extract-content`
and `of1-extract-brand-voice` (which own the content-source resolution). There is no
`OF1_CONTENT_SOURCE` handling here.

## Inputs

- `$OF1_STATE_DIR/knowledge-pages.json` — captured site pages (`[{ url, title, blocks: [{tag, text} | {tag:'img', src, alt}] }]`), produced by `of1-extract-content`. **Page titles and headings are the ground truth for chip subjects.**
- `$OF1_STATE_DIR/personas-rows.json` — persona rows (`id, name, description, keywords[], priorities[], explore…support`), produced by `of1-extract-content`
- Brand voice — the DA doc `/of1/brand-voice` (`https://$PREVIEW/of1/brand-voice.plain.html`, authoritative — an author may have edited it), falling back to the local copy `$OF1_STATE_DIR/brand-voice.html`; produced by `of1-extract-brand-voice`
- Discovery output at `$OF1_STATE_DIR/of1-discovery-output.md` (for product/category knowledge) — **optional** (usually absent);  `knowledge-pages.json` is enough on its own

**REQUIRED — read the content-extraction outputs before generating suggestions.** This skill runs AFTER `of1-extract-brand-voice` and `of1-extract-content` complete, so these exist:

```bash
bash "$SKILL_DIR/scripts/read-inputs.sh"
```

It prints page titles + h1–h3 headings (chip subjects), each persona's `name: description`, and the brand voice (DA doc `https://$PREVIEW/of1/brand-voice.plain.html`, falling back to `$OF1_STATE_DIR/brand-voice.html`).

**Every suggestion chip must reference real subjects from `knowledge-pages.json`** (page titles / headings). Do NOT invent product names from memory — if the site doesn't have snowboarding trips, don't suggest "skiing vs snowboarding." The captured pages are the ground truth. Respect the brand voice's "Words we avoid" and prefer its "Words we use".

## Process

### 1. Generate suggestions

Based on the captured pages, personas, and brand voice, generate 8–12 quick suggestion chips that:
- **Only reference real subjects that exist in `knowledge-pages.json`**
- Cover different personas (from `personas-rows.json`)
- Cover different intents (`comparison`, `recommendation`, `deep-dive`, `discovery`, `budget` — the same five the templates use; see the Intent coverage list below)
- Use natural language a real user would type
- Are concise (under 40 characters each)

Also generate:
- Search bar placeholder text
- Page title
- Page subtitle

**Intent coverage:** spread your 8–12 chips across all five intents so demos can showcase different generation behaviors:
- `deep-dive`: "Tell me about [specific product]" — detailed single-product pages
- `comparison`: "Compare [A] vs [B]" — side-by-side layouts
- `recommendation`: "Best [category] for [persona need]" — featured product + alternatives
- `discovery`: "Show me [broad category]" — diverse card grids
- `budget`: "[Category] under $[price]" — price-focused results. **Site has no prices?** (services, institutions, B2B, content sites — check `knowledge-pages.json` for currency amounts) Never invent prices. Map `budget` to a cost / effort / "start small" angle on real content instead — e.g. "Free resources to get started", "What's included at no cost?", "Quickest way to start with [real program]", "Low-commitment options for [persona need]".

### 2. Write the chips to the DA sheet `/of1/config/suggestions`

The worker syncs this sheet (sync file `suggestions`) and serves the chips via `/api/suggest`; the OF1 block fetches them from there on page load (randomly picks 5 to display) — it does not read the sheet directly. So after an author edits the sheet in DA they must **preview it AND re-sync the tenant** (DA "Sync OF1" app or `of1-publish`) before the chips change. Write the rows to `$OF1_STATE_DIR/suggestions-rows.json` — one object per chip, keys exactly matching the sheet columns:

```json
[
  { "label": "Short Chip Label", "query": "full natural language query the user would type" },
  { "label": "Another Chip", "query": "another full query" }
]
```

- `label` → short text shown on the chip (under 40 chars)
- `query` → the full query string sent to `/api/generate` when clicked

Upload + preview the sheet:

```bash
bash "$SKILL_DIR/scripts/write-sheet.sh"
```

It prints `✓ of1/config/suggestions previewed` on success. **The chips won't appear on `/of1` yet** — the block reads them from the worker (`/api/suggest`), which only sees the sheet after the tenant is re-synced (`of1-publish` step 4, or the DA "Sync OF1" app). Empty chips right after this step are expected. On `FAIL <step> <path> HTTP <status>` (non-zero exit) **stop** and report the failure — do not mark the skill done.

### 3. Write the landing copy to `$OF1_STATE_DIR/of1-landing.json`

```json
{ "title": "...", "subtitle": "...", "placeholder": "..." }
```

- `title` → the `<h1>` heading on the /of1 page (e.g. "Find Your Next Adventure")
- `subtitle` → supporting text below the heading
- `placeholder` → input field placeholder text

`of1-style-generative-block` (Step 5) writes these as `title` / `subtitle` / `placeholder` rows on the `/of1` page's `of1` block, where authors can edit them in DA. If that skill has already run, re-run its Step 5 (or edit the `/of1` doc in DA) to apply the copy; when the rows are absent the SDK falls back to its defaults.

## Completion (both modes)

`of1-publish`'s demo hub reads every `of1-*-status.json` for its "What worked" panel.

```bash
cat > "$OF1_STATE_DIR/of1-build-quick-suggestions-status.json" <<EOF
{"stage":3,"skill":"of1-build-quick-suggestions","status":"done","summary":"Published [N] suggestion chips to /of1/config/suggestions covering [intents covered]; landing copy in of1-landing.json."}
EOF
```
