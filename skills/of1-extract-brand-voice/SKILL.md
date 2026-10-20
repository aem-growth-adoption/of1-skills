---
name: of1-extract-brand-voice
description: Extract brand voice from a website and write it as the DA doc /of1/brand-voice
user-invocable: true
---

# Brand Voice Extractor

Analyze a website to extract its brand voice, tone, and personality, then write it as the DA document `/of1/brand-voice` (authors can edit it in DA afterwards; the worker syncs it as `brand-voice`).

## Env — the driver exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-extract-brand-voice-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local EDS site repo |
| `SKILL_DIR` | absolute path to this skill (used to find `../of1-integration/assets/da-write.mjs`) |
| `ADOBE_IMS_TOKEN` / `OF1_TOKEN_FILE` | DA token (resolved by `da-write.mjs`) |
| `OF1_CONTENT_SOURCE` | optional content domain to crawl (see Source resolution) |
| `OF1_NON_INTERACTIVE` | `1` — no questions: overwrite `/of1/brand-voice` without asking, skip the confirmation step |

Each command step is a script in `$SKILL_DIR/scripts/` (run as `bash "$SKILL_DIR/scripts/<name>"`). Every script sources `common.sh`: env from `repo-config.json`, DA token probe (warns and continues if no token resolves), `SOURCE_BASE`, then `cd "$OF1_DEMO_REPO"`.

Nothing is written to git — the brand voice lives only in DA at `/of1/brand-voice`.

## Source resolution — live site vs replica

`common.sh` sets `SOURCE_BASE`: `https://${OF1_CONTENT_SOURCE}` (the REAL external site) when `OF1_CONTENT_SOURCE` is set, else the site's own EDS preview `https://main--${REPO}--${OWNER}.aem.page`. It is the root for every crawl below; everything else is identical either way.

## Inputs

- `$SOURCE_BASE` (resolved above) — the base URL to crawl. With `OF1_CONTENT_SOURCE` set this is that domain; otherwise it's the site's own preview.
- Discovery output at `$OF1_STATE_DIR/of1-discovery-output.md` — **optional** (only the full e2e pipeline produces it; standalone runs usually have none). Use it for page URLs when present; otherwise pick pages as in Step 1.

## Process

### 1. Crawl key pages

Fetch **3–5 pages** to get a representative sample of the brand's writing:

1. **Homepage** — `$SOURCE_BASE`
2. **Product/service page** — a detail page (from discovery output if available)
3. **About or editorial** — `$SOURCE_BASE/about`, `$SOURCE_BASE/blog`, `$SOURCE_BASE/stories`

**No discovery output?** Don't guess URLs — pick real pages from the site's nav or index, then read each page's undecorated EDS markup (`<path>.plain.html`, the authored copy without chrome):

```bash
bash "$SKILL_DIR/scripts/pick-pages.sh"
```

It lists candidate pages (nav links first, else the JSON index minus `drafts|fragments|of1|templates`) and prints the home page + up to 4 others as `=== <path>` followed by their first 20 KB of markup.

(For a non-EDS live site via `OF1_CONTENT_SOURCE`, `.plain.html` won't exist — fetch the page itself with WebFetch.)

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

### 3. Present findings (interactive only)

**Skip this step when `OF1_NON_INTERACTIVE=1`** — go directly to Step 4.

Otherwise present and wait for confirmation:

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

**Existing doc check (interactive only).** An author may already have edited `/of1/brand-voice` in DA. Before writing, check whether it exists:

```bash
bash "$SKILL_DIR/scripts/write-doc.sh" check   # prints "exists" or "absent"
```

- **Interactive** (`OF1_NON_INTERACTIVE` unset) and the check prints `exists`: **ask the user before overwriting** ("`/of1/brand-voice` already exists in DA — overwrite it with the newly extracted voice? [y/N]"). On anything but an explicit yes run `write-doc.sh skip` (keeps the doc; say so in the completion summary).
- **Non-interactive** (`OF1_NON_INTERACTIVE=1`): do not check; overwrite without asking.

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
bash "$SKILL_DIR/scripts/write-doc.sh" overwrite   # default; uploads + previews the doc
```

It prints `✓ of1/brand-voice previewed` on success. On `FAIL <step> <path> HTTP <status>` (non-zero exit) **stop** and report the failure — do not mark the skill done.

## Completion

`of1-publish`'s demo hub reads every `of1-*-status.json` for its "What worked" panel. This skill runs alongside `of1-extract-content`; both must complete before the content track is treated as done.

```bash
cat > "$OF1_STATE_DIR/of1-extract-brand-voice-status.json" <<EOF
{"stage":3,"skill":"of1-extract-brand-voice","status":"done","summary":"Brand voice written to DA /of1/brand-voice: [personality adjectives]. [N] words we use, [M] words we avoid."}
EOF
```

The driver waits for both `of1-extract-brand-voice-status.json` and `of1-extract-content-status.json` (the content track) before treating the content pair as complete.
