#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
export DOTNET_CLI_TELEMETRY_OPTOUT=1
dotnet_sdk="${CRIA_DOTNET:-dotnet}"
mkdir -p artifacts
stage_dir="$(mktemp -d "$PWD/artifacts/win-x64.XXXXXXXX")"
"$dotnet_sdk" restore src/Cria.Api -r win-x64 --locked-mode
"$dotnet_sdk" publish src/Cria.Api -c Release -r win-x64 --self-contained true --no-restore -p:RuntimeFrameworkVersion=10.0.12 -o "$stage_dir/api"
"$dotnet_sdk" restore src/Cria.Driver.Windows --locked-mode
"$dotnet_sdk" build src/Cria.Driver.Windows -c Release --no-restore -o "$stage_dir/worker"
"$dotnet_sdk" restore src/Cria.Desktop --locked-mode
"$dotnet_sdk" build src/Cria.Desktop -c Release --no-restore -o "$stage_dir/desktop"
mkdir -p "$stage_dir/config" "$stage_dir/contract"
cp config/windows.example.json "$stage_dir/config"/
cp contract/openapi.json "$stage_dir/contract"/
cp packaging/windows/start-cria.ps1 packaging/windows/start-cria.cmd packaging/windows/install-desktop.ps1 packaging/windows/install-cria.cmd README.md "$stage_dir/"
mkdir -p "$stage_dir/tools/windows"
cp tools/windows/zwo-setup-select.py tools/windows/zwo-setup-select-both.py "$stage_dir/tools/windows/"
mkdir -p "$stage_dir/docs"
cp docs/runtime.md docs/testing.md "$stage_dir/docs/"
python3 tools/package.py "$stage_dir"
