#!/bin/bash
# Wrapper: load .env and run reddit-digest.py. Run this when you're doing outreach.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

exec python3 reddit-digest.py "$@"
