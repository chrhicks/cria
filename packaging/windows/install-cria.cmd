@echo off
"%~dp0desktop\Cria.Desktop.exe" --install %*
exit /b %errorlevel%
