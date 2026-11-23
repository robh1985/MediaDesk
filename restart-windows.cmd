@echo off
rem Restarts the MediaDesk service (or the startup task of older installs), for example after changing files by hand.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\restart-service.ps1" %*
