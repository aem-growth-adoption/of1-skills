---
name: of1-migrate
description: Migrate an EDS repo from the legacy OF1 setup (git-tracked of1/config/*, triple tenant id) to the new tenant system (config as DA sheets, tenant id org/repo). Run when of1-check-dependencies stops with "Legacy OF1 setup found".
user-invocable: true
---

# OF1 Migrate

Moves one repo's OF1 config from git into DA sheets, syncs the new tenant (`org/repo`, both stages), verifies, and only then removes the git config. Run it from a top-level context in the EDS repo checkout.

- The **branch is the current checkout branch**; it is passed to the worker as `ref`. Never merges or switches branches.
- Never touches the legacy gen-web tenant (the triple-form id); it only creates/updates the new `org/repo` tenant.
- Idempotent: a failed run leaves the git config in place; fix and repeat. Removal (step 3) runs **last**.

## Env

`OF1_DEMO_REPO` (repo path), `OF1_STATE_DIR` (state dir), `SKILL_DIR` (this skill), a DA token (`ADOBE_IMS_TOKEN` / `OF1_TOKEN_FILE`), optional `OF1_PUBLISH_LIVE=1` (argument `publish-live`: publish config sheets and pages live before the publish sync), `OF1_GENWEB_URL`. If `repo-config.json` is missing it is derived from `git remote origin` and the current branch.

## Steps (run in this order)

| Order | Script | What it does |
|---|---|---|
| 1 | `01-detect.sh` | Finds git-tracked `of1/config/*` or a triple `TENANT_ID` in `repo-config.json`. Nothing: writes `status: already-new` and stops (exit 0) |
| 2 | `02-config-to-da.sh` | Reads git `config.json` (nested keys become dotted rows) and `cta-template.json`, writes the DA sheets `of1/config/config` and `of1/config/cta-template` (`key,value`) and previews them |
| 3 | `04-sync.sh` | Preview sync, optional live publish, publish sync (`ref=<branch>`) |
| 4 | `05-verify.sh` | Runs publish checks 2, 3 and 6; all must pass (writes the `migrate-verified` marker) |
| 5 | `03-remove-git-config.sh` | `git rm of1/config`, commit by pathspec, `git_push_rebased`. Refuses without the verified marker |
| 6 | `06-report.sh` | Writes `$OF1_STATE_DIR/of1-migrate-result.json`; exit 1 unless migrated |

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
{ "status": "migrated|already-new|failed", "repo": "org/repo", "ref": "main",
  "tenant": "org/repo", "checks": {"2": true, "3": true, "6": true},
  "errors": [{"step": "check 2", "error": "..."}] }
```

## Failure flow

- Sync rejected (401/403): refresh the DA token, re-run from step 2.
- Check 2 fails: read `hub/sync-*.json`; fix the cause (knowledge pages not previewed, index) and re-run from `04-sync.sh`.
- The git config is deleted only after checks 2, 3, 6 pass, so any failed run can simply be repeated.
- After `migrated`, re-run `of1-publish` (its check 1 now passes).

## Batch

`node "$SKILL_DIR/assets/batch.mjs" --org <org> --repos <file|auto> [--dry-run]` clones each repo (shallow, temp dir, git credentials only) and prints one line per repo plus a summary. The default `--dry-run` only detects (`would-migrate` / `already-new`). `--no-dry-run` runs the steps above in each clone.
