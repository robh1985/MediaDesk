@echo off
rem Installs MediaDesk as a Windows service, and moves older installs (and their settings) over to it.
rem Options: -Port 8081, -Yes (no questions), -MigrateFrom D:\OldMediaDesk, -UseTask, -NoFirewall
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install-service.ps1" %*
