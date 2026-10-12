#!/usr/bin/env bash
# Steps 7 + 7b: playwright checks on the live /of1 page. Advisory 7b result is printed, never fatal.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
. "$LIB/pw.sh"
OF1_URL="${PREVIEW_BASE}/of1"
pw open "$OF1_URL"
sleep 4  # EDS loads header/footer blocks + lazy CSS
pw eval "() => (document.querySelector('header .header') ? 'header OK' : 'HEADER MISSING')" | pw_result
pw eval "() => (document.querySelector('footer .footer') ? 'footer OK' : 'FOOTER MISSING')" | pw_result
pw eval "() => (document.querySelector('.of1') ? 'of1 block OK' : 'OF1 BLOCK MISSING')" | pw_result
pw eval "() => (document.querySelector('.of1 .of1-search-ui') ? 'search UI OK' : 'SEARCH UI MISSING')" | pw_result
pw screenshot --full-page --filename "$OF1_STATE_DIR/of1-render-check.png"
# 7b (advisory before of1-publish syncs): click a chip, wait for generation.
pw click ".of1-chip:first-child"
sleep 8
pw screenshot --full-page --filename "$OF1_STATE_DIR/of1-generated-check.png"
pw eval "() => (document.querySelector('.generated-section') ? 'generated OK' : 'NO GENERATED CONTENT (advisory — of1-publish check 6 is the real gate)')" | pw_result
pw close >/dev/null 2>&1 || true
