@echo off
rem Stops MediaDesk and removes the service. Settings and data are kept.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\uninstall-service.ps1" %*
