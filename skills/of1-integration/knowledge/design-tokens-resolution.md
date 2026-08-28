# Design-tokens resolution — one resolver, many citers

Every OF1 skill that needs the site's brand tokens (`of1-integration`,
`of1-build-templates`, `of1-build-cta-template`, `of1-style-generative-block`)
resolves them the **same way**.

## Where `DESIGN.json` actually lives

Stage 2a (`of1-extract-design`, wrapping `stardust:extract`) always writes the design spec to
`stardust/current/DESIGN.json` — there is no bounded/synthesized-spec variant to account for; every
demo run goes through 2a before anything downstream reads brand tokens.

## Resolution order (use this everywhere)

The paths below are relative to the repo root — `cd "$OF1_DEMO_REPO"` first (or prefix each
path with `$OF1_DEMO_REPO/`).

```bash
# Resolve the brand design spec. Written by of1-extract-design (Stage 2a).
DESIGN_JSON=""
if [ -f stardust/current/DESIGN.json ]; then DESIGN_JSON="stardust/current/DESIGN.json"; fi
```

Then, for a brand-token source, prefer `DESIGN.json` but treat the repo's own
deployed stylesheet as a first-class source too:

```bash
# styles/styles.css is authoritative for an already-live EDS site — its :root
# tokens ARE the deployed brand truth, not a guess.
HAS_STYLES_CSS=false; [ -f styles/styles.css ] && HAS_STYLES_CSS=true
```

## Fail loudly — but only when there is genuinely no source

- If **neither** `DESIGN.json` location **nor** `styles/styles.css` exists →
  **stop and report.** Do not invent brand tokens from memory. Write
  `status: "failed"` (or `"review"`) naming the missing brand spec.
- If `DESIGN.json` is missing but `styles/styles.css` exists (common on an
  existing live EDS site) → **that is valid, not a fallback-to-guessing.** The
  deployed stylesheet's `:root` tokens are the ground truth; use them and
  proceed. `DESIGN.json`, when present, is the tiebreaker / fill-in for tokens
  not in `styles.css`.

The rule this replaces: "silently guess tokens when `DESIGN.json` is absent."
Guessing is never allowed. Using the site's real deployed CSS is not guessing.
