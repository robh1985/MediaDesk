# Removes the MediaDesk service (or the startup task of older installs) and the firewall rule.
# Your settings, data and the MediaDesk folder are left in place.

[CmdletBinding()]
param([string]$TaskName = 'MediaDesk')

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

if (Invoke-Elevated $PSCommandPath @('-TaskName', "`"$TaskName`"")) { exit }

Stop-MediaDesk $TaskName
if (Get-Service -Name $MediaDeskServiceName -ErrorAction SilentlyContinue) {
    & sc.exe delete $MediaDeskServiceName | Out-Null
    Write-Host "Removed the '$MediaDeskServiceName' service."
}
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed startup task '$TaskName'."
}

$rule = Get-NetFirewallRule -DisplayName 'MediaDesk' -ErrorAction SilentlyContinue
if ($rule) { $rule | Remove-NetFirewallRule; Write-Host 'Removed firewall rule.' }

Write-Host ''
Write-Host 'Done. Your settings and data in the config folder were kept.'
Read-Host 'Press Enter to close'
