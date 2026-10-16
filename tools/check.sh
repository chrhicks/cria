#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
export DOTNET_CLI_TELEMETRY_OPTOUT=1
dotnet_sdk="${CRIA_DOTNET:-dotnet}"
export DOTNET="$dotnet_sdk"
"$dotnet_sdk" build Cria.slnx -m:1 -nr:false -p:RestoreLockedMode=true --nologo -v quiet
python3 tests/smoke.py
python3 tests/faults.py
python3 tests/edge_cases.py
python3 tests/startup.py
uv run --with jsonschema==4.25.1 python tests/boundaries.py
python3 tests/telemetry.py
python3 tests/sse.py
python3 tests/operation_timings.py
python3 tests/polling.py
python3 tests/lifecycle.py
python3 tests/resources.py
python3 tests/vela.py
python3 tests/vela_restart.py
