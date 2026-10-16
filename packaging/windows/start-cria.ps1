param([string]$Configuration = (Join-Path $PSScriptRoot 'config/local.json'))
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Configuration)) { throw 'Copy config/windows.example.json to config/local.json and configure verified bindings first.' }
if (-not $env:CRIA_TOKEN) { Write-Warning 'CRIA_TOKEN is not set: Cria will accept requests without a bearer token. Use this only on a private network.' }
elseif ($env:CRIA_TOKEN.Length -lt 32) { throw 'CRIA_TOKEN must be a private random token of at least 32 characters in this process environment.' }
$apiPath = Join-Path $PSScriptRoot 'api/Cria.Api.exe'
if (-not (Test-Path -LiteralPath $apiPath)) { throw 'API binary missing; extract the complete Windows package.' }
# Foreground startup preserves driver setup UI access. Ctrl+C requests graceful same-owner release.
# A service install, driver takeover, firewall change and forced worker termination are never implicit.
& $apiPath ([System.IO.Path]::GetFullPath($Configuration))
exit $LASTEXITCODE
