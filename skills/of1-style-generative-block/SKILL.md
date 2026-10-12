---
name: of1-style-generative-block
description: Generate polished CSS for the OF1 generative block AND set up the /of1 page end-to-end (block install, branded block CSS, DA content) as an ordinary EDS content page.
user-invocable: true
---

# Generative Block Styler

Own the `/of1` page top to bottom: install the block, generate brand-aligned CSS for it, and upload the DA content document that makes the page renderable. `/of1` is authored exactly like any other EDS content page — the site's existing header/footer blocks and `styles/styles.css` apply automatically; there is no page-template or overlay mechanism to work around.

## Env — the driver exports these (see `of1-check-dependencies`)

| Var | Purpose |
|-----|---------|
| `OF1_STATE_DIR` | state + IPC dir; receives `of1-style-generative-block-status.json` |
| `OF1_DEMO_REPO` | absolute path to the local EDS site repo |
| `SKILL_DIR` | absolute path to this skill's directory |
| `ADOBE_IMS_TOKEN` | raw DA token (preferred) |
| `OF1_TOKEN_FILE` | path to a `{"access_token":"…"}` JSON (fallback) |

Each step is a script in `$SKILL_DIR/scripts/` (run `bash "$SKILL_DIR/scripts/<name>"`); they resolve repo config from `repo-config.json`, the DA token (`ADOBE_IMS_TOKEN` → `OF1_TOKEN_FILE` → `.hlx/.da-token.json`) and probe it before any write. `OF1_GENWEB_URL` optionally points the live page at a dev worker.

## CRITICAL RULES

1. **NEVER modify `blocks/of1/of1.js`** — the OF1 block JavaScript is shared infrastructure and must not be changed. Only the CSS (`blocks/of1/of1.css`) is customized per brand.
2. **This skill OWNS the block install.** Always copy `of1.js` and `of1.css` fresh from `$SKILL_DIR/assets/` to `blocks/of1/` — never reuse whatever exists in the demo repo (may be stale from a previous run).
3. **Style using brand tokens from stardust** — read `DESIGN.json` (resolve its path via `of1-integration/knowledge/design-tokens-resolution.md` — `stardust/current/` OR `./`), `DESIGN.md`, and the `:root` tokens in `styles/styles.css`. The OF1 block must feel native to the brand, not a generic overlay.
4. **Commit BOTH `of1.js` and `of1.css`** — `of1.js` deployed as-is alongside your styled `of1.css`. Always `git add blocks/of1/` to include both. Missing JS = blank page.

## Why this skill exists

The OF1 block renders its own UI — search landing (title, input, chips), loading skeleton, a container for streamed sections, follow-up controls. This skill writes `blocks/of1/of1.css` so that UI feels native to the brand. The **per-section visual design** comes from each block's own code-bus stylesheet (`blocks/<name>/<name>.css`), loaded when the OF1 client SDK runs the site's real `decorate()` pipeline (the worker emits `stylesheet: null`); those blocks and CSS are authored by `of1-build-templates`. This skill does NOT style section internals. Page chrome is inherited since `/of1` is an ordinary content page.

Canonical sources are this skill's `assets/of1.js` (copied as-is) and `assets/of1.css` (copied, then customized in place) — never whatever is in the demo repo.

## Process

### Step 0 — Install block files

```bash
bash "$SKILL_DIR/scripts/install-block.sh"   # fresh of1.js + of1.css into $OF1_DEMO_REPO/blocks/of1/
```

`/of1` is authored as an ordinary content page (Step 5): header/footer blocks load `/nav`/`/footer` automatically and the `of1` block decorates like any other — no page-template/overlay engine is involved.

### Step 1 — Read design context

- `DESIGN.json` — tokens (colors, fonts, spacing, radius); resolve its path via `of1-integration/knowledge/design-tokens-resolution.md` (written by `of1-extract-design` to `stardust/current/`), plus `stardust/current/DESIGN.md`.
- `styles/styles.css` — the deployed CSS custom properties (authoritative). If neither `DESIGN.json` nor `styles/styles.css` exists, stop and report — do not invent tokens.
- `blocks/of1/of1.css` — the freshly-copied template to customize.

### Step 2 — Block UI scope

The CSS covers only the block's own UI (NOT generated-section internals): search landing (title, subtitle, input + submit, chips), loading skeleton, follow-up suggestions (chips, hover, custom input, restart), section container + fade/slide-up animation, and the `?debug` panel. Use the site's actual custom properties (`var(--primary-color)`, …) and match its aesthetic (light/dark, radius, typography).

### Step 3 — Customize `blocks/of1/of1.css` for the brand

**This is what EDS auto-loads for the OF1 block** — the block UI styling goes only in `blocks/of1/of1.css`, **never** `styles/styles.css` (the site's shared foundation stylesheet). Step 0 copied the unbranded template; edit it in place: replace ALL generic token values (`#000000`, `system-ui`) with brand values from `DESIGN.json`, and add brand-specific enhancements to the block's own UI.

The file is organized into these sections (keep the structure; just retune the values):

```
/* ─── Brand Token Mapping ─── */
/* ─── Container & Layout ─── */
/* ─── Search Landing UI ─── */
/* ─── Input & Submit ─── */
/* ─── Quick Suggestion Chips ─── */
/* ─── Loading Skeleton ─── */
/* ─── Generated Sections (container + fade-in only) ─── */
/* ─── Follow-up Suggestions ─── */
/* ─── Responsive ─── */
```

Do NOT add rules that target generated-section internals (`.generated-section .hero`, `.cards`, `.table`, `.columns`) — that content is the site's own EDS blocks, styled by each block's code-bus CSS (`blocks/<name>/<name>.css`).

### Step 4 — Guarantee the site's /nav and /footer exist

Header/footer blocks fetch `/nav` and `/footer` on every page; if either is missing, every page (incl. `/of1`) renders chromeless. They should already exist (site or migration step), but guarantee them regardless of provenance:

```bash
node "$SKILL_DIR/assets/ensure-nav-footer.mjs"
```

Idempotent, **never overwrites** an existing chrome doc; on a missing one it authors a minimal branded fragment linking only to pages deployed on this branch. Exits 1 if a fragment still can't be made live — a chromeless demo must not proceed silently.

### Step 5 — Upload OF1 DA content + gate (5b)

```bash
bash "$SKILL_DIR/scripts/upload-of1-page.sh"
```

PUTs the `/of1` doc (a `metadata` block + an `of1` block table: `api-endpoint`, `domain`, `engine` = `da-blocks-slots`, plus `title`/`subtitle`/`placeholder` rows from `$OF1_STATE_DIR/of1-landing.json` when present, HTML-escaped), triggers the preview, then gates: `/of1.plain.html` must return 200 **and** contain the `engine` row (a bare 200 could be a stale/foreign page). Exits 1 on any failure — **do not continue until it passes**. `of1-publish` step 2 runs this same script.

**Never include a `<title>` tag in the DA HTML** — EDS renders it as visible content.

**Landing copy is author-editable**: the SDK reads those rows (EDS `readBlockConfig` lowercases keys); absent rows fall back to SDK defaults. The script PUTs the whole doc, so re-running it (including `of1-publish` step 2) **resets** the rows to `of1-landing.json`, overwriting DA edits — re-apply them afterwards or update `of1-landing.json` first. If `of1-build-quick-suggestions` ran after this step, re-run it to add the rows.

| Symptom | Cause / fix |
|---|---|
| 401 on preview | Missing `x-content-source-authorization` or expired token — re-authenticate |
| 404 on /of1 | PUT failed — check its output and the `admin.da.live/source/...` path |
| 200 but no `engine` | Stale preview of an older doc, or PUT targeted another org/repo |

### Step 6 — Commit and push

```bash
bash "$SKILL_DIR/scripts/commit-block.sh"   # git add blocks/of1/ (both files), commit, rebase-push
```

### Step 7 — Verify the live page (and 7b generated content)

```bash
bash "$SKILL_DIR/scripts/verify-live.sh"
```

Opens `/of1` with playwright, prints `header OK`/`footer OK`/`of1 block OK`/`search UI OK` (or the `… MISSING` variant), screenshots to `$OF1_STATE_DIR/of1-render-check.png`, then (7b) clicks the first chip and screenshots `of1-generated-check.png`. Open the screenshots: branded nav on top, footer at the bottom, search UI (title, input, chips) in the middle.

**7b is advisory** while templates aren't synced: this skill runs before `of1-publish` syncs the tenant, so a query may render nothing (`hasTemplates` false); `of1-publish` check 6 is the real generation gate. Skip 7b if chips are absent and note it in the summary. When synced, confirm the generated sections are styled (they are the site's own blocks styled by their code-bus CSS — a smoke test, not a check of `of1.css`).

| Symptom | Likely cause |
|---|---|
| `HEADER/FOOTER MISSING` | `/nav` or `/footer` missing — re-run Step 4 |
| `OF1 BLOCK MISSING` | `blocks/of1/of1.js` not pushed, or the block table's `th` isn't exactly `of1` |
| `SEARCH UI MISSING` | SDK didn't load — `api-endpoint` row must reach a worker (`<worker>/sdk/of1-client.js` 200); check console |
| Unstyled links / system font | `styles/styles.css` not deployed yet, or preview is stale |

Fix failures and re-push before Completion. Per-section visual problems are the templates' CSS (`of1-build-templates`), not this skill.

## Completion — HARD STOP for user review

After pushing, mark the step `review` and **STOP** — the user must open the OF1 page, try the chips, and approve (or request revisions) before the driver continues. `of1-publish` cannot start until both `of1-build-templates` (assemble) and this skill are approved.

```bash
OF1_URL="https://$(jq -r '"\(.branch)--\(.repo)--\(.owner)"' "$OF1_STATE_DIR/repo-config.json").aem.page/of1"
cat > "$OF1_STATE_DIR/of1-style-generative-block-status.json" <<EOF
{ "stage": 3, "skill": "of1-style-generative-block", "status": "review",
  "deliverables": [ { "url": "${OF1_URL}", "label": "OF1 page" } ],
  "summary": "OF1 page is live with brand-aligned block styling. Open it, try the search chips, and review the design."
}
EOF
```
