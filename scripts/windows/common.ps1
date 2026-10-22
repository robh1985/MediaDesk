# Shared helpers for the MediaDesk Windows scripts. Dot-source this file: . "$PSScriptRoot\common.ps1"

$MediaDeskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$MediaDeskServerJs = Join-Path $MediaDeskRoot 'server.js'
$MediaDeskConfig = Join-Path $MediaDeskRoot 'config\config.json'
$MediaDeskLogDir = Join-Path $MediaDeskRoot 'logs'

function Test-IsAdmin {
    ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Re-run the calling script elevated, passing its arguments through. Returns $true if it relaunched.
function Invoke-Elevated([string]$ScriptPath, [string[]]$Arguments = @()) {
    if (Test-IsAdmin) { return $false }
    Write-Host 'Administrator rights are needed. Requesting elevation...'
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$ScriptPath`"") + $Arguments
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList
    return $true
}

function Get-MediaDeskPort {
    if (Test-Path $MediaDeskConfig) {
        try {
            $cfg = [IO.File]::ReadAllText($MediaDeskConfig).TrimStart([char]0xFEFF) | ConvertFrom-Json
            if ($cfg.PSObject.Properties['port'] -and $cfg.port) { return [int]$cfg.port }
        } catch { }
    }
    return 8080
}

# Node processes running this copy of server.js (from the startup task or start-windows.cmd).
function Get-MediaDeskProcesses {
    $pattern = '*' + [Management.Automation.WildcardPattern]::Escape($MediaDeskServerJs) + '*'
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like $pattern }
}

# Stop the startup task and any node process it left behind. Ending a task does not always
# end the node process it started, which would keep serving the old code.
function Stop-MediaDesk([string]$TaskName = 'MediaDesk') {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    }
    foreach ($p in @(Get-MediaDeskProcesses)) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped MediaDesk (process $($p.ProcessId))."
    }
    for ($i = 0; $i -lt 10 -and @(Get-MediaDeskProcesses).Count; $i++) { Start-Sleep -Milliseconds 500 }
}

# Wait until the portal answers on the given port. Returns $true if it came up.
function Wait-MediaDesk([int]$Port, [int]$Seconds = 15) {
    for ($i = 0; $i -lt $Seconds; $i++) {
        Start-Sleep -Seconds 1
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:$Port/portal/session" -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
    }
    return $false
}

function Show-MediaDeskLogTail {
    $log = Join-Path $MediaDeskLogDir 'mediadesk.log'
    if (Test-Path $log) {
        Write-Host ''
        Write-Host "Last lines of $log :" -ForegroundColor Yellow
        Get-Content $log -Tail 8 | ForEach-Object { Write-Host "  $_" }
    }
}
