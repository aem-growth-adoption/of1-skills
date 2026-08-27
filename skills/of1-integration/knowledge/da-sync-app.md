# Sync OF1 — DA app (author-facing re-sync)

After OF1 is deployed to a site, its knowledge (products, personas, features, FAQs, etc.) lives in `/of1/config/*` documents. The gen-web worker only sees changes after a **sync** (`POST /api/tenants/{id}/sync`) re-pulls those docs into R2 and re-indexes vectors. The **Sync OF1** DA app gives authors a one-click way to trigger that sync from inside the DA editor — no CLI, no manual `curl`.

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

### of1-labs lab sites: automatic

Lab experiments under the **of1-labs** org get this row installed automatically during provisioning — the `DaPermissions` durable object upserts the org-level `library` sheet in the same write that grants DA access (`of1-labs` repo, `service/src/durable-objects/da-permissions.ts`). No manual step for lab sites; the guide above is for non-lab / customer sites.

## Use it

1. Open a doc in DA — ideally an OF1 config doc at `/of1/config/<file>` (e.g. `products`) so the app can scope to it.
2. Open **Sync OF1**:
   - **Canvas editor:** the **Tools panel on the right** → **Extensions** group → **Sync OF1**.
   - **Classic editor:** the **Library** panel → **Sync OF1**.
3. Click **Sync this file** (scoped) or **Sync all**. Status shows `synced` / `errors` / `vectors`.

## Tenant id

Derived as `main--{repo}--{org}` (DA hardcodes `ref=main`; `org`/`repo` come from the open doc path). This must match the site's `aem.page` host label, which is where the worker fetches config from. If nothing syncs, confirm the `/of1/config/*` docs are previewed/published on that tier.

Full operator reference: of1-gen-web-service `worker/docs/da-sync-app.md`.
