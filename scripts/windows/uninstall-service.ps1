# Removes the MediaDesk startup task and firewall rule. Your config and files are left in place.

[CmdletBinding()]
param([string]$TaskName = 'MediaDesk')

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-TaskName', "`"$TaskName`"")
    exit
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed startup task '$TaskName'."
} else {
    Write-Host "No startup task named '$TaskName' was found."
}

# Stopping the task does not always stop the node process it started.
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverJs = Join-Path $root 'server.js'
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($serverJs) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "Stopped MediaDesk (process $($_.ProcessId))." }

$rule = Get-NetFirewallRule -DisplayName 'MediaDesk' -ErrorAction SilentlyContinue
if ($rule) { $rule | Remove-NetFirewallRule; Write-Host 'Removed firewall rule.' }

Write-Host ''
Write-Host 'Done. Your settings in config\config.json were kept.'
Read-Host 'Press Enter to close'
