# Sourced helper (bash/zsh). No set -e/-u.
# of1_curl_auth <TOKEN_VAR_NAME> <auth|auth+source> -- <curl args...>
# Takes the NAME of the variable holding the token (not its value), so even the caller's xtrace
# line never shows it. Runs curl with `Authorization: Bearer <token>` (and, for auth+source, also
# `x-content-source-authorization`) delivered as a `-K -` config on stdin (printf is a
# builtin), so the token never lands in argv/ps//proc/<pid>/cmdline. xtrace is suspended
# inside; the token is never echoed. Tokens outside [A-Za-z0-9._~+/=-]+ are refused
# (exit 2) rather than escaped. Never pass -v/--verbose/--trace (they print headers).
of1_curl_auth() {
  local _var="$1" _mode="$2" _xt=0 _rc _cfg _tok=""
  case "$-" in *x*) _xt=1 ;; esac
  { set +x; } 2>/dev/null
  shift 2 2>/dev/null
  [ "${1:-}" = "--" ] && shift
  case "$_var" in
    '' | [!A-Za-z_]* | *[!A-Za-z0-9_]*) echo "of1_curl_auth: first argument must be a variable name" >&2
      [ "$_xt" = 1 ] && set -x
      return 2 ;;
  esac
  eval "_tok=\"\${$_var:-}\""
  case "$_tok" in
    '' | *[!A-Za-z0-9._~+/=-]*)
      echo "of1_curl_auth: refusing token: empty or contains characters outside [A-Za-z0-9._~+/=-]" >&2
      [ "$_xt" = 1 ] && set -x
      return 2 ;;
  esac
  _cfg="header = \"Authorization: Bearer ${_tok}\""
  [ "$_mode" = "auth+source" ] && _cfg="${_cfg}"$'\n'"header = \"x-content-source-authorization: Bearer ${_tok}\""
  printf '%s\n' "$_cfg" | curl -K - "$@"
  _rc=$?
  _cfg=""
  [ "$_xt" = 1 ] && set -x
  return "$_rc"
}
