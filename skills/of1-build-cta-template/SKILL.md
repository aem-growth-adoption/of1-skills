---
name: of1-build-cta-template
description: Extract a site's visual design system and generate a branded CTA template (DA sheet /of1/config/cta-template), served by the gen-web worker via /api/personalize inject_cta for personalized CTA injection
user-invocable: true
---

# CTA Template Builder

Analyze a website's visual design system (colors, button styles, spacing) and generate a branded HTML CTA template with slot placeholders. The gen-web worker syncs it as `cta-template` and serves it via `/api/personalize` (`inject_cta`), so the injected personalized call-to-action looks native to the site.

## Env — the driver exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-build-cta-template-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local EDS site repo |

```bash
cd "$OF1_DEMO_REPO"
mkdir -p of1/config
```

Read existing design tokens (from the extraction step, `of1-extract-design` / `stardust:extract`) — use for colors, button styles, border-radius (not fonts: the host page supplies those). Only WebFetch the site if you need CTA-specific details not in the tokens. **Resolve the spec via the shared resolver** (`of1-integration/knowledge/design-tokens-resolution.md`) — `DESIGN.json` lives at `stardust/current/DESIGN.json` (written by `of1-extract-design`), and `styles/styles.css` is a valid token source for a live site:
```bash
DESIGN_JSON=""
if [ -f stardust/current/DESIGN.json ]; then DESIGN_JSON="stardust/current/DESIGN.json"; fi
[ -n "$DESIGN_JSON" ] && cat "$DESIGN_JSON"
# If neither DESIGN.json nor styles/styles.css exists, stop — do not invent tokens.
```

Schema reference: `of1-integration/knowledge/worker-config-schemas.md` § `cta-template` (DA sheet `/of1/config/cta-template`, only with `cta-template`).

## Output

`$OF1_STATE_DIR/cta-template.json` (working file, never committed to git):

```json
{
  "html": "<div style=\"...\"><h2 style=\"...\">{{title}}</h2><p style=\"...\">{{description}}</p><a href=\"{{href}}\" style=\"...\">{{buttonText}}</a></div>",
  "fallback": {
    "title": "...",
    "description": "...",
    "buttonText": "..."
  }
}
```

**Important:** The `{{href}}` placeholder is not a fill-in field — it's resolved at runtime by the worker to the tenant's OF1 endpoint URL with `?personalize=1`.

## Process

### 1. Read the site's visual design from the resolved tokens

`DESIGN.json` (resolved above) already carries everything the CTA needs — it was measured from the
real site by `stardust:extract`, so prefer it over re-deriving from HTML. Read:
- **Typography** → `typography.heading` / `typography.body` `weight`, `letterSpacing`, `lineHeight` (never `family`: see step 2)
- **Colors** → `colors.{primary, secondary, accent, background, surface, text, muted}`
- **Button style** → `components.button.{radius, padding, weight, textTransform}`
- **Section / theme cues** → `colors.background`/`surface`, `spacing.{section, component}`, `components.hero.{style, overlay}`, `components.card.radius`, `rounded`

**Only WebFetch the homepage** if `DESIGN.json` is absent (the resolver above would have left `$DESIGN_JSON` empty) OR you need a CTA-specific detail the tokens genuinely don't capture (e.g. a distinctive section background treatment you can't infer from the token set). Do not re-derive fonts/colors/button styling by fetching when the tokens already provide them — the tokens are higher-fidelity than an HTML guess and the extraction already paid for them.

### 2. Determine the CTA visual treatment

- **Background:** usually dark (matches hero/footer tone) or a prominent section style
- **Heading:** white or light color, bold weight, ~2rem. **Do not set `font-family`**: the CTA is also injected into pages served from the tenant's real domain, where the EDS replica's font names (e.g. `amag_display`) do not exist and the browser falls back to Arial. With no `font-family` the host page's own heading and body fonts apply on every page (`write-cta-template.sh` rejects a `font-family`)
- **Description:** lighter/muted color, regular weight, ~1.1rem
- **Button:** brand's actual button style (color, radius, padding, text-transform)
- **Container:** 3–4rem vertical padding, 2rem horizontal, text-align center

The CTA should look like a native section on the site — not a generic overlay.

### 3. Build the HTML template

Self-contained HTML block using **inline styles only** (no external CSS, no `font-family`). Must include exactly these placeholders:

- `{{title}}` — personalized heading (5–10 words)
- `{{description}}` — personalized body text (1 sentence)
- `{{href}}` — resolved at runtime (not a fill-in field)
- `{{buttonText}}` — personalized button label (2–4 words)

```html
<div style="[background, padding, text-align, margin, border-radius]">
  <h2 style="[color, font-size, font-weight, margin, line-height]">{{title}}</h2>
  <p style="[color, font-size, margin, max-width, line-height]">{{description}}</p>
  <a href="{{href}}" style="[display, background, color, font-size, font-weight, padding, border-radius, text-decoration, text-transform]">{{buttonText}}</a>
</div>
```

### 4. Write fallback content

Generate appropriate static fallback content that fits the brand:
- **title:** generic but relevant to the site's primary offering (5–10 words)
- **description:** invites exploration, 1 sentence
- **buttonText:** action-oriented, 2–4 words

### 5. Write the DA sheet `/of1/config/cta-template`

Ensure:
- HTML is on a single line (no newlines inside the `html` field)
- All double quotes inside the HTML use escaped `\"`
- No trailing commas

Then upload it as a `key,value` sheet (`html`, `fallback.title`, `fallback.description`, `fallback.buttonText`) and preview it:

```bash
bash "$SKILL_DIR/scripts/write-cta-template.sh" "$OF1_STATE_DIR/cta-template.json"
```

## Quality checklist

- [ ] Template sets **no** `font-family` anywhere (the host page's fonts apply; sizes, weights, colours and spacing carry the brand look)
- [ ] Button style matches the site's real button design (color, radius, text-transform)
- [ ] Background color is appropriate (typically dark, matching the site's dark sections)
- [ ] The CTA would not look out of place if screenshot alongside the actual site
- [ ] Fallback content is specific to the brand/industry, not generic
- [ ] HTML is valid, self-contained, uses only inline styles

## Example

**Frescopa (frescopa.coffee):**
- Deep-wine bg (#58181D), teal pill button (#00647D), rounded card with generous padding (no font-family: the page's own Baskerville / Roboto apply)
- Fallback: "Find Your Perfect Brew" / "Discover handcrafted coffee and machines tailored to your taste." / "Explore Now"

## Completion

```bash
cat > "$OF1_STATE_DIR/of1-build-cta-template-status.json" <<EOF
{"stage":3,"skill":"of1-build-cta-template","status":"done","summary":"CTA template generated: [brief visual description]"}
EOF
```
