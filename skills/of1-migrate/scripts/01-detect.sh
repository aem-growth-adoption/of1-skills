#!/usr/bin/env bash
# Step 1: detect a legacy setup (git-tracked of1/config/* or a triple tenant id). Nothing found -> already-new result, exit 0.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
rm -f "$ERRORS" "$RESULT" "$OF1_STATE_DIR"/migrate-{verified,removed}
TRACKED=$(git ls-files of1/config)
git fetch -q origin main 2>/dev/null
REMOTE=$(git ls-tree -r --name-only origin/main -- of1/config 2>/dev/null)
[ -z "$TRACKED" ] && TRACKED="$REMOTE"
UNTRACKED=$(git ls-files --others of1/config)
[ -z "$UNTRACKED" ] || { echo "⚠ untracked files under of1/config (not migrated, not removed):"; printf '%s\n' "$UNTRACKED" | sed 's/^/    /'; }
TRIPLE=$(jq -r '.TENANT_ID // .tenantId // empty | select(test("--"))' "$OF1_STATE_DIR/repo-config.json" 2>/dev/null)
# Only files 02 converts are removed; every other tracked file stays in git and is reported.
jq -n --arg t "$TRACKED" --arg tr "$TRIPLE" '
  def legacy: ["brand-voice","personas","suggestions","products","knowledge","knowledge-pages","use-cases","of1-endpoint","templates"] | map("of1/config/\(.).json");
  def proxy: ["signals","context-endpoints"] | map("of1/config/\(.).json");
  ($t | split("\n") | map(select(. != ""))) as $all
  | ["of1/config/config.json","of1/config/cta-template.json"] as $conv
  | ($all | map(select(IN($conv[])))) as $c | ($all - $c) as $k
  | {tracked: $all, convert: $c, keep: $k, triple: $tr,
     warnings: (($k | map(select(IN(legacy[])) | "\(.) is a legacy catalog the worker no longer reads; it can be deleted by hand"))
       + ($k | map(select(IN(proxy[])) | "\(.) is still read by the edge proxy from git; it stays")))}' > "$OF1_STATE_DIR/migrate-detect.json"
rm -f "$OF1_STATE_DIR/migrate-converted.txt"
SHOW='(.convert[] | "    convert  \(.)"), (.keep[] | "    keep     \(.)"), (.warnings[] | "⚠ \(.)")'
if [ -z "$(jq -r '.convert[]' "$OF1_STATE_DIR/migrate-detect.json")" ] && [ -z "$TRIPLE" ]; then
  jq -n --arg r "${OWNER}/${REPO}" --arg t "$TENANT_ID" --slurpfile d "$OF1_STATE_DIR/migrate-detect.json" \
    '{status:"already-new", repo:$r, tenant:$t, checks:{}, errors:[], keptInGit:$d[0].keep, warnings:$d[0].warnings}' > "$RESULT"
  echo "already-new: nothing to migrate in ${OWNER}/${REPO}"
  jq -r "$SHOW" "$OF1_STATE_DIR/migrate-detect.json"; exit 0
fi
echo "legacy setup found in ${OWNER}/${REPO}:"
jq -r "$SHOW" "$OF1_STATE_DIR/migrate-detect.json"
[ -z "$TRIPLE" ] || echo "    tenant id ${TRIPLE} (triple form)"
