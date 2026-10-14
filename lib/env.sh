# Sourced helper (bash/zsh). No set -e/-u. Does NOT cd into $OF1_DEMO_REPO.
of1_load_env() {
  local f="${OF1_STATE_DIR:-}/repo-config.json" out
  out=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(!j.owner||!j.repo||!j.branch)process.exit(1);process.stdout.write([j.owner,j.repo,j.branch,j.domain||""].join("\n"))}catch(e){process.exit(1)}' "$f" 2>/dev/null) || {
    echo "FAIL: cannot read $f" >&2; return 1
  }
  OWNER=$(printf '%s\n' "$out" | sed -n 1p)
  REPO=$(printf '%s\n' "$out" | sed -n 2p)
  BRANCH=$(printf '%s\n' "$out" | sed -n 3p)
  DOMAIN=$(printf '%s\n' "$out" | sed -n 4p)
  PREVIEW_HOST="${BRANCH}--${REPO}--${OWNER}.aem.page"
  PREVIEW_BASE="https://${PREVIEW_HOST}"
  TENANT_ID=$(printf '%s/%s' "$OWNER" "$REPO" | tr '[:upper:]' '[:lower:]')
  PROXY_HOST="${BRANCH}--${REPO}--${OWNER}"
  PROXY_BASE="https://${PROXY_HOST}.of1.live"
  WORKER_URL="${OF1_GENWEB_URL:-https://of1-gen-web-service.franklin-prod.workers.dev}"
  export OWNER REPO BRANCH DOMAIN PREVIEW_BASE TENANT_ID WORKER_URL PREVIEW_HOST PROXY_HOST PROXY_BASE
}
