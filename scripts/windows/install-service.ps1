# Installs MediaDesk as a Windows service, and moves older installations over to it.
#
# - Finds older installs: the old "MediaDesk" startup task, an earlier service, a copy running
#   from another folder. Stops them, copies their settings and data (config folder) here, and
#   removes the old task, so only one MediaDesk runs. Nothing is deleted from the old folder.
# - Backs up this folder's settings to backups\ before changing anything.
# - Sets the folder up for updates from GitHub (Git), so a parent or admin can update MediaDesk
#   from Settings -> About. A ZIP copy is turned into a Git copy; its settings are kept.
# - Installs the "MediaDesk" service: it starts with Windows (no login needed) as the SYSTEM
#   account, restarts MediaDesk if it stops, and applies updates, going back to the previous
#   version if an update doesn't start. If the service can't be installed, the startup task is
#   used instead.
# - Opens the port in Windows Firewall for Private/Domain networks.
#
# Usage (it asks for admin rights):
#   .\scripts\windows\install-service.ps1 [-Port 8080] [-NoFirewall] [-Yes] [-UseTask] [-MigrateFrom D:\OldMediaDesk]
#   -Yes          take the recommended answer to every question
#   -UseTask      use a startup task instead of a service (how older versions ran)
#   -MigrateFrom  copy settings and data from this folder (otherwise found automatically)

[CmdletBinding()]
param(
    [int]$Port = 0,
    [string]$TaskName = 'MediaDesk',
    [switch]$NoFirewall,
    [switch]$Yes,
    [switch]$UseTask,
    [string]$MigrateFrom = ''
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

# Re-launch elevated if needed.
$passArgs = @('-TaskName', "`"$TaskName`"")
if ($Port) { $passArgs += @('-Port', $Port) }
if ($NoFirewall) { $passArgs += '-NoFirewall' }
if ($Yes) { $passArgs += '-Yes' }
if ($UseTask) { $passArgs += '-UseTask' }
if ($MigrateFrom) { $passArgs += @('-MigrateFrom', "`"$MigrateFrom`"") }
if (Invoke-Elevated $PSCommandPath $passArgs) { exit }

$root = $MediaDeskRoot
$configDir = Join-Path $root 'config'
$configPath = $MediaDeskConfig
$logDir = $MediaDeskLogDir
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$backupDir = Join-Path $root "backups\$stamp"

function Pause-Exit([int]$code) {
    Write-Host ''
    if (-not $Yes) { Read-Host 'Press Enter to close' | Out-Null }
    exit $code
}

# Yes/no question; Enter (or -Yes) takes the default.
function Ask([string]$Question, [bool]$Default = $true) {
    if ($Yes) { return $Default }
    $hint = if ($Default) { '[Y/n]' } else { '[y/N]' }
    $a = Read-Host "$Question $hint"
    if (-not $a) { return $Default }
    return $a.Trim().ToLower().StartsWith('y')
}

function Step([string]$text) { Write-Host ''; Write-Host "--- $text" -ForegroundColor Cyan }

# Copy a config folder: settings, accounts, family data, offline copies of cloud folders...
# Not mounted network/cloud shares (they're other computers' files), rclone's cache, or links.
function Copy-ConfigFolder([string]$From, [string]$To) {
    New-Item -ItemType Directory -Force -Path $To | Out-Null
    & robocopy.exe $From $To /E /COPY:DAT /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP `
        /XD (Join-Path $From 'network') (Join-Path $From 'rclone-cache') | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copying $From to $To failed (robocopy code $LASTEXITCODE)" }
}

# The MediaDesk folder an old task, service or process ran from, or $null.
function Get-FolderFromCommand([string]$Text) {
    if (-not $Text) { return $null }
    $m = [regex]::Match($Text, '([A-Za-z]:\\[^"]*?|\\\\[^"]*?)\\(server|supervisor)\.js', 'IgnoreCase')
    if ($m.Success) { return $m.Groups[1].Value }
    $m = [regex]::Match($Text, '([A-Za-z]:\\[^"]*?|\\\\[^"]*?)\\scripts\\windows\\run-service\.cmd', 'IgnoreCase')
    if ($m.Success) { return $m.Groups[1].Value }
    $m = [regex]::Match($Text, 'MediaDeskService\.exe"?\s+"[^"]*"\s+"([^"]+)"', 'IgnoreCase')
    if ($m.Success) { return $m.Groups[1].Value.TrimEnd('\') }
    return $null
}

function Same-Folder([string]$a, [string]$b) {
    if (-not $a -or -not $b) { return $false }
    return ([IO.Path]::GetFullPath($a).TrimEnd('\') -ieq [IO.Path]::GetFullPath($b).TrimEnd('\'))
}

# Windows PowerShell treats anything git writes to stderr as an error when errors stop the script,
# so git runs with that turned off here and its exit code decides.
function Invoke-Git([string[]]$GitArgs) {
    $ErrorActionPreference = 'Continue'
    $out = & $git -C $root @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' '): $($out | Select-Object -Last 3 | Out-String)" }
    return $out
}

Write-Host ''
Write-Host '=== MediaDesk setup ===' -ForegroundColor Cyan
Write-Host "Folder: $root"

if (-not (Test-Path $MediaDeskServerJs) -or -not (Test-Path $MediaDeskSupervisorJs)) {
    Write-Host "server.js or supervisor.js is missing from $root. Download MediaDesk again." -ForegroundColor Red
    Pause-Exit 1
}

# --- Node.js ---------------------------------------------------------------
$nodePath = Find-Node
if (-not $nodePath) {
    Write-Host 'Node.js was not found. Install the LTS version from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS) and run this again.' -ForegroundColor Red
    Pause-Exit 1
}
$nodeVersion = (& $nodePath --version).TrimStart('v')
if ([int]($nodeVersion.Split('.')[0]) -lt 18) {
    Write-Host "Node.js $nodeVersion is too old; MediaDesk needs 18 or newer. Update from https://nodejs.org" -ForegroundColor Red
    Pause-Exit 1
}
Write-Host "Node.js: $nodeVersion ($nodePath)"

# --- Older installations ------------------------------------------------------
Step 'Looking for older MediaDesk installations'
$oldTasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
    $t = $_
    $t.TaskName -eq $TaskName -or @($t.Actions | Where-Object { Get-FolderFromCommand "$($_.Execute) $($_.Arguments)" }).Count
})
$oldService = Get-MediaDeskService
$folders = New-Object System.Collections.ArrayList
$describe = @{}
function Add-Found([string]$Folder, [string]$What) {
    if (-not $Folder) { return }
    $full = [IO.Path]::GetFullPath($Folder).TrimEnd('\')
    if (-not ($folders | Where-Object { Same-Folder $_ $full })) { [void]$folders.Add($full); $describe[$full] = @() }
    $key = $folders | Where-Object { Same-Folder $_ $full } | Select-Object -First 1
    $describe[$key] += $What
}
foreach ($t in $oldTasks) {
    foreach ($a in $t.Actions) { Add-Found (Get-FolderFromCommand "$($a.Execute) $($a.Arguments)") "startup task '$($t.TaskName)'" }
    if (-not @($t.Actions | Where-Object { Get-FolderFromCommand "$($_.Execute) $($_.Arguments)" }).Count -and $t.Actions[0].WorkingDirectory) {
        Add-Found $t.Actions[0].WorkingDirectory "startup task '$($t.TaskName)'"
    }
}
if ($oldService) { Add-Found (Get-FolderFromCommand $oldService.PathName) 'service' }
foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)) {
    Add-Found (Get-FolderFromCommand $p.CommandLine) "running (process $($p.ProcessId))"
}
if ($MigrateFrom) { Add-Found $MigrateFrom 'chosen with -MigrateFrom' }

if ($folders.Count -eq 0 -and -not $oldTasks.Count) {
    Write-Host 'None found: this is a new installation.'
} else {
    foreach ($f in $folders) {
        $here = if (Same-Folder $f $root) { ' (this folder)' } else { '' }
        Write-Host ("  {0}{1}: {2}" -f $f, $here, (($describe[$f] | Select-Object -Unique) -join ', '))
    }
}

# Settings to bring over from another folder: -MigrateFrom, else the one the old task/service ran.
$source = $null
$others = @($folders | Where-Object { -not (Same-Folder $_ $root) -and (Test-Path (Join-Path $_ 'config')) })
if ($MigrateFrom) {
    if (-not (Test-Path (Join-Path $MigrateFrom 'config'))) { Write-Host "$MigrateFrom has no config folder to copy." -ForegroundColor Red; Pause-Exit 1 }
    $source = [IO.Path]::GetFullPath($MigrateFrom).TrimEnd('\')
} elseif ($others.Count -eq 1) {
    $source = $others[0]
} elseif ($others.Count -gt 1) {
    Write-Host ''
    Write-Host 'Settings were found in more than one folder:'
    for ($i = 0; $i -lt $others.Count; $i++) {
        $cfg = Join-Path $others[$i] 'config\config.json'
        $when = if (Test-Path $cfg) { (Get-Item $cfg).LastWriteTime.ToString('yyyy-MM-dd HH:mm') } else { 'no config.json' }
        Write-Host ("  {0}. {1}  (settings last changed {2})" -f ($i + 1), $others[$i], $when)
    }
    $pick = if ($Yes) { '1' } else { Read-Host 'Copy settings and data from which one? Enter a number, or press Enter to keep this folder''s own' }
    if ($pick -match '^\d+$' -and [int]$pick -ge 1 -and [int]$pick -le $others.Count) { $source = $others[[int]$pick - 1] }
}
if ($source) {
    Write-Host ''
    Write-Host "Settings, accounts and data will be copied from $source"
    Write-Host 'to this folder. That folder is left as it is.'
    if ((Test-Path $configPath) -and -not $MigrateFrom) {
        Write-Host 'This folder has settings of its own too; they are backed up first, then replaced.' -ForegroundColor Yellow
    }
    if (-not (Ask 'Copy them?' $true)) { $source = $null }
}

# --- Stop everything that's running -------------------------------------------
Step 'Stopping MediaDesk'
Stop-MediaDesk $TaskName $root
foreach ($f in $folders) { if (-not (Same-Folder $f $root)) { Stop-MediaDesk $TaskName $f } }
# Anything else still holding the port (for example start-windows.cmd started from its own folder).
$portNow = if ($Port) { $Port } else { Get-MediaDeskPort $(if ($source) { Join-Path $source 'config\config.json' } else { $configPath }) }
$holders = @(Get-NetTCPConnection -LocalPort $portNow -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($procId in $holders) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
    if ($proc -and $proc.Name -eq 'node.exe') {
        Write-Host "Port $portNow is used by Node.js: $($proc.CommandLine)"
        if (Ask 'Is that an old MediaDesk? Stop it?' $true) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
    }
}

# --- Back up, then bring the settings over -------------------------------------
New-Item -ItemType Directory -Force -Path $configDir, $logDir | Out-Null
if (@(Get-ChildItem $configDir -Force -ErrorAction SilentlyContinue).Count) {
    Copy-ConfigFolder $configDir (Join-Path $backupDir 'config')
    Write-Host "Backed up this folder's settings to $backupDir\config"
}
if ($source) {
    Step "Copying settings and data from $source"
    Copy-ConfigFolder (Join-Path $source 'config') $configDir
    Write-Host 'Copied.'
    # Settings that point into the old folder still work while it exists.
    if (Test-Path $configPath) {
        $raw = [IO.File]::ReadAllText($configPath)
        $escaped = ($source -replace '\\', '\\\\')
        if ($raw.IndexOf($escaped, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            Write-Host "Some settings still point to folders inside $source (for example a games or books folder)." -ForegroundColor Yellow
            Write-Host 'Keep that folder, or change those settings in MediaDesk.' -ForegroundColor Yellow
        }
    }
}

# --- Git, for updates from Settings -> About -----------------------------------
Step 'Setting up updates from GitHub'
$git = Find-Git
if (-not $git) {
    Write-Host 'Git is not installed. MediaDesk uses it to download updates.'
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($winget -and (Ask 'Install Git now with winget?' $true)) {
        & $winget.Source install --id Git.Git -e --source winget --silent --accept-package-agreements --accept-source-agreements
        $git = Find-Git
    }
    if (-not $git) { Write-Host 'Continuing without Git: MediaDesk will run, but can''t update itself until Git is installed and this is run again.' -ForegroundColor Yellow }
}
$gitReady = $false
if ($git) {
    Write-Host "Git: $git"
    try {
        if (-not (Test-Path (Join-Path $root '.git'))) {
            Write-Host 'This folder wasn''t installed with Git (for example from a ZIP).'
            Write-Host 'It can be set up for updates: MediaDesk''s own files are replaced with the latest version'
            Write-Host 'from GitHub; settings, accounts and data are kept (and backed up).'
            if (Ask 'Set it up for updates?' $true) {
                $prog = Join-Path $backupDir 'program'
                & robocopy.exe $root $prog /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD (Join-Path $root 'config') $logDir (Join-Path $root 'backups') (Join-Path $root 'service') (Join-Path $root 'node_modules') | Out-Null
                Write-Host "Backed up the current program files to $prog"
                Invoke-Git @('init', '-q') | Out-Null
                Invoke-Git @('remote', 'add', 'origin', $MediaDeskRepoUrl) | Out-Null
                Invoke-Git @('fetch', '-q', 'origin', 'main') | Out-Null
                Invoke-Git @('checkout', '-q', '-f', '-B', 'main', 'origin/main') | Out-Null
                Write-Host 'Done: this folder now follows the main branch on GitHub.'
            }
        } else {
            $remotes = @(Invoke-Git @('remote'))
            if ($remotes -notcontains 'origin') { Invoke-Git @('remote', 'add', 'origin', $MediaDeskRepoUrl) | Out-Null }
            Invoke-Git @('fetch', '-q', 'origin', 'main') | Out-Null
            $branch = (Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD') | Select-Object -First 1).ToString().Trim()
            if ($branch -ne 'main') {
                Write-Host "This copy is on the '$branch' branch; updates are published on main."
                if (Ask 'Switch to main?' $true) {
                    $hasMain = $true
                    try { Invoke-Git @('rev-parse', '--verify', '-q', 'main') | Out-Null } catch { $hasMain = $false }
                    if ($hasMain) { Invoke-Git @('checkout', '-q', 'main') | Out-Null } else { Invoke-Git @('checkout', '-q', '-b', 'main', 'origin/main') | Out-Null }
                }
            }
            $dirty = @(Invoke-Git @('status', '--porcelain', '--untracked-files=no'))
            if ($dirty.Count) { Write-Host "Some of MediaDesk's files were changed by hand; updates from Settings wait until those changes are undone:`n$($dirty -join "`n")" -ForegroundColor Yellow }
        }
        # The service runs as SYSTEM and passes this itself; this is for running git as you
        # (update-windows.cmd), since this window, as admin, may have created files in .git.
        $safe = $root -replace '\\', '/'
        $known = @(try { Invoke-Git @('config', '--global', '--get-all', 'safe.directory') } catch { })
        if ($known -notcontains $safe) { Invoke-Git @('config', '--global', '--add', 'safe.directory', $safe) | Out-Null }
        $gitReady = Test-Path (Join-Path $root '.git')
    } catch {
        Write-Host "Git setup didn't finish: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host 'MediaDesk will still run; updates from Settings won''t until this is fixed.' -ForegroundColor Yellow
    }
}

# --- Config: password and port --------------------------------------------
$config = [pscustomobject]@{}
if (Test-Path $configPath) {
    $raw = [IO.File]::ReadAllText($configPath).TrimStart([char]0xFEFF)
    if ($raw.Trim()) { $config = $raw | ConvertFrom-Json }
}
$hasAccounts = Test-Path (Join-Path $configDir 'users.json')
$hasPassword = [bool]($config.PSObject.Properties['portalPassword'] -and $config.portalPassword)
if (-not $hasAccounts -and -not $hasPassword -and -not $Yes) {
    Write-Host ''
    $secure = Read-Host -Prompt 'Choose a portal password (recommended; press Enter to make an admin account in the browser instead)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($password) {
        $config | Add-Member -NotePropertyName portalPassword -NotePropertyValue $password -Force
        $hasPassword = $true
    }
}
if (-not $Port) {
    if ($config.PSObject.Properties['port'] -and $config.port) { $Port = [int]$config.port } else { $Port = 8080 }
}
$config | Add-Member -NotePropertyName port -NotePropertyValue $Port -Force
# Write UTF-8 *without* a byte-order mark so Node can parse it.
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding $false))

# Keep the config (it holds API keys) readable only by admins, SYSTEM and you.
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $configPath /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "${me}:F" | Out-Null

# --- Remove the old ways of starting it -------------------------------------
Step 'Installing the service'
foreach ($t in $oldTasks) {
    Unregister-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed the old startup task '$($t.TaskName)'."
}
if (Get-Service -Name $MediaDeskServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $MediaDeskServiceName -Force -ErrorAction SilentlyContinue
    & sc.exe delete $MediaDeskServiceName | Out-Null
    for ($i = 0; $i -lt 20 -and (Get-Service -Name $MediaDeskServiceName -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
    Write-Host 'Removed the previous MediaDesk service.'
}

# --- The service ----------------------------------------------------------------
$logFile = Join-Path $logDir 'mediadesk.log'
$mode = $null
if (-not $UseTask) {
    try {
        if (Get-Service -Name $MediaDeskServiceName -ErrorAction SilentlyContinue) {
            throw 'Windows hasn''t finished removing the previous service (close the Services window if it''s open, or restart Windows, then run this again)'
        }
        # Build service\MediaDeskService.exe from its source with the C# compiler that comes with Windows.
        $src = Join-Path $PSScriptRoot 'MediaDeskService.cs'
        New-Item -ItemType Directory -Force -Path (Split-Path $MediaDeskServiceExe) | Out-Null
        if (Test-Path $MediaDeskServiceExe) { Remove-Item $MediaDeskServiceExe -Force }
        try {
            Add-Type -TypeDefinition ([IO.File]::ReadAllText($src)) -Language CSharp -OutputAssembly $MediaDeskServiceExe `
                -OutputType ConsoleApplication -ReferencedAssemblies 'System.ServiceProcess' -ErrorAction Stop
        } catch {
            $csc = @("$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe", "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
            if (-not $csc) { throw }
            & $csc /nologo /target:exe "/out:$MediaDeskServiceExe" /reference:System.ServiceProcess.dll $src | Out-Null
        }
        if (-not (Test-Path $MediaDeskServiceExe)) { throw 'the service program couldn''t be built' }

        if (-not [Diagnostics.EventLog]::SourceExists($MediaDeskServiceName)) { New-EventLog -LogName Application -Source $MediaDeskServiceName -ErrorAction SilentlyContinue }
        $bin = "`"$MediaDeskServiceExe`" `"$nodePath`" `"$root`""
        New-Service -Name $MediaDeskServiceName -BinaryPathName $bin -DisplayName 'MediaDesk' -StartupType Automatic `
            -Description 'MediaDesk web portal. Restarts MediaDesk if it stops and applies updates from Settings -> About.' | Out-Null
        # Start a little after boot (network and drives ready); restart it if it ever fails.
        & sc.exe config $MediaDeskServiceName start= delayed-auto | Out-Null
        & sc.exe failure $MediaDeskServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
        & sc.exe failureflag $MediaDeskServiceName 1 | Out-Null
        Start-Service -Name $MediaDeskServiceName
        $mode = 'service'
        Write-Host "Service '$MediaDeskServiceName' installed (runs as SYSTEM, starts with Windows)."
    } catch {
        Write-Host "The service couldn't be installed: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host 'Using a startup task instead.' -ForegroundColor Yellow
    }
}
if (-not $mode) {
    # Same as the service, through Task Scheduler: node runs supervisor.js, which runs server.js.
    $action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$MediaDeskSupervisorJs`" --log `"$logFile`"" -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
        -Description 'MediaDesk web portal' | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    $mode = 'task'
    Write-Host "Startup task '$TaskName' registered."
}

# --- Firewall ---------------------------------------------------------------
if (-not $NoFirewall) {
    Get-NetFirewallRule -DisplayName 'MediaDesk' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName 'MediaDesk' -Direction Inbound -Protocol TCP -LocalPort $Port `
        -Action Allow -Profile Private, Domain | Out-Null
    Write-Host "Firewall: allowed TCP $Port on Private and Domain networks."
}

# --- Check --------------------------------------------------------------------
Write-Host 'Starting MediaDesk...'
$ok = Wait-MediaDesk $Port 45

Write-Host ''
if ($ok) {
    Write-Host 'MediaDesk is running.' -ForegroundColor Green
    Write-Host "  On this PC:        http://localhost:$Port"
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -ExpandProperty IPAddress
    foreach ($ip in $ips) { Write-Host "  On your network:   http://${ip}:$Port" }
    Write-Host ''
    if ($mode -eq 'service') { Write-Host 'It runs as the MediaDesk service (see services.msc). restart-windows.cmd restarts it.' }
    if ($gitReady) { Write-Host 'Updates: Settings -> About shows new versions to admins and parents, who can update from there.' }
    if ($source) { Write-Host "Your old folder ($source) wasn't changed. Once everything works here, you can delete it." }
    if (-not $hasAccounts -and -not $hasPassword) {
        Write-Host ''
        Write-Host 'No accounts yet: open the portal and make an admin account (Settings -> Users).' -ForegroundColor Yellow
    }
    if (-not $Yes) { Start-Process "http://localhost:$Port" }
} else {
    Write-Host 'MediaDesk did not respond yet.' -ForegroundColor Yellow
    Show-MediaDeskLogTail
    Write-Host ''
    Write-Host "If the log says port $Port is in use, another program is using it. Run this again with -Port 8081 to pick another."
}
Pause-Exit 0
