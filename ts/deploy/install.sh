#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: install.sh errai|thuban [--commit REF] [--restart indiserver|phd2]..." >&2
  exit 1
}

main() {
  [ $# -ge 1 ] || usage
  local machine=$1 commit=origin/main restart=()
  shift
  while [ $# -gt 0 ]; do
    case $1 in
      --commit) [ $# -ge 2 ] || usage; commit=$2; shift 2 ;;
      --restart) [ $# -ge 2 ] || usage; restart+=("$2"); shift 2 ;;
      *) usage ;;
    esac
  done

  local checkout units enabled programs retired=()
  case $machine in
    errai)
      checkout=$HOME/dev/personal/cria-ts
      units=(indiserver rig phd2)
      enabled=(indiserver rig)
      programs=(rig)
      retired=(rig-supervisor rig-stream-client)
      ;;
    thuban)
      checkout=$HOME/dev/personal/cria-run
      units=(rig-stream-viewer)
      enabled=(rig-stream-viewer)
      programs=(rig-stream-viewer)
      ;;
    *) usage ;;
  esac

  [ "$(cd "$(dirname "$0")/../.." && pwd -P)" = "$(cd "$checkout" && pwd -P)" ] || { echo "install.sh: run it from $checkout/ts/deploy: the units run the programs from there" >&2; exit 1; }
  for unit in "${restart[@]}"; do
    case $unit in indiserver | phd2) ;; *) usage ;; esac
  done

  git -C "$checkout" fetch --quiet origin
  git -C "$checkout" checkout --quiet --detach "$commit"
  echo "install: $machine at $(git -C "$checkout" rev-parse --short HEAD)"

  (cd "$checkout/ts" && pnpm install --frozen-lockfile --prod)

  for unit in "${retired[@]}"; do
    [ -e "$HOME/.config/systemd/user/$unit.service" ] || continue
    systemctl --user disable --now "$unit"
    rm -f "$HOME/.config/systemd/user/$unit.service"
  done

  mkdir -p "$HOME/.config/systemd/user"
  local unit source target
  for unit in "${units[@]}"; do
    source=$checkout/ts/deploy/$unit.service
    target=$HOME/.config/systemd/user/$unit.service
    [ "$(readlink "$target" || true)" = "$source" ] || rm -f "$target"
    systemctl --user link "$source"
  done
  systemctl --user enable "${enabled[@]}"
  systemctl --user daemon-reload

  if [ "$machine" = thuban ]; then
    node "$checkout/ts/src/bin/ensure-stream.ts" "$HOME/.config/rig-stream/viewer.json"
  fi

  for unit in "${restart[@]}"; do
    systemctl --user restart "$unit"
  done
  for unit in "${programs[@]}"; do
    systemctl --user restart "$unit"
    echo "install: restarted $unit"
  done
}

main "$@"
exit
