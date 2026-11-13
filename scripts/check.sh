#!/usr/bin/env bash
# Syntax-check every JavaScript file. There is no bundler or linter in this
# repository, so this is the "does it parse" gate that runs before tests.
set -euo pipefail

cd "$(dirname "$0")/.."
status=0
while IFS= read -r file; do
  node --check "$file" || status=1
done < <(find src public test -name '*.js' | sort)

if [[ "$status" -eq 0 ]]; then
  echo "check: all files parse."
fi
exit "$status"
