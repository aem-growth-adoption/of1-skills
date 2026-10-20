# Sourced helper (bash/zsh). No set -e/-u. Does NOT cd into $OF1_DEMO_REPO.
# The Helix ref is not a tenant concept: preview/proxy hosts and admin calls always use `main`.
# $BRANCH (repo-config.json `branch`, optional, legacy) is only the git branch for pushes.
of1_load_env() {
  local f="${OF1_STATE_DIR:-}/repo-config.json" out
  out=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(!j.owner||!j.repo)process.exit(1);process.stdout.write([j.owner,j.repo,j.branch||"",j.domain||""].join("\n"))}catch(e){process.exit(1)}' "$f" 2>/dev/null) || {
    echo "FAIL: cannot read $f" >&2; return 1
  }
  OWNER=$(printf '%s\n' "$out" | sed -n 1p)
  REPO=$(printf '%s\n' "$out" | sed -n 2p)
  BRANCH=$(printf '%s\n' "$out" | sed -n 3p)
  DOMAIN=$(printf '%s\n' "$out" | sed -n 4p)
  PREVIEW_HOST="main--${REPO}--${OWNER}.aem.page"
  PREVIEW_BASE="https://${PREVIEW_HOST}"
  TENANT_ID=$(printf '%s/%s' "$OWNER" "$REPO" | tr '[:upper:]' '[:lower:]')
  WORKER_URL="${OF1_GENWEB_URL:-https://of1-gen-web-service.franklin-prod.workers.dev}"
  # Dev workers pair with the --dev proxy hosts; OF1_PROXY_SUFFIX (e.g. "--dev", "--alice", or empty) overrides.
  local sfx
  if [ -n "${OF1_PROXY_SUFFIX+x}" ]; then sfx="$OF1_PROXY_SUFFIX"; else case "$WORKER_URL" in *-dev.*|*-dev-*|*--dev*) sfx="--dev" ;; *) sfx="" ;; esac; fi
  PROXY_HOST=$(printf 'main--%s--%s%s' "$REPO" "$OWNER" "$sfx" | tr '[:upper:]' '[:lower:]')
  PROXY_BASE="https://${PROXY_HOST}.of1.live"
  export OWNER REPO BRANCH DOMAIN PREVIEW_BASE TENANT_ID WORKER_URL PREVIEW_HOST PROXY_HOST PROXY_BASE
}

# of1_require_main — OF1 setup runs from main (cwd = the EDS repo). Detached HEAD is its own failure.
of1_require_main() {
  local b; b=$(git symbolic-ref --short -q HEAD 2>/dev/null)
  [ -n "$b" ] || { echo "✗ FAIL: detached HEAD — check out main first" >&2; return 1; }
  [ "$b" = main ] || { echo "✗ FAIL: OF1 setup runs from the main branch (checkout main)" >&2; return 1; }
}
