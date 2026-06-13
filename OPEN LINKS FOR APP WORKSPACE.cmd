@echo off
setlocal

set "LINKS_FILE=%~dp0LINKS FOR APP WORKSPACE.txt"

if not exist "%LINKS_FILE%" (
  echo Missing "%LINKS_FILE%"
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $linksFile = $env:LINKS_FILE; Get-Content -LiteralPath $linksFile | ForEach-Object { $line = $_.Trim(); if ($line -match '^https?://') { Start-Process $line } }"

if errorlevel 1 (
  echo Failed to open one or more links.
  pause
  exit /b 1
)

exit /b 0
