@echo off
rem Downloads the latest MediaDesk from GitHub and restarts it.
setlocal
cd /d "%~dp0"

if not exist ".git" goto nogit
where git >nul 2>nul
if errorlevel 1 goto nogit

echo Checking GitHub for updates...
git fetch origin
if errorlevel 1 goto fail
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="main" (
  echo Switching from the %BRANCH% branch to main, where updates are published...
  git checkout main
  if errorlevel 1 goto fail
)
git pull --ff-only origin main
if errorlevel 1 goto fail
echo.
git log -1 --format="Now on: %%h %%s"
echo.
goto restart

:nogit
echo This folder was not set up with git, so it cannot update itself.
echo Download the latest ZIP from https://github.com/robh1985/MediaDesk
echo and extract it over this folder - your settings in config\config.json are kept.
echo Then run restart-windows.cmd.
echo.
pause
exit /b 1

:restart
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\restart-service.ps1"
exit /b 0

:fail
echo.
echo The update failed - see the message above. Your current version is still in place.
pause
exit /b 1
