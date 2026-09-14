#!/usr/bin/env bash
# Enumerate real, usable content blocks in a tenant EDS repo's blocks/
# directory: keep only directories with a non-trivial <name>.js or
# <name>.css, and exclude the known loaders/no-ops (design spec decision 6,
# mechanized). Usage: inventory.sh <path-to-tenant-repo-clone>
set -euo pipefail

repo_dir="${1:?usage: inventory.sh <tenant-repo-dir>}"
excluded_regex='^(of1|widget|fragment|header|footer|prototype-.*)$'

for dir in "$repo_dir"/blocks/*/; do
  name="$(basename "$dir")"
  [[ "$name" =~ $excluded_regex ]] && continue

  js_file="${dir}${name}.js"
  css_file="${dir}${name}.css"
  has_real_js=false
  has_real_css=false

  [[ -s "$js_file" ]] && has_real_js=true
  [[ -s "$css_file" ]] && has_real_css=true

  if $has_real_js || $has_real_css; then
    echo "$name"
  fi
done
