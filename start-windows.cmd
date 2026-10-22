@echo off
rem Runs MediaDesk in this window. Close the window (or press Ctrl+C) to stop it.
rem Add --mock to try it with sample data:  start-windows.cmd --mock
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and try again.
  pause
  exit /b 1
)
node server.js %*
pause
