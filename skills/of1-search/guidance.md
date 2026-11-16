# Guidance: brand voice and suggestion chips

## Brand voice (`set_area` area `site`, key `brandVoice`)

Read 3-5 real pages (home page, a detail page, an About or editorial page) from the site's `.plain.html` (the authored copy without chrome). Do not guess URLs: take them from the navigation or the index.

Write plain text, at most 4000 characters, with exactly these four parts:

- Personality: 3-5 adjectives.
- Tone: one or two sentences.
- Words we use: 10-15 domain terms the brand uses without explanation.
- Words we avoid: words and phrases the brand never uses.

Be specific; the generator injects this text into its prompt, so a vague voice gives off-brand pages. `brandVoice` is a key of the `site` area: call `set_area` with the whole `site` area as read from `get_setup`, keeping every other key, and add only `brandVoice`. Never replace a non-empty `brandVoice`.

## Suggestion chips (`set_suggestions`)

8-12 chips, each `{ label, query }`: `label` 1-60 characters (aim under 40), `query` 1-200 characters, written the way a visitor would type it.

- Only real subjects: page titles and headings of the indexed pages. Never invent products from memory.
- Respect the brand voice: prefer "Words we use", avoid "Words we avoid".
- Spread over the five intents:
  - `deep-dive`: "Tell me about [specific item]"
  - `comparison`: "Compare [A] vs [B]"
  - `recommendation`: "Best [category] for [need]"
  - `discovery`: "Show me [broad category]"
  - `budget`: "[Category] under [price]". If the site shows no prices (services, institutions, B2B, content), never invent one: use a cost or effort angle on real content ("Free resources to get started", "Quickest way to start with [real program]").
- Never replace existing chips.
