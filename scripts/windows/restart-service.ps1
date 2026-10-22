# Restarts the MediaDesk startup task so it picks up new code or settings.
# Also upgrades tasks created by older versions of install-service.ps1, which ran node through a
# batch file; ending such a task could leave the old node process running with the old code.

[CmdletBinding()]
param([string]$TaskName = 'MediaDesk')

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

if (Invoke-Elevated $PSCommandPath @('-TaskName', "`"$TaskName`"")) { exit }

function Pause-Exit([int]$code) {
    Write-Host ''
    Read-Host 'Press Enter to close'
    exit $code
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "MediaDesk isn't installed as a startup task." -ForegroundColor Yellow
    if (@(Get-MediaDeskProcesses).Count) {
        Write-Host 'It is running in a window (start-windows.cmd). Close that window and run start-windows.cmd again to load the update.'
    } else {
        Write-Host 'Run install-windows.cmd to install it, or start-windows.cmd to run it in a window.'
    }
    Pause-Exit 1
}

# Upgrade an old batch-file task to run node directly.
$action = $task.Actions | Select-Object -First 1
if ($action.Execute -notmatch 'node(\.exe)?"?$') {
    $nodePath = $null
    if ($action.Arguments) {
        $candidate = $action.Arguments.Trim().Trim('"')
        if ($candidate -match 'node\.exe$' -and (Test-Path $candidate)) { $nodePath = $candidate }
    }
    if (-not $nodePath) {
        $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($cmd) { $nodePath = $cmd.Source }
    }
    if (-not $nodePath) {
        Write-Host 'Could not find node.exe. Install Node.js LTS from https://nodejs.org, then run install-windows.cmd.' -ForegroundColor Red
        Pause-Exit 1
    }
    $logFile = Join-Path $MediaDeskLogDir 'mediadesk.log'
    $newAction = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$MediaDeskServerJs`" --log `"$logFile`"" -WorkingDirectory $MediaDeskRoot
    Set-ScheduledTask -TaskName $TaskName -Action $newAction | Out-Null
    Write-Host 'Upgraded the startup task to run Node.js directly.'
}

Write-Host 'Stopping MediaDesk...'
Stop-MediaDesk $TaskName
Write-Host 'Starting MediaDesk...'
Start-ScheduledTask -TaskName $TaskName
$port = Get-MediaDeskPort

Write-Host ''
if (Wait-MediaDesk $port) {
    $log = Join-Path $MediaDeskLogDir 'mediadesk.log'
    $started = if (Test-Path $log) { Get-Content $log -Tail 50 | Where-Object { $_ -match 'MediaDesk .* starting' } | Select-Object -Last 1 } else { $null }
    Write-Host 'MediaDesk restarted.' -ForegroundColor Green
    if ($started -match 'MediaDesk (.*) starting') { Write-Host "  Running version: $($Matches[1])" }
    Write-Host "  http://localhost:$port  (reload the page in your browser)"
    Pause-Exit 0
} else {
    Write-Host 'MediaDesk did not come back up.' -ForegroundColor Red
    Show-MediaDeskLogTail
    Pause-Exit 1
}
