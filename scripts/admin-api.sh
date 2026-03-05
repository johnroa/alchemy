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
SIM_PASS="AlchemySim2026"

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
  skey=$(get_service_key)
  curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $skey" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$SIM_EMAIL\",\"password\":\"$SIM_PASS\"}" |
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
    # Deactivate current
    run_sql "UPDATE llm_prompts SET is_active = false WHERE scope = '$scope' AND is_active = true" > /dev/null
    # Insert new
    escaped_template=$(python3 -c "
import sys
t = open('$template_file').read().strip()
print(t.replace(\"'\", \"''\"))
")
    run_sql "INSERT INTO llm_prompts (scope, version, name, template, is_active) VALUES ('$scope', $version, '$name', '$escaped_template', true)" > /dev/null
    echo "Created and activated $scope v$version ($name)"
    ;;

  prompt-activate)
    # prompt-activate <scope> <version>
    shift
    scope="$1"; version="$2"
    run_sql "UPDATE llm_prompts SET is_active = false WHERE scope = '$scope' AND is_active = true" > /dev/null
    run_sql "UPDATE llm_prompts SET is_active = true WHERE scope = '$scope' AND version = $version" > /dev/null
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
    run_sql "UPDATE llm_rules SET is_active = false WHERE scope = '$scope' AND is_active = true" > /dev/null
    escaped_rule=$(python3 -c "
import json
r = json.load(open('$rule_file'))
print(json.dumps(json.dumps(r)).replace(\"'\", \"''\"))
" | sed "s/^\"//;s/\"$//")
    run_sql "INSERT INTO llm_rules (scope, version, name, rule, is_active) VALUES ('$scope', $version, '$name', '$escaped_rule'::jsonb, true)" > /dev/null
    echo "Created and activated rule $scope v$version ($name)"
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
    echo "  route-list                           List active model routes"
    echo "  service-key                          Print service role key"
    echo "  sim-token                            Get sim user access token"
    ;;
esac
