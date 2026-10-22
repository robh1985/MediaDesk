@echo off
rem Restarts the MediaDesk startup task, for example after changing files by hand.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\restart-service.ps1" %*
