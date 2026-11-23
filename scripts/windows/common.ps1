# Shared helpers for the MediaDesk Windows scripts. Dot-source this file: . "$PSScriptRoot\common.ps1"

$MediaDeskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$MediaDeskServerJs = Join-Path $MediaDeskRoot 'server.js'
$MediaDeskSupervisorJs = Join-Path $MediaDeskRoot 'supervisor.js'
$MediaDeskConfig = Join-Path $MediaDeskRoot 'config\config.json'
$MediaDeskLogDir = Join-Path $MediaDeskRoot 'logs'
$MediaDeskServiceName = 'MediaDesk'
$MediaDeskServiceExe = Join-Path $MediaDeskRoot 'service\MediaDeskService.exe'
$MediaDeskRepoUrl = 'https://github.com/robh1985/MediaDesk.git'

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

function Get-MediaDeskPort([string]$ConfigPath = $MediaDeskConfig) {
    if (Test-Path $ConfigPath) {
        try {
            $cfg = [IO.File]::ReadAllText($ConfigPath).TrimStart([char]0xFEFF) | ConvertFrom-Json
            if ($cfg.PSObject.Properties['port'] -and $cfg.port) { return [int]$cfg.port }
        } catch { }
    }
    return 8080
}

# Node.js and Git, also where their installers put them when they aren't on this account's PATH.
function Find-Node {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

function Find-Git {
    $cmd = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @("$env:ProgramFiles\Git\cmd\git.exe", "${env:ProgramFiles(x86)}\Git\cmd\git.exe", "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe")) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

function Get-MediaDeskService {
    Get-CimInstance Win32_Service -Filter "Name = '$MediaDeskServiceName'" -ErrorAction SilentlyContinue
}

# Node processes running MediaDesk from a folder (the service, the startup task or start-windows.cmd
# started with a full path).
function Get-MediaDeskProcesses([string]$Root = $MediaDeskRoot) {
    $esc = [Management.Automation.WildcardPattern]::Escape($Root.TrimEnd('\'))
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$esc\server.js*" -or $_.CommandLine -like "*$esc\supervisor.js*") }
}

# Stop the service or startup task and any node process left behind. Ending a task does not always
# end the node process it started, which would keep serving the old code.
function Stop-MediaDesk([string]$TaskName = 'MediaDesk', [string]$Root = $MediaDeskRoot) {
    $svc = Get-Service -Name $MediaDeskServiceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Stopped') {
        Stop-Service -Name $MediaDeskServiceName -Force -ErrorAction SilentlyContinue
        try { $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(40)) } catch { }
    }
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    }
    foreach ($p in @(Get-MediaDeskProcesses $Root)) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped MediaDesk (process $($p.ProcessId))."
    }
    for ($i = 0; $i -lt 10 -and @(Get-MediaDeskProcesses $Root).Count; $i++) { Start-Sleep -Milliseconds 500 }
}

# Start whichever is installed: the service, or (older installs) the startup task.
function Start-MediaDesk([string]$TaskName = 'MediaDesk') {
    if (Get-Service -Name $MediaDeskServiceName -ErrorAction SilentlyContinue) { Start-Service -Name $MediaDeskServiceName; return 'service' }
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName $TaskName; return 'task' }
    return $null
}

# Wait until the portal answers on the given port. Returns $true if it came up.
function Wait-MediaDesk([int]$Port, [int]$Seconds = 30) {
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
        Get-Content $log -Tail 10 | ForEach-Object { Write-Host "  $_" }
    }
}
