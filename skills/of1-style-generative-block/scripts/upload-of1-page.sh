#!/usr/bin/env bash
# Steps 5 + 5b: PUT the /of1 DA doc (incl. landing rows), preview it, gate on the `engine` row.
# Also run by of1-publish step 2.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
# api-endpoint = the host the *deployed* page loads the SDK from AND calls /api/* on. It is the tenant's
# proxied host ($PROXY_BASE, https://<ref>--<repo>--<org>[--dev].of1.live), never gen-web directly: gen-web
# rejects anonymous browser calls and only the proxy holds the caller credential (it also serves /sdk/*).
# OF1_API_ENDPOINT overrides (custom domain, or a worker for local experiments); it must be a bare https origin.
API_ENDPOINT="${OF1_API_ENDPOINT:-$PROXY_BASE}"
if ! printf '%s' "$API_ENDPOINT" | grep -Eq '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$'; then
  echo "FAIL: OF1_API_ENDPOINT/PROXY_BASE must be a bare https origin (https://host[:port]); got: ${API_ENDPOINT}" >&2
  exit 1
fi
ENGINE="da-blocks-slots"   # the only engine the worker serves; written so the page is self-describing

# Landing copy rows from of1-build-quick-suggestions; HTML-escaped; omitted when the file is absent.
LANDING="$OF1_STATE_DIR/of1-landing.json"
LANDING_ROWS=""
if [ -f "$LANDING" ]; then
  for key in title subtitle placeholder; do
    VAL=$(jq -r --arg k "$key" '.[$k] // empty | @html' "$LANDING")
    [ -n "$VAL" ] && LANDING_ROWS="${LANDING_ROWS}<tr><td><p>${key}</p></td><td><p>${VAL}</p></td></tr>"
  done
fi

OF1_HTML='<body><header></header><main><div><div class="metadata"><div><div>Title</div><div>'${DOMAIN}' — Ask Anything</div></div><div><div>Description</div><div>Search and get personalized results.</div></div></div></div><div><div class="of1"><table><tr><th colspan="2">of1</th></tr><tr><td><p>api-endpoint</p></td><td><p>'${API_ENDPOINT}'</p></td></tr><tr><td><p>domain</p></td><td><p>'${TENANT_ID}'</p></td></tr><tr><td><p>engine</p></td><td><p>'${ENGINE}'</p></td></tr>'${LANDING_ROWS}'</table></div></div></main><footer></footer></body>'

. "$LIB/curl-auth.sh"
PUT_RESP=$(of1_curl_auth DA_TOKEN auth -- -s -w "\n%{http_code}" -X PUT \
  -H "Content-Type: text/html" \
  -d "$OF1_HTML" \
  "https://admin.da.live/source/${OWNER}/${REPO}/of1.html")
PUT_STATUS=$(printf '%s\n' "$PUT_RESP" | tail -1)
case "$PUT_STATUS" in
  2??) echo "✓ DA PUT /of1.html (HTTP ${PUT_STATUS})" ;;
  *) echo "FAIL: DA PUT /of1.html returned HTTP ${PUT_STATUS}" >&2
     echo "Response: $(printf '%s\n' "$PUT_RESP" | sed '$d')" >&2
     exit 1 ;;
esac

# Trigger preview so the URL is live
PREVIEW_RESP=$(of1_curl_auth DA_TOKEN auth+source -- -s -w "\n%{http_code}" -X POST \
  "https://admin.hlx.page/preview/${OWNER}/${REPO}/${BRANCH}/of1")
PREVIEW_STATUS=$(echo "$PREVIEW_RESP" | tail -1)
case "$PREVIEW_STATUS" in
  2??) ;;
  *) echo "FAIL: preview trigger for /of1 returned HTTP ${PREVIEW_STATUS}" >&2
     echo "Response: $(echo "$PREVIEW_RESP" | sed '$d')" >&2
     exit 1 ;;
esac

# Gate (5b): a 200 alone is not proof — the previewed doc must carry the `engine` row we wrote.
OF1_BODY=$(curl -s -w "\n%{http_code}" "${PREVIEW_BASE}/of1.plain.html")
OF1_STATUS=$(printf '%s\n' "$OF1_BODY" | tail -1)
if [ "$OF1_STATUS" != "200" ]; then
  echo "FAIL: /of1.plain.html returned HTTP ${OF1_STATUS} — preview trigger likely failed (auth issue?)" >&2
  echo "Re-run the preview trigger with both Authorization and x-content-source-authorization headers." >&2
  exit 1
fi
if ! printf '%s\n' "$OF1_BODY" | sed '$d' | grep -q 'engine'; then
  echo "FAIL: /of1.plain.html is live but has no 'engine' row — the previewed doc is not the one just written (stale preview or PUT didn't land)" >&2
  exit 1
fi
echo "✓ /of1 content is live (of1 block config present)"

# Gate (5c): the block loads ${API_ENDPOINT}/sdk/of1-client.js; without it the page renders no search UI.
SDK_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 30 "${API_ENDPOINT}/sdk/of1-client.js")
if [ "$SDK_STATUS" != "200" ]; then
  echo "FAIL: ${API_ENDPOINT}/sdk/of1-client.js returned HTTP ${SDK_STATUS} — the proxied host must serve the SDK (of1-edge-proxy >= the /sdk passthrough release)." >&2
  echo "Fix the proxy deploy, or set OF1_API_ENDPOINT to a host that serves it, then re-run." >&2
  exit 1
fi
echo "✓ SDK served at ${API_ENDPOINT}"
