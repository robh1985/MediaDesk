# Restarts MediaDesk (the service, or the startup task of older installs) so it picks up new code
# or settings. Old startup tasks that ran node through a batch file, or ran server.js without the
# supervisor, are pointed at supervisor.js; install-windows.cmd moves them to the service.

[CmdletBinding()]
param([string]$TaskName = 'MediaDesk', [switch]$NoPause)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

$passArgs = @('-TaskName', "`"$TaskName`"")
if ($NoPause) { $passArgs += '-NoPause' }
if (Invoke-Elevated $PSCommandPath $passArgs) { exit }

function Pause-Exit([int]$code) {
    if (-not $NoPause) { Write-Host ''; Read-Host 'Press Enter to close' | Out-Null }
    exit $code
}

$service = Get-Service -Name $MediaDeskServiceName -ErrorAction SilentlyContinue
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $service -and -not $task) {
    Write-Host "MediaDesk isn't installed as a service." -ForegroundColor Yellow
    if (@(Get-MediaDeskProcesses).Count) {
        Write-Host 'It is running in a window (start-windows.cmd). Close that window and run start-windows.cmd again to load the update.'
    } else {
        Write-Host 'Run install-windows.cmd to install it, or start-windows.cmd to run it in a window.'
    }
    Pause-Exit 1
}

if (-not $service) {
    # An older startup task: make it run node supervisor.js directly.
    $action = $task.Actions | Select-Object -First 1
    if ("$($action.Execute) $($action.Arguments)" -notmatch 'supervisor\.js') {
        $nodePath = Find-Node
        if (-not $nodePath) {
            Write-Host 'Could not find node.exe. Install Node.js LTS from https://nodejs.org, then run install-windows.cmd.' -ForegroundColor Red
            Pause-Exit 1
        }
        $logFile = Join-Path $MediaDeskLogDir 'mediadesk.log'
        $newAction = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$MediaDeskSupervisorJs`" --log `"$logFile`"" -WorkingDirectory $MediaDeskRoot
        Set-ScheduledTask -TaskName $TaskName -Action $newAction | Out-Null
        Write-Host 'Updated the startup task. Run install-windows.cmd to switch to the MediaDesk service.'
    }
}

Write-Host 'Stopping MediaDesk...'
Stop-MediaDesk $TaskName
Write-Host 'Starting MediaDesk...'
Start-MediaDesk $TaskName | Out-Null
$port = Get-MediaDeskPort

Write-Host ''
if (Wait-MediaDesk $port 45) {
    $log = Join-Path $MediaDeskLogDir 'mediadesk.log'
    $started = if (Test-Path $log) { Get-Content $log -Encoding UTF8 -Tail 80 | Where-Object { $_ -match 'MediaDesk .* starting' } | Select-Object -Last 1 } else { $null }
    Write-Host 'MediaDesk restarted.' -ForegroundColor Green
    if ($started -match 'MediaDesk (.*) starting') { Write-Host "  Running version: $($Matches[1])" }
    Write-Host "  http://localhost:$port  (reload the page in your browser)"
    Pause-Exit 0
} else {
    Write-Host 'MediaDesk did not come back up.' -ForegroundColor Red
    Show-MediaDeskLogTail
    Pause-Exit 1
}
