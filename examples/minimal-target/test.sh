#!/usr/bin/env bash
set -euo pipefail

out="$(bash ./app.sh)"
test "$out" = "Hello from minimal target"

help="$(bash ./app.sh --help)"
case "$help" in
  *"Usage:"*) ;;
  *) echo "expected help output" >&2; exit 1 ;;
esac

if bash ./app.sh --bad-option >/tmp/minimal-target.out 2>/tmp/minimal-target.err; then
  echo "unknown option should fail" >&2
  exit 1
fi

echo "ALL PASSED"
