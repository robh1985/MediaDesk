# Removes the MediaDesk startup task and firewall rule. Your config and files are left in place.

[CmdletBinding()]
param([string]$TaskName = 'MediaDesk')

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

if (Invoke-Elevated $PSCommandPath @('-TaskName', "`"$TaskName`"")) { exit }

Stop-MediaDesk $TaskName
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed startup task '$TaskName'."
} else {
    Write-Host "No startup task named '$TaskName' was found."
}

$rule = Get-NetFirewallRule -DisplayName 'MediaDesk' -ErrorAction SilentlyContinue
if ($rule) { $rule | Remove-NetFirewallRule; Write-Host 'Removed firewall rule.' }

Write-Host ''
Write-Host 'Done. Your settings in config\config.json were kept.'
Read-Host 'Press Enter to close'
