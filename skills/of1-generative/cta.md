# CTA host block

The generative call-to-action is a normal block of the site whose text cells carry `{{generate: …}}{{default: …}}` markers.

## Pick the host block

1. Look in `blocks/` for `cta`, `banner`, then `teaser`. Use the first one that exists: its own styling then applies and nothing new is delivered. Read its JS to see which rows it expects (heading, text, button) and build the section with that shape.
2. None exists: create `blocks/of1-cta/` with `of1-cta.js` and `of1-cta.css`, styled from `stardust/current/DESIGN.json` when it exists (colors, radius, spacing), else from the site's own `styles/styles.css` variables.
   - The JS reads the three rows (`h2`, `p`, `p > a`), adds the classes `button` to the link, and nothing else. The markers are plain text; the page is rendered with the default text until the proxy generates.
   - **Never set `font-family`** in the block's CSS. The block inherits the site's fonts; a hard-coded family broke the text of customer sites. Use `font: inherit` where a reset is needed.
   - Use the site's CSS variables for colors and spacing where they exist; add no global selectors, scope every rule under `.of1-cta`.

## Rules for the text

- `heading`: the instruction names the visitor need to answer (for example "one line that points the visitor to the product that fits what they just read"); the default is the site's own existing call to action or a plain "Learn more".
- `text`: 1-2 sentences. `label`: 2-4 words. The default of each is complete, static and true on its own.
- No `}` character in instructions or defaults (the marker helper refuses it).
- The button `href` is `/of1`.
