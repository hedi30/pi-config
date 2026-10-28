#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=versions.env
source "$ROOT_DIR/versions.env"

DRY_RUN=0
SKIP_CLI=0
SKIP_PACKAGES=0

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Options:
  --dry-run        Show configuration changes without writing or installing
  --skip-cli       Do not install or update the Pi CLI
  --skip-packages  Do not reconcile Pi packages
  -h, --help       Show this help
EOF
}

while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-cli) SKIP_CLI=1 ;;
    --skip-packages) SKIP_PACKAGES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'error: unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

for command in node npm; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'error: %s is required\n' "$command" >&2
    exit 1
  }
done

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if ((NODE_MAJOR < NODE_MIN_MAJOR)); then
  printf 'error: Node.js %s+ is required; found %s\n' "$NODE_MIN_MAJOR" "$(node --version)" >&2
  exit 1
fi

node "$ROOT_DIR/scripts/manage.mjs" validate

if ((SKIP_CLI == 0)); then
  CURRENT_PI_VERSION=""
  if command -v pi >/dev/null 2>&1; then
    CURRENT_PI_VERSION="$(pi --version 2>/dev/null || true)"
  fi

  if [[ "$CURRENT_PI_VERSION" != "$PI_CLI_VERSION" ]]; then
    if ((DRY_RUN)); then
      printf 'Would install %s@%s globally\n' "$PI_CLI_PACKAGE" "$PI_CLI_VERSION"
    else
      npm install --global --ignore-scripts "$PI_CLI_PACKAGE@$PI_CLI_VERSION"
    fi
  else
    printf 'Pi CLI is already pinned at %s\n' "$PI_CLI_VERSION"
  fi
fi

MANAGE_ARGS=(install)
((DRY_RUN)) && MANAGE_ARGS+=(--dry-run)
node "$ROOT_DIR/scripts/manage.mjs" "${MANAGE_ARGS[@]}"

if ((SKIP_PACKAGES == 0)); then
  PACKAGE_SPECS=(
    "npm:pi-powerline-footer@$PI_POWERLINE_VERSION"
    "npm:pi-web-search@$PI_WEB_SEARCH_VERSION"
  )

  for package in "${PACKAGE_SPECS[@]}"; do
    if ((DRY_RUN)); then
      printf 'Would reconcile Pi package %s\n' "$package"
    else
      PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}" pi install "$package"
    fi
  done
fi

cat <<'EOF'

Installation complete.

Machine-local follow-up:
  1. Start `pi` and run `/login`.
  2. Configure required MCP environment variables outside Git.
  3. Trust project-local Pi configuration when prompted.
EOF
