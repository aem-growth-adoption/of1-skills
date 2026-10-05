# Sync OF1 — DA app (author-facing re-sync)

After OF1 is deployed to a site, its author-tunable config lives in DA: the brand voice doc `/of1/brand-voice`, the sheets `/of1/config/personas` and `/of1/config/suggestions`, the optional strategy doc `/of1/strategy`, the template docs under `/templates/`, and the knowledge pages under `/of1/knowledge/`. Only `of1/config/config.json` (and, in pipeline mode, `cta-template.json`) is in git. The gen-web worker only sees changes after the edited doc is **previewed** and a **sync** (`POST /api/tenants/{id}/sync`) re-pulls the config into R2 and re-indexes the knowledge pages. The **Sync OF1** DA app gives authors a one-click way to trigger that sync from inside the DA editor — no CLI, no manual `curl`.

This is optional and separate from `of1-publish` (which does the initial deploy). It's what an author uses to push *later* content edits.

## App URL

- **Production:** `https://of1-gen-web-service.franklin-prod.workers.dev/da-app`
- Dev: `https://of1-gen-web-service-dev.franklin-prod.workers.dev/da-app`

Served by the of1-gen-web worker at `/da-app`. Deploys are branch-driven: `main` → dev worker; the `main → prod` promotion PR → prod worker. Register the **production** URL for real sites.

## Install it on a site

DA reads a sheet named **`library`** from its config. Add one row via the **Config editor** (`https://da.live/apps` → *Config editor* → open `<org>/<site>`):

| title    | path                                                          | ref  | experience |
|----------|---------------------------------------------------------------|------|------------|
| Sync OF1 | `https://of1-gen-web-service.franklin-prod.workers.dev/da-app` | main | inline     |

- `path` — the **absolute** URL above (relative paths resolve to the site's `aem.live` host, not the worker).
- `experience` — `inline` (panel) or `dialog` (modal). **Never `window`** (it never hands the app its DA context, so it hangs on "Loading DA context…").
- `ref` — `main` or empty, else the row is hidden.

### Org-level vs site-level

- The **canvas editor** (`da.live/canvas#/…`) merges the **org** and **site** `library` sheets, so a single **org-level** row (`admin.da.live/config/<org>`) registers the app on every site in the org.
- The **classic editor** reads the **site** sheet only — register per-site there.

### of1-labs lab sites

Nothing installs this row automatically — lab sites need the same manual `library` row as any other site (an org-level row covers every lab site in the org for the canvas editor).

## Use it

1. Open (and preview) an OF1 doc in DA so the app can scope to it. The app maps the open path to a sync file:

   | DA path | Sync file |
   |---|---|
   | `/of1/brand-voice` | `brand-voice` |
   | `/of1/strategy` | `strategy` |
   | `/of1/config/<f>` (e.g. `personas`, `suggestions`) | `<f>` |
   | `/templates/*` | `templates` |
   | `/of1/knowledge/*` | `content` |

   The worker's sync file names are `config`, `brand-voice`, `suggestions`, `cta-template`, `strategy`, `templates`, `content` (plus `audiences`, `generative-images`, `generative-fragments`, which these skills don't produce). Personas aren't synced to the worker — they're read straight from the sheet's `.json` URL by the preview extension / edge proxy.
2. Open **Sync OF1**:
   - **Canvas editor:** the **Tools panel on the right** → **Extensions** group → **Sync OF1**.
   - **Classic editor:** the **Library** panel → **Sync OF1**.
3. Click **Sync this file** (scoped) or **Sync all**. Status shows `synced` / `errors` / `content.indexed` (knowledge chunks).

## Tenant id

Derived as `main--{repo}--{org}` (DA hardcodes `ref=main`; `org`/`repo` come from the open doc path). This must match the site's `aem.page` host label, which is where the worker fetches config from. If nothing syncs, confirm the edited DA docs/sheets are previewed on that tier.

Full operator reference: of1-gen-web-service `worker/docs/da-sync-app.md`.
