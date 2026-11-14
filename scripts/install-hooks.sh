#!/usr/bin/env bash
# Point this clone's Git hooks at the checked-in .githooks/ directory.
set -euo pipefail

cd "$(dirname "$0")/.."
git config core.hooksPath .githooks
echo "Git hooks installed: .githooks/pre-commit runs npm run check && npm test before each commit."
