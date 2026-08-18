---
name: of1-extract-design
description: Capture a live site's design tokens, brand surface, screenshots, per-page image URLs, and logo via stardust:extract, then publish a brand-review page. Stage 2a of the prototype+snowflake pipeline; also the extraction step of of1-integration when no DESIGN.json exists yet.
user-invocable: false
---

# OF1 Extract Design

Delegate site-extraction to the `stardust:extract` skill, then publish the resulting brand-review HTML to the of1-demo repo for EDS hosting.

Two callers, one procedure:

- **Stage 2a** of the prototype+snowflake pipeline — the target URL is the live external domain.
- **of1-integration's extraction fallback** — invoked when no `DESIGN.json` exists yet for an
  existing EDS/Stardust site; the target URL is that site's own EDS preview URL
  (`https://<branch>--<repo>--<owner>.aem.page`).

Everything below is identical either way — only the target URL argument changes.

## Env — orchestrator exports these (see `of1-setup`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-extract-design-status.json` on completion (see "## Completion" below) |
| `OF1_DEMO_REPO` | absolute path to the local `of1-demo` git clone |
| `SKILL_DIR`     | absolute path to this skill's directory (used to find `assets/fill-brand-review.mjs`) |

Read `$OWNER`, `$REPO`, `$BRANCH`, `$DOMAIN` from `repo-config.json`:

```bash
REPO_CONFIG=$(cat "$OF1_STATE_DIR/repo-config.json")
OWNER=$(jq -r .owner   <<<"$REPO_CONFIG")
REPO=$(jq -r .repo     <<<"$REPO_CONFIG")
BRANCH=$(jq -r .branch <<<"$REPO_CONFIG")
DOMAIN=$(jq -r .domain <<<"$REPO_CONFIG")
```

## Inputs

- **Target URL** (argument) — the live external domain (e.g. `https://frescopa.coffee`) when run
  as Stage 2a, or the site's own EDS preview URL (`https://<branch>--<repo>--<owner>.aem.page`)
  when run as of1-integration's extraction fallback.
- Discovery output from step 3 (`$OF1_STATE_DIR/step-3-output.md`), when available — demo focus, persona, key pages
- `repo-config.json` (from step 2)

Keep the page cap of 3 (homepage + 2 key pages) regardless of caller.

## Process

### 1. Invoke `stardust:extract` (DO NOT crawl by hand)

This step's whole job is to delegate to `stardust:extract`. **Do NOT use `playwright-cli`, `curl`, `wget`, or any other scraping mechanism here** — the stardust skill owns crawling, token extraction, screenshot capture, and brand-review authoring. Reimplementing it in this skill is the most common failure mode.

Invoke the `stardust:extract` skill. The argument is the target URL plus a page cap of 3 (homepage + 2 key category/product pages from discovery, when discovery output is available). More pages are slower without meaningfully better tokens.

**How to invoke in each runtime:**

- **Claude Code:** use the `Skill` tool:
  ```
  Skill: stardust:extract
  Args:  <target URL> --cap 3
  ```

- **SLICC:** read the skill and execute it inline:
  ```bash
  # 1. Read the skill instructions
  read_file /workspace/skills/extract/SKILL.md
  # 2. Follow those instructions directly — the skill IS the procedure.
  #    It will use playwright-cli to crawl, extract tokens, capture screenshots,
  #    and write all outputs under stardust/current/.
  ```
  Do NOT invent your own extraction approach. The stardust:extract skill already knows how to crawl, extract CSS tokens, capture screenshots, and write `pages/*.json` files with image URLs. Just read it and do what it says.

Wait for the extraction to finish. On success it writes all of the following under `$OF1_DEMO_REPO/`:

- `PRODUCT.md` — brand context
- `stardust/state.json` — extraction state
- `stardust/current/DESIGN.md` — design direction
- `stardust/current/DESIGN.json` — design tokens (colors, typography, spacing, shapes)
- `stardust/current/brand-review.html` — visual reference page
- `stardust/current/pages/*.json` — one JSON per crawled page with exact image URLs from the live DOM (step 5 reads these to get real image URLs instead of constructing them)
- `stardust/current/assets/logo.svg` — brand logo
- `stardust/current/assets/screenshots/*.png` — full-page screenshots per key page

### Fail loud on a blocked/degraded capture

`stardust:extract` can silently capture placeholder/gradient imagery instead of real
product photography when the source bot-blocks the crawler. That degraded capture must NOT
flow into prototype + snowflake. After extraction, verify the capture is real:

- If `stardust:extract` surfaces a machine-readable blocked-capture signal (a non-zero exit,
  or a `blocked`/`degraded` field in `stardust/state.json`), hard-stop: write
  `of1-extract-design-status.json` with `"status": "failed"` and a `summary` naming the block,
  and stop Stage 2. Do NOT proceed to prototype.
- If no machine-readable signal exists, inspect the captured screenshots / `stardust/current/pages/*.json`
  for placeholder or flat-gradient imagery; on detection, fail the same way.

(Implementation note for the executor: confirm what `stardust:extract` actually emits on a blocked
capture before finalizing the first bullet; if it only emits prose, keep only the second bullet's
screenshot inspection.)

### 2. Verify extraction outputs

```bash
cd "$OF1_DEMO_REPO"
test -f stardust/current/DESIGN.json     || { echo "FAIL: DESIGN.json missing"; exit 1; }
test -f stardust/current/DESIGN.md       || { echo "FAIL: DESIGN.md missing"; exit 1; }
test -f stardust/current/assets/logo.svg || { echo "FAIL: logo.svg missing"; exit 1; }
ls stardust/current/assets/screenshots/*.png >/dev/null 2>&1 \
  || { echo "FAIL: no screenshots"; exit 1; }
ls stardust/current/pages/*.json >/dev/null 2>&1 \
  || { echo "FAIL: no pages/*.json — stardust:extract was not invoked correctly"; exit 1; }
echo "✓ Extraction outputs present"
```

If `pages/*.json` is missing, it means `stardust:extract` was NOT actually invoked — the scoop improvised its own extraction. Go back and invoke the stardust skill properly.

If anything is missing, re-run `stardust:extract` with `--refresh` for the failing page.

### 3. Generate `deliverables/brand-review.html`

```bash
cd "$OF1_DEMO_REPO"
node "$SKILL_DIR/assets/fill-brand-review.mjs" . "$DOMAIN"
```

This reads `stardust/current/DESIGN.json` + screenshots + logo and writes `deliverables/brand-review.html` with absolute paths that resolve on the EDS preview URL.

### 4. Commit and push (one operation)

```bash
cd "$OF1_DEMO_REPO"
git add PRODUCT.md stardust/ deliverables/
git commit -m "feat: extraction - design tokens and brand identity for ${DOMAIN}"
git push origin "$BRANCH"
```

If `git add stardust/` shows nothing, the directory is in `.gitignore`. Force-add the deliverable files:

```bash
git add -f stardust/current/DESIGN.json stardust/current/DESIGN.md stardust/current/assets/
```

## Notes

**Private fonts** — when the site uses private fonts (e.g. Sentinel, Gotham Narrow), use the closest system-font fallback AND note the substitution in `DESIGN.json`. Don't invent a different typeface.

Logo SVG completeness, deliverable image paths, and image format rules are documented in `of1-demo/knowledge/common-pitfalls.md` (§ 2-3).

## Expected output structure

```
$OF1_DEMO_REPO/
├── PRODUCT.md                              ← Brand context (from stardust:extract)
├── stardust/
│   ├── state.json
│   └── current/
│       ├── DESIGN.md
│       ├── DESIGN.json                     ← Colors, typography, spacing, shapes
│       ├── brand-review.html
│       └── assets/
│           ├── logo.svg
│           └── screenshots/
│               ├── {page1}.png
│               └── {page2}.png
└── deliverables/
    ├── brand-review.html                   ← Copy for EDS serving (paths rewritten)
    └── assets/
        └── screenshots/                    ← Copies for EDS serving
            ├── {page1}.png
            └── {page2}.png
```

## Completion

```bash
REPORT_URL="https://${BRANCH}--${REPO}--${OWNER}.aem.page/deliverables/brand-review.html"
cat > "$OF1_STATE_DIR/of1-extract-design-status.json" <<EOF
{
  "stage": 2,
  "skill": "of1-extract-design",
  "status": "review",
  "deliverables": [ { "url": "${REPORT_URL}", "label": "Brand review" } ],
  "summary": "Extracted design tokens + brand surface for [domain]. [N] pages captured."
}
EOF
```

The orchestrator (CC: agent-return parsing; SLICC: sprinkle polling) handles the approve/done transition.
