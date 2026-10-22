@echo off
rem Installs MediaDesk so it starts automatically with Windows.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install-service.ps1" %*
