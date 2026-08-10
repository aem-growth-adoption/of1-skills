---
name: of1-extract-brand-voice
description: Extract brand voice from a website and generate brand-voice.json for the tenant config
user-invocable: true
---

# Brand Voice Extractor

Analyze a website to extract its brand voice, tone, and personality, then generate a `brand-voice.json` file for the OF1 worker tenant config.

## Env — orchestrator exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-extract-brand-voice-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local `of1-demo-orchestrator` git clone |

Read repo config:

```bash
REPO_CONFIG=$(cat "$OF1_STATE_DIR/repo-config.json")
OWNER=$(jq -r .owner   <<<"$REPO_CONFIG")
REPO=$(jq -r .repo     <<<"$REPO_CONFIG")
BRANCH=$(jq -r .branch <<<"$REPO_CONFIG")
cd "$OF1_DEMO_REPO"
mkdir -p of1/config
```

Schema reference: `of1-demo-orchestrator/knowledge/worker-config-schemas.md` § `brand-voice.json`.

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
- SENTENCE STYLE: Short and punchy? Long and detailed?
- BRAND PERSONALITY: If this brand were a person, how would they talk?
- DO patterns: What does the writing do well?
- DON'T patterns: What does the writing avoid?
- EXAMPLE PHRASES: 3–5 distinctly "on-brand" phrases

### 2. Synthesize

Across all pages, identify:
- Consistent voice attributes
- Audience profile
- Tone variations by context (recommendations, comparisons, educational, discovery)
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

**Tone by context:**
- Recommendations: [tone]
- Comparisons: [tone]
- Educational: [tone]
- Discovery: [tone]

Does this capture the brand correctly? Anything to adjust?
```

### 4. Generate `of1/config/brand-voice.json`

The worker injects these fields into the LLM system prompt to shape how generated sections are written. The more specific and accurate, the more on-brand the output.

```json
{
  "personality": "[3-5 adjectives, comma-separated]",
  "tone": "[1-2 sentence description of overall tone]",
  "vocabulary": ["term1", "term2", "term3", "...10-15 domain terms"],
  "avoidWords": ["word1", "word2", "...words the brand never uses"],
  "sentenceStyle": "[description of sentence patterns]",
  "toneByContext": {
    "recommendations": "[tone when recommending]",
    "comparisons": "[tone when comparing]",
    "educational": "[tone when explaining]",
    "discovery": "[tone when showing options]"
  }
}
```

## Completion (pipeline mode)

This skill runs alongside `of1-extract-content`. Both must complete before the content track is treated as done.

```bash
cat > "$OF1_STATE_DIR/of1-extract-brand-voice-status.json" <<EOF
{"stage":3,"skill":"of1-extract-brand-voice","status":"done","summary":"Brand voice extracted: [personality adjectives]. [N] vocabulary terms, [M] avoid words."}
EOF
```

The orchestrator waits for both `of1-extract-brand-voice-status.json` and `of1-extract-content-status.json` (the content track) before treating the content pair as complete.
