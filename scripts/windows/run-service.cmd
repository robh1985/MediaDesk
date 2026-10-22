@echo off
rem Used by the MediaDesk startup task. %1 is the full path to node.exe.
cd /d "%~dp0..\.."
if not exist logs mkdir logs
echo [%date% %time%] Starting MediaDesk >> logs\mediadesk.log
"%~1" "%CD%\server.js" >> logs\mediadesk.log 2>&1
