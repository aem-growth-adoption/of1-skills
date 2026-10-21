---
name: of1-migrate
description: Migrate an EDS repo from the legacy OF1 setup (git-tracked of1/config/config.json / cta-template.json, triple tenant id) to the new tenant system (config as DA sheets, tenant id org/repo). Run when of1-check-dependencies stops with "Legacy OF1 setup found".
user-invocable: true
---

# OF1 Migrate

Moves one repo's OF1 config from git into DA sheets, syncs the new tenant (`org/repo`, both stages), verifies, and only then removes the git config. Run it from a top-level context in the EDS repo checkout.

- OF1 setup runs from the **`main` branch** (the Helix ref is not a tenant concept; no `ref` is sent). Any other checked-out branch stops with "OF1 setup runs from the main branch (checkout main)". Never merges or switches branches.
- Never calls admin APIs. gen-web keeps using its legacy layout while legacy data exists for the repo: the publish sync then returns HTTP 409 `Tenant not migrated`, and the run stops with `legacy-tenant-present` (git config untouched). An admin must delete the legacy tenant (`DELETE /api/admin/tenants/<legacy id>`, the next sync recreates it from DA) or run `POST /api/admin/migrate-tenants?tenant=<org>/<repo>`; then re-run.
- Idempotent: a failed run leaves the git config in place; fix and repeat. Removal (step 3) runs **last**.

## Env

`OF1_DEMO_REPO` (repo path), `OF1_STATE_DIR` (state dir), `SKILL_DIR` (this skill), a DA token (`ADOBE_IMS_TOKEN` / `OF1_TOKEN_FILE`), optional `OF1_PUBLISH_LIVE=1` (argument `publish-live`: publish config sheets and pages live before the publish sync), `OF1_GENWEB_URL`. If `repo-config.json` is missing it is derived from `git remote origin`.

## Steps (run in this order: 01, 02, 04, 05, 03, 06)

| Script | What it does |
|---|---|
| `01-detect.sh` | Lists every git-tracked `of1/config/*` (local checkout or `origin/main`) marked `convert` (`config.json`, `cta-template.json`) or `keep` (everything else), or finds a triple `TENANT_ID` in `repo-config.json`. Nothing to convert (kept-only repos included): writes `status: already-new` and stops (exit 0). Warns about untracked `of1/config` files |
| `02-config-to-da.sh` | Reads git `config.json` (nested keys become dotted rows, `templates.names`/`contentIngestion.includePaths` comma-joined) and `cta-template.json`, writes the DA sheets `of1/config/config` and `of1/config/cta-template` (`key,value`) and previews them. Fails, naming the key, on values a sheet cannot hold losslessly (other arrays, null, `{}`, `"123"`/`"true"` strings, dotted keys) |
| `04-sync.sh` | Preview sync, optional live publish (`publish-live.json`), publish sync (no `ref`) |
| `05-verify.sh` | Runs publish checks 2, 3 and 6; all must pass (writes the `migrate-verified` marker) |
| `03-remove-git-config.sh` | LAST: `git rm` only the files 02 converted (list in `migrate-converted.txt`), commit by pathspec, `git_push_rebased`. Refuses without the verified marker; a failed push undoes the local removal. Other tracked `of1/config` files (e.g. `signals.json`, `context-endpoints.json`, which the edge proxy reads from git) stay |
| `06-report.sh` | Writes `$OF1_STATE_DIR/of1-migrate-result.json`; exit 1 unless migrated |

Run each as `bash "$SKILL_DIR/scripts/<name>"`; stop at the first non-zero exit except `06-report.sh`, which you always run last (also on failure).

```bash
export SKILL_DIR OF1_DEMO_REPO OF1_STATE_DIR
for s in 01-detect 02-config-to-da 04-sync 05-verify 03-remove-git-config; do
  bash "$SKILL_DIR/scripts/$s.sh" || break
  # 01 on an already-new repo wrote the result: skip the rest
  [ "$s" = 01-detect ] && [ "$(jq -r .status "$OF1_STATE_DIR/of1-migrate-result.json" 2>/dev/null)" = already-new ] && break
done
bash "$SKILL_DIR/scripts/06-report.sh"
```

## Result file

`$OF1_STATE_DIR/of1-migrate-result.json`:

```json
{ "status": "migrated|already-new|failed", "repo": "org/repo",
  "tenant": "org/repo", "checks": {"2": true, "3": true, "6": true},
  "errors": [{"step": "check 2", "error": "..."}],
  "keptInGit": ["of1/config/signals.json"], "warnings": ["..."] }
```

## Failure flow

- Sync rejected (401/403): refresh the DA token, re-run from step 2.
- Check 2 fails: read `hub/sync-*.json`; fix the cause (knowledge pages not previewed, index) and re-run from `04-sync.sh`.
- The git config is deleted only after checks 2, 3, 6 pass, so any failed run can simply be repeated.
- After `migrated`, re-run `of1-publish` (its check 1 now passes).
- `keptInGit` lists tracked `of1/config` files left in place. `warnings` flags legacy catalogs the worker no longer reads (brand-voice, personas, suggestions, products, knowledge, knowledge-pages, use-cases, of1-endpoint, templates `.json`: delete by hand) and `signals.json` / `context-endpoints.json` (still read by the proxy from git: they stay).

## Batch

`node "$SKILL_DIR/assets/batch.mjs" --org <org> --repos <file|auto> [--dry-run] [--out <dir>]` clones each repo (shallow, temp dir, git credentials only) and prints one line per repo (with `keptInGit=<n>` and warnings) plus a summary (total `keptInGit`). `auto` lists the org's repos without forks and archived ones and prints the list. Default `--dry-run` only detects (`would-migrate` / `already-new`). `--no-dry-run` runs the steps in each clone and needs `--repos <file>` or `--yes`; each repo's result JSON (with errors) is kept in `--out` (default `./of1-migrate-results`).
