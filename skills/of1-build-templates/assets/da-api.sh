#!/usr/bin/env bash
# DA API helpers for authoring block templates. Verified live 2026-08-10
# against of1-labs/of1-af1bb1a3 — see the design spec's "Verification
# Results" section for the exact request/response pairs this mirrors.
#
# Required env vars: DA_TOKEN (DA write access), ORG, REPO.
# Required for aem_preview only: AEM preview/publish rights on ORG — this is
# a SEPARATE grant from DA_TOKEN's write access (see aem_preview below and
# the design spec's "Blocked" finding). aem_preview fails loudly rather than
# silently if this is missing.
set -euo pipefail

: "${DA_TOKEN:?DA_TOKEN is required}"
: "${ORG:?ORG is required}"
: "${REPO:?REPO is required}"

# da_put <local-file> <remote-path>  e.g. da_put ./doc.html templates/comparison-a.html
da_put() {
  local local_file="$1" remote_path="$2"
  curl -sS -X POST \
    "https://admin.da.live/source/${ORG}/${REPO}/${remote_path}" \
    -H "Authorization: Bearer ${DA_TOKEN}" \
    -H "x-content-source-authorization: Bearer ${DA_TOKEN}" \
    -F "data=@${local_file};type=text/html"
}

# da_delete <remote-path>  e.g. da_delete templates/comparison-a.html
da_delete() {
  local remote_path="$1"
  curl -sS -X DELETE \
    "https://admin.da.live/source/${ORG}/${REPO}/${remote_path}" \
    -H "Authorization: Bearer ${DA_TOKEN}"
}

# da_list <remote-path>  e.g. da_list templates
da_list() {
  local remote_path="$1"
  curl -sS "https://admin.da.live/list/${ORG}/${REPO}/${remote_path}" \
    -H "Authorization: Bearer ${DA_TOKEN}"
}

# aem_preview <path> — requires AEM write authorization, separate from
# DA_TOKEN. Exits non-zero with a clear diagnostic on 403 rather than
# reporting success after a DA write that never actually became visible to
# the worker's sync (design spec: "the skill should fail loudly ... rather
# than reporting success after a successful DA write").
aem_preview() {
  local path="$1"
  local body status
  body=$(curl -sS -w '\n%{http_code}' -X POST \
    "https://admin.hlx.page/preview/${ORG}/${REPO}/main/${path}" \
    -H "Authorization: Bearer ${AEM_TOKEN:?AEM_TOKEN is required for preview}")
  status=$(tail -n1 <<<"$body")
  if [[ "$status" != "200" && "$status" != "201" ]]; then
    echo "aem_preview FAILED (${status}) for ${path} — this account likely has DA write access but NOT AEM preview/publish rights on ${ORG}. A document written to DA without a successful preview is invisible to the worker's sync; do not report this template as ready." >&2
    return 1
  fi
  echo "aem_preview OK for ${path}"
}
