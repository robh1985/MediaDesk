@echo off
rem Stops MediaDesk and removes it from Windows startup.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\uninstall-service.ps1" %*
