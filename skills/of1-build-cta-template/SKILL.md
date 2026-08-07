---
name: of1-build-cta-template
description: Extract a site's visual design system and generate a branded CTA template (cta-template.json) for the OF1 extension's personalized CTA injection
user-invocable: true
---

# CTA Template Builder

Analyze a website's visual design system (fonts, colors, button styles, spacing) and generate a branded HTML CTA template with slot placeholders. The template is used by the OF1 extension to inject a personalized call-to-action that looks native to the site.

## Env — orchestrator exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `step-10-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local `of1-demo-orchestrator` git clone |

Read repo config:

```bash
REPO_CONFIG=$(cat "$OF1_STATE_DIR/repo-config.json")
DOMAIN=$(jq -r .domain <<<"$REPO_CONFIG")
cd "$OF1_DEMO_REPO"
mkdir -p of1/config
```

Read existing design tokens (from step 3 extraction) — use for colors, fonts, button styles, border-radius. Only WebFetch the site if you need CTA-specific details not in the tokens. **Resolve the spec via the shared resolver** (`of1-demo-orchestrator/knowledge/design-tokens-resolution.md`) — `DESIGN.json` may live at `stardust/current/` OR project root (`./`), and `styles/styles.css` is a valid token source for a live site:
```bash
DESIGN_JSON=""
if   [ -f stardust/current/DESIGN.json ]; then DESIGN_JSON="stardust/current/DESIGN.json"
elif [ -f ./DESIGN.json ];               then DESIGN_JSON="./DESIGN.json"
fi
[ -n "$DESIGN_JSON" ] && cat "$DESIGN_JSON"
# If neither DESIGN.json location nor styles/styles.css exists, stop — do not invent tokens.
```

Schema reference: `of1-demo-orchestrator/knowledge/worker-config-schemas.md` § `cta-template.json`.

## Inputs

- `DOMAIN` (e.g. `frescopa.coffee`). In pipeline mode, read from repo-config. Only ask the user if not provided.

## Output

`of1/config/cta-template.json`:

```json
{
  "html": "<div style=\"...\"><h2 style=\"...\">{{title}}</h2><p style=\"...\">{{description}}</p><a href=\"{{href}}\" style=\"...\">{{buttonText}}</a></div>",
  "slots": ["title", "description", "buttonText"],
  "fallback": {
    "title": "...",
    "description": "...",
    "buttonText": "..."
  }
}
```

**Important:** The `{{href}}` placeholder is NOT a slot — it's resolved at runtime by the worker to the tenant's OF1 endpoint URL with `?personalize=1`. Do NOT include `href` in the `slots` array.

## Process

### 1. Analyze the site's visual design

Fetch the homepage and 1–2 key pages using WebFetch. Extract:
- Fonts (heading vs body — custom, web, or system)
- Primary/accent colors, background colors, text colors
- Button style (background, text color, border-radius, padding, text-transform, font-weight, letter-spacing)
- Section styling (dark/light backgrounds, padding/margins)
- Overall theme (dark/light, minimal/rich, sharp/rounded)

### 2. Determine the CTA visual treatment

- **Background:** usually dark (matches hero/footer tone) or a prominent section style
- **Heading:** brand font, white or light color, bold weight, ~2rem
- **Description:** lighter/muted color, regular weight, ~1.1rem
- **Button:** brand's actual button style (color, radius, padding, text-transform)
- **Container:** 3–4rem vertical padding, 2rem horizontal, text-align center

The CTA should look like a native section on the site — not a generic overlay.

### 3. Build the HTML template

Self-contained HTML block using **inline styles only** (no external CSS). Must include exactly these placeholders:

- `{{title}}` — personalized heading (5–10 words)
- `{{description}}` — personalized body text (1 sentence)
- `{{href}}` — resolved at runtime (NOT in slots)
- `{{buttonText}}` — personalized button label (2–4 words)

```html
<div style="[background, padding, text-align, margin, border-radius]">
  <h2 style="[color, font-family, font-size, font-weight, margin, line-height]">{{title}}</h2>
  <p style="[color, font-family, font-size, margin, max-width, line-height]">{{description}}</p>
  <a href="{{href}}" style="[display, background, color, font-family, font-size, font-weight, padding, border-radius, text-decoration, text-transform]">{{buttonText}}</a>
</div>
```

### 4. Write fallback content

Generate appropriate static fallback content that fits the brand:
- **title:** generic but relevant to the site's primary offering (5–10 words)
- **description:** invites exploration, 1 sentence
- **buttonText:** action-oriented, 2–4 words

### 5. Write `of1/config/cta-template.json`

Ensure:
- HTML is on a single line (no newlines inside the `html` field)
- All double quotes inside the HTML use escaped `\"`
- No trailing commas

## Quality checklist

- [ ] Template uses the site's actual font family (not generic sans-serif unless that IS the site's font)
- [ ] Button style matches the site's real button design (color, radius, text-transform)
- [ ] Background color is appropriate (typically dark, matching the site's dark sections)
- [ ] The CTA would not look out of place if screenshot alongside the actual site
- [ ] Fallback content is specific to the brand/industry, not generic
- [ ] HTML is valid, self-contained, uses only inline styles
- [ ] `slots` array contains exactly `["title", "description", "buttonText"]` (NOT href)

## Example

**Frescopa (frescopa.coffee):**
- Deep-wine bg (#58181D), Baskerville heading + Roboto body, teal pill button (#00647D), rounded card with generous padding
- Fallback: "Find Your Perfect Brew" / "Discover handcrafted coffee and machines tailored to your taste." / "Explore Now"

## Completion (pipeline mode)

```bash
cat > "$OF1_STATE_DIR/step-10-status.json" <<EOF
{"step":10,"status":"done","summary":"CTA template generated: [brief visual description]"}
EOF
```
