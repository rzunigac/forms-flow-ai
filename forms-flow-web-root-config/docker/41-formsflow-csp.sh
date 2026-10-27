#!/bin/sh
# Write the Content-Security-Policy header nginx sends with every response: /tmp/formsflow/csp.conf,
# included by nginx.conf (nginx's entrypoint runs this before nginx starts).
#
# CSP_MODE  report-only (default): the browser blocks nothing and reports violations to /csp-report,
#           which nginx logs as JSON lines ("type":"csp-report")
#           enforce: the browser blocks violations, and reports them
#           off: no header
#
# The policy allows the page's own origin, the origins of the REACT_APP_* URL settings (forms, Keycloak,
# APIs, BPM; also as ws/wss), MFE_ALLOWED_ORIGINS for scripts, and cdn.form.io until formio's libraries
# are served from the image (analysis 20, item 8). Deployments add sources per directive, space-separated:
#   CSP_SCRIPT_SRC CSP_STYLE_SRC CSP_FONT_SRC CSP_IMG_SRC CSP_CONNECT_SRC CSP_FRAME_SRC CSP_FRAME_ANCESTORS
# e.g. CSP_CONNECT_SRC="https://api.example.org" for a form that calls that API from the browser.
# Keywords such as 'unsafe-inline', and any source with ; , " ' \ $ or `, stop the container.
set -euf   # -f: sources such as https://*.example.org are not file patterns

conf=/tmp/formsflow/csp.conf
mode=${CSP_MODE:-report-only}

fail() { echo "formsflow-csp: $*" >&2; exit 1; }

# Sources from the deployment: host or scheme sources only, nothing that could end the header or the directive.
extra() {
  for source in $(printenv "$1" || true); do
    case $source in
      *[\;,\"\'\\\$\`]*) fail "$1: '$source' is not allowed" ;;
    esac
    printf ' %s' "$source"
  done
}

# Origins of the configured URLs, e.g. REACT_APP_BPM_URL=https://bpm.example.org/camunda -> https://bpm.example.org
origins=
sockets=   # the same origins as ws/wss (BPM's websocket), for connect-src only
for value in $(env | sed -n 's/^REACT_APP_[A-Z_]*=//p'); do
  origin=$(printf '%s' "$value" | sed -nE 's#^(https?://[^/?#]+).*#\1#p')
  [ -n "$origin" ] || continue
  case $origin in
    *[\;,\"\'\\\$\`@]*) fail "a REACT_APP_* URL has an origin that cannot go in the policy: $origin" ;;
  esac
  origins="$origins $origin"
  sockets="$sockets $(printf '%s' "$origin" | sed 's#^http#ws#')"
done
for origin in ${MFE_ALLOWED_ORIGINS:-}; do
  case $origin in
    *[\;,\"\'\\\$\`]*) fail "MFE_ALLOWED_ORIGINS: '$origin' is not allowed" ;;
  esac
done

formio=https://cdn.form.io
# forms-flow-web loads two images from AOT's website (analysis 20, item 8)
aot_images="https://149641023.v2.pressablecdn.com https://i0.wp.com"

# Assignments, so that fail() in extra stops the script.
script_src=$(extra CSP_SCRIPT_SRC)
style_src=$(extra CSP_STYLE_SRC)
font_src=$(extra CSP_FONT_SRC)
img_src=$(extra CSP_IMG_SRC)
connect_src=$(extra CSP_CONNECT_SRC)
frame_src=$(extra CSP_FRAME_SRC)
frame_ancestors=$(extra CSP_FRAME_ANCESTORS)

# directive name, then its sources; duplicates removed, order kept
directive() {
  name=$1; shift
  printf '%s %s; ' "$name" "$(printf '%s\n' "$@" | awk 'NF && !seen[$0]++' | tr '\n' ' ' | sed 's/ $//')"
}

# word splitting is intended below: each variable holds a list of sources
# shellcheck disable=SC2086
policy=$(
  directive default-src "'self'"
  directive script-src "'self'" "'unsafe-eval'" $formio ${MFE_ALLOWED_ORIGINS:-} $script_src
  directive style-src "'self'" "'unsafe-inline'" $formio $style_src
  directive font-src "'self'" data: $formio $font_src
  directive img-src "'self'" data: blob: $origins $formio $aot_images $img_src
  directive connect-src "'self'" $origins $sockets $formio $connect_src
  directive frame-src "'self'" blob: $origins $frame_src
  directive worker-src "'self'" blob:
  directive frame-ancestors "'self'" $frame_ancestors
  directive object-src "'none'"
  directive base-uri "'self'"
  directive form-action "'self'"
  printf 'report-uri /csp-report'
)

mkdir -p "$(dirname "$conf")"
case $mode in
  enforce) header=Content-Security-Policy ;;
  report-only) header=Content-Security-Policy-Report-Only ;;
  off) echo "# CSP_MODE=off" >"$conf"; echo "formsflow-csp: no policy (CSP_MODE=off)"; exit 0 ;;
  *) fail "CSP_MODE must be enforce, report-only or off, not '$mode'" ;;
esac
printf 'add_header %s "%s" always;\n' "$header" "$policy" >"$conf"
echo "formsflow-csp: $header: $policy"
