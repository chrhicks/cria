#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

summary=()
trap 'printf "\nverify:\n"; printf "  %s\n" "${summary[@]}"' EXIT

stage() {
  local name=$1 status=0
  shift
  "$@" || status=$?
  if [ "$status" -ne 0 ]; then
    summary+=("FAIL $name (exit $status)")
    exit "$status"
  fi
  summary+=("pass $name")
}

stage typecheck pnpm typecheck
stage tests pnpm test
