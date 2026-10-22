# Installs MediaDesk as a background task that starts with Windows.
#
# - Runs "node server.js" at boot as the SYSTEM account (no login needed) and
#   restarts it if it crashes.
# - Optionally sets the portal password and port in config\config.json.
# - Opens the port in Windows Firewall for Private/Domain networks.
#
# Usage (from an elevated or normal PowerShell; it will ask for admin rights):
#   .\scripts\windows\install-service.ps1 [-Port 8080] [-NoFirewall]

[CmdletBinding()]
param(
    [int]$Port = 0,
    [string]$TaskName = 'MediaDesk',
    [switch]$NoFirewall
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

# Re-launch elevated if needed.
$passArgs = @('-TaskName', "`"$TaskName`"")
if ($Port) { $passArgs += @('-Port', $Port) }
if ($NoFirewall) { $passArgs += '-NoFirewall' }
if (Invoke-Elevated $PSCommandPath $passArgs) { exit }

$root = $MediaDeskRoot
$serverJs = $MediaDeskServerJs
$configDir = Join-Path $root 'config'
$configPath = $MediaDeskConfig
$logDir = $MediaDeskLogDir

function Pause-Exit([int]$code) {
    Write-Host ''
    Read-Host 'Press Enter to close'
    exit $code
}

Write-Host ''
Write-Host '=== MediaDesk setup ===' -ForegroundColor Cyan
Write-Host "Folder: $root"

if (-not (Test-Path $serverJs)) {
    Write-Host "server.js not found in $root" -ForegroundColor Red
    Pause-Exit 1
}

# --- Node.js ---------------------------------------------------------------
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host 'Node.js was not found. Install the LTS version from https://nodejs.org and run this again.' -ForegroundColor Red
    Pause-Exit 1
}
$nodePath = $node.Source
$nodeVersion = (& $nodePath --version).TrimStart('v')
if ([int]($nodeVersion.Split('.')[0]) -lt 18) {
    Write-Host "Node.js $nodeVersion is too old; MediaDesk needs 18 or newer. Update from https://nodejs.org" -ForegroundColor Red
    Pause-Exit 1
}
Write-Host "Node.js: $nodeVersion ($nodePath)"

# --- Config: password and port --------------------------------------------
New-Item -ItemType Directory -Force -Path $configDir, $logDir | Out-Null
$config = [pscustomobject]@{}
if (Test-Path $configPath) {
    $raw = [IO.File]::ReadAllText($configPath).TrimStart([char]0xFEFF)
    if ($raw.Trim()) { $config = $raw | ConvertFrom-Json }
}

$hasPassword = [bool]($config.PSObject.Properties['portalPassword'] -and $config.portalPassword)
Write-Host ''
if ($hasPassword) {
    $prompt = 'Portal password (press Enter to keep the current one)'
} else {
    $prompt = 'Choose a portal password (recommended; press Enter for none)'
}
$secure = Read-Host -Prompt $prompt -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ($password) {
    $config | Add-Member -NotePropertyName portalPassword -NotePropertyValue $password -Force
    $hasPassword = $true
}

if (-not $Port) {
    if ($config.PSObject.Properties['port'] -and $config.port) { $Port = [int]$config.port } else { $Port = 8080 }
}
$config | Add-Member -NotePropertyName port -NotePropertyValue $Port -Force

# Write UTF-8 *without* a byte-order mark so Node can parse it.
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))

# Keep the config (it holds API keys) readable only by admins, SYSTEM and you.
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $configPath /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "${me}:F" | Out-Null

# --- Startup task -----------------------------------------------------------
# Stop any running copy first (including a node process left behind by an older task).
Stop-MediaDesk $TaskName
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Run node directly (not through a batch file) so ending the task really stops MediaDesk.
$logFile = Join-Path $logDir 'mediadesk.log'
$action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$serverJs`" --log `"$logFile`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'MediaDesk portal for Radarr, Sonarr, NZBGet and Jellyfin' | Out-Null
Write-Host "Startup task '$TaskName' registered."

# --- Firewall ---------------------------------------------------------------
if (-not $NoFirewall) {
    Get-NetFirewallRule -DisplayName 'MediaDesk' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName 'MediaDesk' -Direction Inbound -Protocol TCP -LocalPort $Port `
        -Action Allow -Profile Private, Domain | Out-Null
    Write-Host "Firewall: allowed TCP $Port on Private and Domain networks."
}

# --- Start and check --------------------------------------------------------
Start-ScheduledTask -TaskName $TaskName
Write-Host 'Starting MediaDesk...'
$ok = Wait-MediaDesk $Port

Write-Host ''
if ($ok) {
    Write-Host 'MediaDesk is running.' -ForegroundColor Green
    Write-Host "  On this PC:        http://localhost:$Port"
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -ExpandProperty IPAddress
    foreach ($ip in $ips) { Write-Host "  On your network:   http://${ip}:$Port" }
    if (-not $hasPassword) {
        Write-Host ''
        Write-Host 'No portal password is set. Anyone on your network can open the portal.' -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host 'Next: open the portal, go to Settings > Connections and add your services.'
    Start-Process "http://localhost:$Port"
} else {
    Write-Host 'MediaDesk did not respond yet.' -ForegroundColor Yellow
    Show-MediaDeskLogTail
    Write-Host ''
    Write-Host "If the log says port $Port is in use, another program is using it. Re-run with -Port 8081 to pick another."
}
Pause-Exit 0
