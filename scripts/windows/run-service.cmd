@echo off
rem Used only by startup tasks created by older versions of install-service.ps1.
rem restart-windows.cmd and update-windows.cmd upgrade those tasks to run node.exe directly.
rem %1 is the full path to node.exe.
cd /d "%~dp0..\.."
if not exist logs mkdir logs
echo [%date% %time%] Starting MediaDesk >> logs\mediadesk.log
"%~1" "%CD%\server.js" >> logs\mediadesk.log 2>&1
