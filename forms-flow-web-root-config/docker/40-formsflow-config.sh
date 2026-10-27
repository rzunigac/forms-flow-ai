#!/bin/sh
# Write the runtime files the page loads from /config/ (nginx's entrypoint runs this before nginx starts):
#   config.js       window._env_ from the REACT_APP_* variables (config.template.js)
#   importmap.json  where each micro-frontend is loaded from
#   theme.css       the base theme stylesheet
#
# The import map decides which JavaScript runs with the user's token, so (report 08 S1):
#   - defaults are the bundles in this image (/mfe/...), on the page's own origin;
#   - MF_FORMSFLOW_<NAME>_URL overrides one entry, and must be a same-origin path or start with an
#     origin listed in MFE_ALLOWED_ORIGINS (space-separated, e.g. "https://mfe.example.org");
#   - anything else stops the container.
# THEME_CSS_FILE: a stylesheet to serve instead of the bundled theme (e.g. a mounted ConfigMap).
# FORMSFLOW_CONFIG_DIR: where to write (default /usr/share/nginx/html/config; an emptyDir with a read-only root).
set -eu

out=${FORMSFLOW_CONFIG_DIR:-/usr/share/nginx/html/config}
mfe=/mfe

fail() { echo "formsflow-config: $*" >&2; exit 1; }

allowed() {
  case $1 in
    *\\*) return 1 ;;                      # browsers read "/\host" as "//host"
    //*) return 1 ;;                       # protocol-relative: another origin
    /*) return 0 ;;
  esac
  for origin in ${MFE_ALLOWED_ORIGINS:-}; do
    case $1 in "$origin"/*) return 0 ;; esac
  done
  return 1
}

envsubst <"/etc/formsflow/config.template.js" >"$out/config.js"

# import map entry | env override | bundled file
map='{"imports":{"@formsflow/root-config":"/formsflow-root-config.js"}}'
while read -r entry var file; do
  url=$(printenv "$var" || true)
  if [ -z "$url" ]; then
    url=$mfe/$file
  elif ! allowed "$url"; then
    fail "$var=$url is not a same-origin path or under MFE_ALLOWED_ORIGINS"
  fi
  map=$(printf '%s' "$map" | jq -c --arg k "$entry" --arg v "$url" '.imports[$k] = $v')
done <<EOF
@formsflow/nav          MF_FORMSFLOW_NAV_URL          forms-flow-nav/forms-flow-nav.js
@formsflow/formsflow-web MF_FORMSFLOW_WEB_URL         forms-flow-web/forms-flow-web.js
@formsflow/admin        MF_FORMSFLOW_ADMIN_URL        forms-flow-admin/forms-flow-admin.js
@formsflow/task         MF_FORMSFLOW_REVIEW_URL       forms-flow-review/forms-flow-review.js
@formsflow/submissions  MF_FORMSFLOW_SUBMISSIONS_URL  forms-flow-submissions/forms-flow-submissions.js
@formsflow/service      MF_FORMSFLOW_SERVICE_URL      forms-flow-service/forms-flow-service.js
@formsflow/components   MF_FORMSFLOW_COMPONENTS_URL   forms-flow-components/forms-flow-components.js
EOF
printf '%s\n' "$map" | jq . >"$out/importmap.json"

theme=${THEME_CSS_FILE:-/usr/share/nginx/html$mfe/forms-flow-theme/forms-flow-theme.min.css}
[ -f "$theme" ] || fail "theme stylesheet $theme not found"
cp "$theme" "$out/theme.css"

echo "formsflow-config: wrote config.js, importmap.json, theme.css to $out"
