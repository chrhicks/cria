#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

summary=()
trap 'printf "\nverify:\n"; printf "  %s\n" "${summary[@]}"' EXIT

stage() {
  local name=$1 status=0
  shift
  # Stages are never piped (into tee or anything else): a pipe once reported a failing suite as passing.
  "$@" || status=$?
  if [ "$status" -ne 0 ]; then
    summary+=("FAIL $name (exit $status)")
    exit "$status"
  fi
  summary+=("pass $name")
}

shipped=(packages/primitives/dist packages/cria-wire/dist packages/fits/dist)

dist_fresh() {
  if [ -n "$(git status --porcelain -- "${shipped[@]}")" ]; then
    git status --short -- "${shipped[@]}"
    echo 'The build changed the committed dist/: commit the rebuilt dist/.'
    return 1
  fi
  pnpm exec vitest run testing/dist.test.ts
}

stage build pnpm build
stage typecheck pnpm typecheck
stage 'committed dist' dist_fresh
# pnpm test runs the unit suite, then the wire golden.
stage 'tests and golden' pnpm test
