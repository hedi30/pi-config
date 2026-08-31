#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

bash -n "$ROOT_DIR/install.sh" "$ROOT_DIR/export.sh" "$ROOT_DIR/validate.sh"
node "$ROOT_DIR/scripts/manage.mjs" validate
node --test "$ROOT_DIR/tests"/*.test.mjs
