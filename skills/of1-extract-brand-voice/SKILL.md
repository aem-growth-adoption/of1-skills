---
name: of1-extract-brand-voice
description: Extract brand voice from a website and write it as the DA doc /of1/brand-voice
user-invocable: true
---

# Brand Voice Extractor

Analyze a website to extract its brand voice, tone, and personality, then write it as the DA document `/of1/brand-voice` (authors can edit it in DA afterwards; the worker syncs it as `brand-voice`).

## Env — orchestrator exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-extract-brand-voice-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local `of1-demo-orchestrator` git clone |
| `SKILL_DIR` | absolute path to this skill (used to find `../of1-integration/assets/da-write.mjs`) |
| `ADOBE_IMS_TOKEN` / `OF1_TOKEN_FILE` | DA token (resolved by `da-write.mjs`) |
| `OF1_PIPELINE_MODE` | `1` in pipeline mode — overwrite `/of1/brand-voice` without asking |

Read repo config:

```bash
REPO_CONFIG=$(cat "$OF1_STATE_DIR/repo-config.json")
OWNER=$(jq -r .owner   <<<"$REPO_CONFIG")
REPO=$(jq -r .repo     <<<"$REPO_CONFIG")
BRANCH=$(jq -r .branch <<<"$REPO_CONFIG")
PREVIEW="${BRANCH}--${REPO}--${OWNER}.aem.page"
SKILL_DIR="${SKILL_DIR:-/workspace/skills/of1-extract-brand-voice}"
DA_WRITE="$SKILL_DIR/../of1-integration/assets/da-write.mjs"
cd "$OF1_DEMO_REPO"
```

Nothing is written to git — the brand voice lives only in DA at `/of1/brand-voice`.

## Source resolution — live site vs replica

This skill crawls real pages (Step 1), so it needs a base URL to crawl. There are two candidates and
`OF1_CONTENT_SOURCE` decides between them:

```bash
if [ -n "$OF1_CONTENT_SOURCE" ]; then
  # Pipeline mode: extract from the REAL external site. The orchestrator sets
  # OF1_CONTENT_SOURCE to the target domain (e.g. frescopa.coffee), so here
  # SOURCE_BASE is just that domain as an https:// URL.
  SOURCE_BASE="https://${OF1_CONTENT_SOURCE}"
else
  # Standalone mode (default): there is no external domain to point at — crawl the
  # built EDS replica preview instead. This is NOT the target domain.
  SOURCE_BASE="https://${BRANCH}--${REPO}--${OWNER}.aem.page"
fi
echo "Extracting from: $SOURCE_BASE"
```

Use `$SOURCE_BASE` as the root for every crawl/scrape in the steps below. Everything else
(output files, JSON shapes) is identical in both modes.

## Inputs

- `$SOURCE_BASE` (resolved above) — the base URL to crawl. In pipeline mode this is the target domain; in standalone mode it's the replica preview.
- Discovery output at `$OF1_STATE_DIR/of1-discovery-output.md` (if available — use for page URLs instead of re-discovering)

## Process

### 1. Crawl key pages

Fetch **3–5 pages** to get a representative sample of the brand's writing:

1. **Homepage** — `$SOURCE_BASE`
2. **Product/service page** — a detail page (from discovery output if available)
3. **About or editorial** — `$SOURCE_BASE/about`, `$SOURCE_BASE/blog`, `$SOURCE_BASE/stories`

For each page, analyze:
- TONE: Formal/informal, technical/accessible, playful/serious?
- VOCABULARY: 10–15 domain-specific terms used naturally
- BRAND PERSONALITY: If this brand were a person, how would they talk?
- DO patterns: What does the writing do well?
- DON'T patterns: What does the writing avoid?
- EXAMPLE PHRASES: 3–5 distinctly "on-brand" phrases

### 2. Synthesize

Across all pages, identify:
- Consistent voice attributes
- Audience profile
- Domain vocabulary (used without explanation)
- Anti-patterns (words/phrases the brand avoids)

### 3. Present findings (standalone mode only)

**Skip this step in pipeline mode** — go directly to Step 4.

In standalone mode, present and wait for confirmation:

```
## Brand Voice Analysis: [Brand Name]

**Audience:** [who]
**Core voice:** [3-5 adjectives]
**Key vocabulary:** [10-15 terms]

**DO:**
- [pattern]

**DON'T:**
- [pattern]

Does this capture the brand correctly? Anything to adjust?
```

### 4. Write the `/of1/brand-voice` DA doc

The worker injects this doc into the LLM system prompt to shape how generated sections are written. The more specific and accurate, the more on-brand the output.

**Existing doc check (standalone mode only).** An author may already have edited `/of1/brand-voice` in DA. Before writing, check whether it exists:

```bash
if [ "${OF1_PIPELINE_MODE:-}" != "1" ] && \
   [ "$(curl -s -o /dev/null -w '%{http_code}' "https://${PREVIEW}/of1/brand-voice.plain.html")" = "200" ]; then
  echo "/of1/brand-voice already exists"
fi
```

- **Standalone mode** (`OF1_PIPELINE_MODE` unset) and the check returns 200: **ask the user before overwriting** ("`/of1/brand-voice` already exists in DA — overwrite it with the newly extracted voice? [y/N]"). On anything but an explicit yes, skip the write, keep the existing doc, and say so in the completion summary.
- **Pipeline mode** (`OF1_PIPELINE_MODE=1`): overwrite without asking.

Write the doc to `$OF1_STATE_DIR/brand-voice.html` with exactly these four sections (escape `&`, `<`, `>` in text):

```html
<body><header></header><main><div>
<h2>Personality</h2><p>[3-5 adjectives, comma-separated]</p>
<h2>Tone</h2><p>[1-2 sentence description of overall tone]</p>
<h2>Words we use</h2><ul><li>term1</li><li>term2</li><li>...10-15 domain terms</li></ul>
<h2>Words we avoid</h2><ul><li>word1</li><li>...words the brand never uses</li></ul>
</div></main><footer></footer></body>
```

Then upload + preview it:

```bash
node "$DA_WRITE" doc --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
  --path of1/brand-voice --file "$OF1_STATE_DIR/brand-voice.html"
```

It prints `✓ of1/brand-voice previewed` on success. On `FAIL <step> <path> HTTP <status>` (non-zero exit) **stop** and report the failure — do not mark the skill done.

## Completion (pipeline mode)

This skill runs alongside `of1-extract-content`. Both must complete before the content track is treated as done.

```bash
cat > "$OF1_STATE_DIR/of1-extract-brand-voice-status.json" <<EOF
{"stage":3,"skill":"of1-extract-brand-voice","status":"done","summary":"Brand voice written to DA /of1/brand-voice: [personality adjectives]. [N] words we use, [M] words we avoid."}
EOF
```

The orchestrator waits for both `of1-extract-brand-voice-status.json` and `of1-extract-content-status.json` (the content track) before treating the content pair as complete.
