# Optional wrapper. install-cria.cmd calls the same native installer without PowerShell.
param(
    [Parameter(Mandatory=$true)][string]$Configuration,
    [Parameter(Mandatory=$true)][string]$TokenFile,
    [string]$SettingsDirectory = (Join-Path $env:LOCALAPPDATA 'Cria/Desktop')
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'desktop/Cria.Desktop.exe') --install $Configuration $TokenFile $SettingsDirectory
exit $LASTEXITCODE
