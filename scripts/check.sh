#!/usr/bin/env bash
# Static quality gate, run before tests (`npm run check`, the pre-commit hook and
# CI). Every step runs even after a failure, so one run lists all problems.
set -uo pipefail

cd "$(dirname "$0")/.."

if [[ ! -d node_modules ]]; then
  echo "check: node_modules is missing. Run npm ci first." >&2
  exit 1
fi

failed=()
step() {
  local name="$1"
  shift
  echo "check: $name"
  if ! "$@"; then
    failed+=("$name")
  fi
}

syntax() {
  local status=0 file
  while IFS= read -r file; do
    node --check "$file" || status=1
  done < <(find src public test scripts -name '*.js' | sort)
  return "$status"
}

bin=node_modules/.bin
step "syntax (node --check)" syntax
step "format (prettier)" "$bin/prettier" --check --log-level warn .
step "lint (eslint)" "$bin/eslint" .
step "types (tsc)" "$bin/tsc" -p .
step "dead code and unused dependencies (knip)" "$bin/knip"
step "duplicate code (jscpd)" "$bin/jscpd" --silent
step "repository rules" node scripts/repo-checks.js
step "API docs up to date" node scripts/gen-api-docs.js --check
step "AGENTS.md and README.md commands" node scripts/check-agents-md.js

if [[ "${#failed[@]}" -gt 0 ]]; then
  echo >&2
  printf 'check: FAILED: %s\n' "${failed[@]}" >&2
  exit 1
fi
echo "check: all checks passed."
