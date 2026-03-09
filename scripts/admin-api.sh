#!/usr/bin/env bash
#
# Streamlined admin API helper for Alchemy.
# Wraps the Supabase Management API with auth token resolution.
#
# Usage:
#   ./scripts/admin-api.sh sql "SELECT * FROM llm_prompts WHERE is_active = true"
#   ./scripts/admin-api.sh sql-file /tmp/migration.sql
#   ./scripts/admin-api.sh prompt-create <scope> <version> <name> <template_file>
#   ./scripts/admin-api.sh prompt-activate <scope> <version>
#   ./scripts/admin-api.sh prompt-list [scope]
#   ./scripts/admin-api.sh rule-create <scope> <version> <name> <rule_json_file>
#   ./scripts/admin-api.sh rule-list [scope]
#   ./scripts/admin-api.sh route-list
#   ./scripts/admin-api.sh service-key
#   ./scripts/admin-api.sh sim-token

set -euo pipefail

PROJECT="dwptbjcxrsmmgjmnumpg"
SUPABASE_URL="https://dwptbjcxrsmmgjmnumpg.supabase.co"
SIM_EMAIL="sim-1772428603705@cookwithalchemy.com"

# Resolve Supabase CLI token from macOS keychain
get_token() {
  local raw
  raw=$(security find-generic-password -s "Supabase CLI" -w 2>/dev/null)
  echo "$raw" | sed 's/go-keyring-base64://' | base64 -d
}

# Run a SQL query against the project database
run_sql() {
  local token sql
  token=$(get_token)
  sql="$1"
  curl -s -X POST "https://api.supabase.com/v1/projects/$PROJECT/database/query" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "import sys,json; print(json.dumps({'query': sys.stdin.read()}))" <<< "$sql")"
}

run_sql_checked() {
  local result
  result=$(run_sql "$1")
  python3 -c "
import json, sys
payload = json.load(sys.stdin)
if isinstance(payload, dict) and any(key in payload for key in ('error', 'message', 'code', 'details')):
    print(json.dumps(payload, indent=2), file=sys.stderr)
    raise SystemExit(1)
print(json.dumps(payload))
" <<< "$result"
}

ensure_row_exists() {
  local table scope version
  table="$1"
  scope="$2"
  version="$3"
  local result
  result=$(run_sql_checked "SELECT id FROM $table WHERE scope = '$scope' AND version = $version LIMIT 1")
  python3 -c "
import json, sys
payload = json.load(sys.stdin)
if not isinstance(payload, list) or len(payload) == 0:
    raise SystemExit(1)
" <<< "$result"
}

sql_escape_text_file() {
  local file_path
  file_path="$1"
  python3 - "$file_path" <<'PY'
import pathlib, sys
content = pathlib.Path(sys.argv[1]).read_text().strip()
print(content.replace("'", "''"))
PY
}

sql_escape_json_file() {
  local file_path
  file_path="$1"
  python3 - "$file_path" <<'PY'
import json, pathlib, sys
payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
print(json.dumps(payload, separators=(",", ":")).replace("'", "''"))
PY
}

# Get the service role API key
get_service_key() {
  local token
  token=$(get_token)
  curl -s -H "Authorization: Bearer $token" \
    "https://api.supabase.com/v1/projects/$PROJECT/api-keys" |
    python3 -c "import sys,json; keys=json.load(sys.stdin); print(next(k['api_key'] for k in keys if k['name']=='service_role'))"
}

# Get a sim user access token
get_sim_token() {
  local skey
  local otp
  skey=$(get_service_key)
  otp=$(
    curl -s -X POST "$SUPABASE_URL/auth/v1/admin/generate_link" \
      -H "Authorization: Bearer $skey" \
      -H "apikey: $skey" \
      -H "Content-Type: application/json" \
      -d "{\"type\":\"magiclink\",\"email\":\"$SIM_EMAIL\"}" |
      python3 -c "import sys,json; payload=json.load(sys.stdin); props=payload.get('properties') if isinstance(payload.get('properties'), dict) else {}; print(payload.get('email_otp') or props.get('email_otp') or '')"
  )

  if [ -z "$otp" ]; then
    echo "FAILED"
    return 1
  fi

  curl -s -X POST "$SUPABASE_URL/auth/v1/verify" \
    -H "apikey: $skey" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"magiclink\",\"token\":\"$otp\",\"email\":\"$SIM_EMAIL\"}" |
    python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token','FAILED'))"
}

case "${1:-help}" in
  sql)
    shift
    run_sql "$1" | python3 -m json.tool 2>/dev/null || run_sql "$1"
    ;;

  sql-file)
    shift
    run_sql "$(cat "$1")" | python3 -m json.tool 2>/dev/null || run_sql "$(cat "$1")"
    ;;

  prompt-list)
    scope_filter=""
    if [ -n "${2:-}" ]; then
      scope_filter="AND scope = '${2}'"
    fi
    run_sql "SELECT scope, version, name, is_active, created_at, length(template) as template_len FROM llm_prompts WHERE 1=1 $scope_filter ORDER BY scope, version DESC" |
      python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data:
    active = '>>>' if r.get('is_active') else '   '
    print(f'{active} {r[\"scope\"]:25s} v{r[\"version\"]:<4d} {r[\"name\"]:45s} {r[\"template_len\"]:>5d} chars  {str(r.get(\"created_at\",\"\"))[:19]}')
"
    ;;

  prompt-create)
    # prompt-create <scope> <version> <name> <template_file>
    shift
    scope="$1"; version="$2"; name="$3"; template_file="$4"
    escaped_template=$(sql_escape_text_file "$template_file")
    run_sql_checked "INSERT INTO llm_prompts (scope, version, name, template, is_active) VALUES ('$scope', $version, '$name', '$escaped_template', false)" > /dev/null
    ensure_row_exists "llm_prompts" "$scope" "$version"
    run_sql_checked "UPDATE llm_prompts SET is_active = false WHERE scope = '$scope' AND is_active = true" > /dev/null
    run_sql_checked "UPDATE llm_prompts SET is_active = true WHERE scope = '$scope' AND version = $version" > /dev/null
    echo "Created and activated $scope v$version ($name)"
    ;;

  prompt-activate)
    # prompt-activate <scope> <version>
    shift
    scope="$1"; version="$2"
    run_sql_checked "UPDATE llm_prompts SET is_active = false WHERE scope = '$scope' AND is_active = true" > /dev/null
    run_sql_checked "UPDATE llm_prompts SET is_active = true WHERE scope = '$scope' AND version = $version" > /dev/null
    echo "Activated $scope v$version"
    ;;

  rule-list)
    scope_filter=""
    if [ -n "${2:-}" ]; then
      scope_filter="AND scope = '${2}'"
    fi
    run_sql "SELECT scope, version, name, is_active, rule FROM llm_rules WHERE 1=1 $scope_filter ORDER BY scope, version DESC" |
      python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data:
    active = '>>>' if r.get('is_active') else '   '
    rule_preview = json.dumps(r.get('rule',{}))[:80]
    print(f'{active} {r[\"scope\"]:25s} v{r[\"version\"]:<4d} {r[\"name\"]:45s} {rule_preview}')
"
    ;;

  rule-create)
    # rule-create <scope> <version> <name> <rule_json_file>
    shift
    scope="$1"; version="$2"; name="$3"; rule_file="$4"
    escaped_rule=$(sql_escape_json_file "$rule_file")
    run_sql_checked "INSERT INTO llm_rules (scope, version, name, rule, is_active) VALUES ('$scope', $version, '$name', '$escaped_rule'::jsonb, false)" > /dev/null
    ensure_row_exists "llm_rules" "$scope" "$version"
    run_sql_checked "UPDATE llm_rules SET is_active = false WHERE scope = '$scope' AND is_active = true" > /dev/null
    run_sql_checked "UPDATE llm_rules SET is_active = true WHERE scope = '$scope' AND version = $version" > /dev/null
    echo "Created and activated rule $scope v$version ($name)"
    ;;

  rule-activate)
    # rule-activate <scope> <version>
    shift
    scope="$1"; version="$2"
    run_sql_checked "UPDATE llm_rules SET is_active = false WHERE scope = '$scope' AND is_active = true" > /dev/null
    run_sql_checked "UPDATE llm_rules SET is_active = true WHERE scope = '$scope' AND version = $version" > /dev/null
    echo "Activated rule $scope v$version"
    ;;

  route-list)
    run_sql "SELECT scope, provider, model, route_name, is_active, config FROM llm_model_routes WHERE is_active = true ORDER BY scope" |
      python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data:
    cfg = json.dumps(r.get('config',{}))[:60]
    print(f'{r[\"scope\"]:30s} {r[\"provider\"]:12s} {r[\"model\"]:30s} {cfg}')
"
    ;;

  service-key)
    get_service_key
    ;;

  sim-token)
    get_sim_token
    ;;

  help|*)
    echo "Usage: ./scripts/admin-api.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  sql <query>                          Run SQL query"
    echo "  sql-file <file>                      Run SQL from file"
    echo "  prompt-list [scope]                  List prompts (>>> = active)"
    echo "  prompt-create <scope> <ver> <name> <file>  Create & activate prompt"
    echo "  prompt-activate <scope> <version>    Activate existing prompt version"
    echo "  rule-list [scope]                    List rules"
    echo "  rule-create <scope> <ver> <name> <file>    Create & activate rule"
    echo "  rule-activate <scope> <version>      Activate existing rule version"
    echo "  route-list                           List active model routes"
    echo "  service-key                          Print service role key"
    echo "  sim-token                            Get sim user access token"
    ;;
esac
