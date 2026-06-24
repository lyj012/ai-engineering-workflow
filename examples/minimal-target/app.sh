#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  "")
    echo "Hello from minimal target"
    ;;
  "--help")
    echo "Usage: ./app.sh [--help]"
    ;;
  *)
    echo "unknown option: $1" >&2
    exit 2
    ;;
esac
