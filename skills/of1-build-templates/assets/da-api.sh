#!/usr/bin/env bash
# DA API helpers for authoring block templates. Verified live 2026-08-10
# against of1-labs/of1-af1bb1a3 — see the design spec's "Verification
# Results" section for the exact request/response pairs this mirrors.
#
# Meant to be SOURCED into the agent's shell (bash or zsh). It deliberately
# does NOT `set -euo pipefail` at top level — that would leak into the
# sourcing shell and kill it on the first non-zero command. Each function
# checks its own inputs and returns non-zero instead of exiting.
#
# Required env vars: DA_TOKEN (DA write access), ORG, REPO.
# Optional: BRANCH (preview ref for aem_preview; default "main").
# Required for aem_preview only: AEM preview/publish rights on ORG — this is
# a SEPARATE grant from DA_TOKEN's write access (see aem_preview below and
# the design spec's "Blocked" finding). aem_preview fails loudly rather than
# silently if this is missing.

_da_require() {
  local missing=""
  [ -n "${DA_TOKEN:-}" ] || missing="$missing DA_TOKEN"
  [ -n "${ORG:-}" ] || missing="$missing ORG"
  [ -n "${REPO:-}" ] || missing="$missing REPO"
  if [ -n "$missing" ]; then
    echo "da-api.sh: missing required env:${missing}" >&2
    return 1
  fi
}

# da_put <local-file> <remote-path>  e.g. da_put ./doc.html templates/comparison-a.html
# Prints the response body; returns non-zero on a non-2xx status.
da_put() {
  _da_require || return 1
  local local_file="$1" remote_path="$2" out code
  out=$(curl -sS -w '\n%{http_code}' -X POST \
    "https://admin.da.live/source/${ORG}/${REPO}/${remote_path}" \
    -H "Authorization: Bearer ${DA_TOKEN}" \
    -H "x-content-source-authorization: Bearer ${DA_TOKEN}" \
    -F "data=@${local_file};type=text/html") || return 1
  code=$(tail -n1 <<<"$out")
  sed '$d' <<<"$out"
  case "$code" in
    2??) return 0 ;;
    *) echo "da_put FAILED (${code}) for ${remote_path}" >&2; return 1 ;;
  esac
}

# da_delete <remote-path>  e.g. da_delete templates/comparison-a.html
da_delete() {
  _da_require || return 1
  local remote_path="$1"
  curl -sS -X DELETE \
    "https://admin.da.live/source/${ORG}/${REPO}/${remote_path}" \
    -H "Authorization: Bearer ${DA_TOKEN}"
}

# da_list <remote-path>  e.g. da_list templates
# Entries carry `path` as "/<ORG>/<REPO>/<remote-path>/<name>.<ext>" — strip the
# "/$ORG/$REPO/" prefix and the extension before passing one to aem_preview.
da_list() {
  _da_require || return 1
  local remote_path="$1"
  curl -sS "https://admin.da.live/list/${ORG}/${REPO}/${remote_path}" \
    -H "Authorization: Bearer ${DA_TOKEN}"
}

# aem_preview <content-path>  e.g. aem_preview templates/comparison-a   (no leading
# "/", no ".html"). Requires AEM write authorization, separate from DA_TOKEN.
#
# Ref: ${BRANCH:-main}. DA content is shared across branches — previewing a
# content path on any ref makes it visible on every
# <branch>--<repo>--<org>.aem.page preview host, so the ref only needs to be a
# branch that exists.
#
# Returns non-zero with a diagnostic on failure rather than reporting success
# after a DA write that never became visible to the worker's sync. Only 401/403
# are blamed on missing AEM preview rights; other statuses are reported as-is.
aem_preview() {
  _da_require || return 1
  local doc="$1" ref="${BRANCH:-main}" body code
  if [ -z "${AEM_TOKEN:-}" ]; then
    echo "aem_preview: AEM_TOKEN is required for preview" >&2
    return 1
  fi
  body=$(curl -sS -w '\n%{http_code}' -X POST \
    "https://admin.hlx.page/preview/${ORG}/${REPO}/${ref}/${doc}" \
    -H "Authorization: Bearer ${AEM_TOKEN}")
  code=$(tail -n1 <<<"$body")
  case "$code" in
    200|201) echo "aem_preview OK for ${doc} (ref ${ref})"; return 0 ;;
    401|403)
      echo "aem_preview FAILED (${code}) for ${doc} — this account has DA write access but NOT AEM preview/publish rights on ${ORG}/${REPO}. A document written to DA without a successful preview is invisible to the worker's sync; do not report this template as ready." >&2 ;;
    404)
      echo "aem_preview FAILED (404) for ${doc} on ref ${ref} — check the path (no leading '/', no '.html') and that branch '${ref}' exists." >&2 ;;
    *)
      echo "aem_preview FAILED (${code}) for ${doc} on ref ${ref}: $(sed '$d' <<<"$body" | head -c 300)" >&2 ;;
  esac
  return 1
}
