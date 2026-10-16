@echo off
setlocal
set "cria_config=%~dp0config\local.json"
if not "%~1"=="" set "cria_config=%~f1"
if not exist "%cria_config%" (
  echo Copy config\windows.example.json to config\local.json and configure verified bindings first.
  exit /b 2
)
if not defined CRIA_TOKEN echo CRIA_TOKEN is not set: Cria will accept requests without a bearer token. Use this only on a private network.
"%~dp0api\Cria.Api.exe" "%cria_config%"
exit /b %ERRORLEVEL%
