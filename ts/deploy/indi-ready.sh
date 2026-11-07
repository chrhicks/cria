#!/bin/bash
# indiserver.service ExecStartPost: holds the unit in "activating" until indiserver
# and every driver it started are up, so units ordered After= it (the rig
# program) start only on a healthy indiserver. Usage: indi-ready.sh DRIVER...
#
# Healthy means: indiserver answers on 7624, and each named driver runs as a child
# of indiserver ($MAINPID, set by systemd) and has defined at least one property.
# A driver for hardware that is not powered (indi_asi_ccd with no camera) still
# runs and defines nothing, so a missing device is logged, not fatal: the rig
# program brings it up later. A driver that is not running at all, or an
# indiserver that never answers, fails the start (exit 1) and systemd restarts it.
set -u
port=7624
deadline=$((SECONDS + 30))
until timeout 3 bash -c "exec 3<>/dev/tcp/127.0.0.1/$port" 2>/dev/null; do
  if ((SECONDS >= deadline)); then echo "indi-ready: indiserver not answering on $port after 30 s"; exit 1; fi
  sleep 0.5
done
missing=("$@")
while ((${#missing[@]})); do
  # Full executable names: `comm` is cut to 15 characters (indi_pegasus_ppba would never match).
  running=$(ps --ppid "${MAINPID:?MAINPID not set}" -o args= 2>/dev/null | awk '{ n = $1; sub(".*/", "", n); print n }')
  left=()
  for driver in "${missing[@]}"; do
    grep -qx "$driver" <<<"$running" || left+=("$driver")
  done
  missing=("${left[@]}")
  ((${#missing[@]})) || break
  if ((SECONDS >= deadline)); then echo "indi-ready: drivers not running after 30 s: ${missing[*]}"; exit 1; fi
  sleep 0.5
done
# Drivers are up; give each up to 15 s more to define its devices, then report what is there.
deadline=$((SECONDS + 15))
while :; do
  devices=$(timeout 5 indi_getprop -t 2 '*.DRIVER_INFO.DRIVER_EXEC' 2>/dev/null)
  quiet=()
  for driver in "$@"; do grep -q "=$driver\$" <<<"$devices" || quiet+=("$driver"); done
  if ((${#quiet[@]} == 0)) || ((SECONDS >= deadline)); then break; fi
  sleep 1
done
echo "indi-ready: devices: $(sed -E 's/\.DRIVER_INFO\.DRIVER_EXEC=.*//' <<<"$devices" | sort -u | paste -sd, -)"
((${#quiet[@]})) && echo "indi-ready: no device yet from: ${quiet[*]} (unpowered hardware; the rig program brings it up)"
exit 0
