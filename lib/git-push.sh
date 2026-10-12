# Sourced helper (bash/zsh). No set -e/-u.
git_push_rebased() {
  local br="$1"
  if ! git pull --rebase --autostash -q origin "$br"; then
    git rebase --abort >/dev/null 2>&1
    echo "✗ FAIL: git pull --rebase origin $br failed (conflict with the remote) — rebase aborted, nothing pushed. Resolve manually (git pull --rebase origin $br), then re-run. Never force-push." >&2
    return 1
  fi
  git push origin "$br"
}
