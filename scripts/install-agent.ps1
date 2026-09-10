<#
.SYNOPSIS
  Beacon agent installer for Windows.

.EXAMPLE
  & ([scriptblock]::Create((irm https://your-hub/install.ps1))) -Url https://your-hub -Token TOKEN

.EXAMPLE
  & ([scriptblock]::Create((irm https://your-hub/install.ps1))) -Url https://your-hub -Uninstall

.DESCRIPTION
  Installs the agent as a background service that starts with the machine and
  reports whether or not anyone is signed in, the same way the Linux system
  install does. The install needs administrator rights and elevates itself if
  you let it.
#>
[CmdletBinding()]
param(
  [string]$Url,
  [string]$Token,
  [string]$InstallDir,
  [switch]$InsecureTls,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$TaskName = "Beacon agent"

function Write-Step($message) { Write-Host "  $message" }

# Windows PowerShell's `Set-Content -Encoding UTF8` prepends a UTF-8 BOM, and
# Node's JSON.parse refuses to read one. That left the agent exiting on startup
# with an unreadable state file, no process running and nothing in the
# dashboard, so every JSON file this script writes goes through here instead.
function Write-JsonFile($Path, $Value) {
  $json = $Value | ConvertTo-Json
  [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ------------------------------------------------------------------ elevation

# A machine-wide service and its scheduled task can only be managed elevated.
# The script re-fetches itself into an elevated window, so one command works
# from an ordinary prompt for installing and removing alike. Re-fetching needs
# the hub address, which the uninstall command in the dashboard carries too.
if (-not (Test-Admin)) {
  if (-not $Url) {
    if ($Uninstall) {
      throw "Removing the agent needs administrator rights. Add -Url with your hub's address so the prompt can ask for them, or run the command from Windows PowerShell opened as Administrator."
    }
    throw "-Url is required, for example -Url https://beacon.example.com"
  }
  $Url = $Url.TrimEnd("/")

  if ($Uninstall) {
    Write-Host "Removing the agent needs administrator rights. Approve the prompt to continue in an elevated window."
  } else {
    Write-Host "This install needs administrator rights. Approve the prompt to continue in an elevated window."
  }
  $inner = "& ([scriptblock]::Create((irm '$Url/install.ps1'))) -Url '$Url'"
  if ($Uninstall) { $inner += " -Uninstall" }
  if ($Token) { $inner += " -Token '$Token'" }
  if ($InsecureTls) { $inner += " -InsecureTls" }
  if ($InstallDir) { $inner += " -InstallDir '$InstallDir'" }

  try {
    Start-Process -FilePath "powershell" -Verb RunAs -ArgumentList @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-Command", $inner
    )
  } catch {
    throw "Could not elevate automatically. Open Windows PowerShell as Administrator and run the command again."
  }
  return
}

if (-not $InstallDir) { $InstallDir = Join-Path $env:ProgramData "BeaconAgent" }

# ----------------------------------------------------------------- uninstall

if ($Uninstall) {
  Write-Host "Removing the Beacon agent..."

  # Each step says what it actually did, so a removal can be trusted rather than
  # assumed.
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Step "removed the '$TaskName' scheduled task"
  } else {
    Write-Step "no '$TaskName' scheduled task was registered"
  }

  $stopped = 0
  Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -like "*BeaconAgent*" } |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue; $stopped++ }
  Write-Step "stopped $stopped running agent process(es)"

  if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir
    Write-Step "deleted $InstallDir"
  } else {
    Write-Step "nothing to delete at $InstallDir"
  }

  Write-Host "Done. The device stays in the dashboard until you remove it there."
  return
}

if (-not $Url) { throw "-Url is required, for example -Url https://beacon.example.com" }
$Url = $Url.TrimEnd("/")

# ------------------------------------------------------------------ preflight

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Node.js 20 or newer is required but was not found. Install it from https://nodejs.org and run this again."
}
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { throw "Node.js 20 or newer is required (found $(& node -v))." }

Write-Host "Beacon agent installer"
Write-Step "hub:      $Url"
Write-Step "install:  $InstallDir"

if ($InsecureTls) {
  # Only affects this installer process, not the agent's own TLS handling.
  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
}
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

# --------------------------------------------------------------- install dir

# SYSTEM executes the launcher and everything under versions\, so a standard
# user must not be able to add or replace a file in here. That would be a
# straight path from an ordinary account to code running as SYSTEM. Inheriting
# whatever ProgramData happens to grant is not a strong enough guarantee, so the
# permissions are set explicitly: SYSTEM and administrators may write, everyone
# else may only read.
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$dirAcl = Get-Acl $InstallDir
$dirAcl.SetAccessRuleProtection($true, $false)
$inherit = [System.Security.AccessControl.InheritanceFlags]"ContainerInherit, ObjectInherit"
$noProp = [System.Security.AccessControl.PropagationFlags]::None
$dirAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  "SYSTEM", "FullControl", $inherit, $noProp, "Allow")))
$dirAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  "BUILTIN\Administrators", "FullControl", $inherit, $noProp, "Allow")))
$dirAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  "BUILTIN\Users", "ReadAndExecute", $inherit, $noProp, "Allow")))
Set-Acl -Path $InstallDir -AclObject $dirAcl
Write-Step "locked the install directory to SYSTEM and administrators"

# ------------------------------------------------------------------- download

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("beacon-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temp -Force | Out-Null
$archive = Join-Path $temp "agent.tar.gz"

try {
  Write-Host "Asking the hub which agent build to install..."
  $manifest = Invoke-RestMethod -Uri "$Url/download/manifest.json" -UseBasicParsing
  if (-not $manifest.version -or -not $manifest.filename) { throw "the hub returned an unusable manifest" }
  Write-Step "version:  $($manifest.version)"

  Write-Host "Downloading the agent..."
  Invoke-WebRequest -Uri "$Url/download/$($manifest.filename)" -OutFile $archive -UseBasicParsing
  if (-not (Test-Path $archive) -or (Get-Item $archive).Length -eq 0) {
    throw "the downloaded agent bundle was empty"
  }

  if ($manifest.sha256) {
    $actual = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $manifest.sha256.ToLower()) {
      throw "checksum mismatch - the download does not match what the hub published"
    }
    Write-Step "checksum: verified"
  }

  # Versioned layout: the launcher stays put while versions come and go, which
  # is what lets the agent replace itself later without touching the task.
  $versionDir = Join-Path $InstallDir "versions\$($manifest.version)"
  if (Test-Path $versionDir) { Remove-Item -Recurse -Force $versionDir }
  New-Item -ItemType Directory -Path $versionDir -Force | Out-Null

  # tar ships with Windows 10 1803 and newer.
  #
  # Windows refuses to create a symlink unless the prompt is elevated or
  # developer mode is on, and tar abandons the whole archive at the first one
  # it cannot make. Current bundles contain none; these two paths are where
  # older ones kept theirs, and nothing the agent runs comes from them.
  & tar -xzf $archive -C $versionDir --exclude "node_modules/.bin/*" --exclude "node_modules/@beacon/agent"
  if ($LASTEXITCODE -ne 0) { throw "could not unpack the agent bundle" }
}
finally {
  Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
}

$entry = Join-Path $versionDir "agent\dist\index.js"

if (-not (Test-Path $entry)) { throw "the agent bundle looks incomplete" }

$launcherSource = Join-Path $versionDir "launcher.mjs"
if (-not (Test-Path $launcherSource)) { throw "the agent bundle is missing its launcher" }
$launcher = Join-Path $InstallDir "launcher.mjs"
Copy-Item -Path $launcherSource -Destination $launcher -Force

$statePath = Join-Path $InstallDir "current.json"
$previous = $null
if (Test-Path $statePath) {
  try {
    $existing = Get-Content $statePath -Raw | ConvertFrom-Json
    if ($existing.version -and $existing.version -ne $manifest.version) { $previous = $existing.version }
  } catch { $previous = $null }
}
Write-JsonFile $statePath ([ordered]@{
  version      = $manifest.version
  previous     = $previous
  pendingSince = $null
  failures     = 0
})

# --------------------------------------------------------------------- config

$configFile = Join-Path $InstallDir "agent.json"
if (Test-Path $configFile) {
  Write-Step "keeping the existing configuration (this device stays enrolled)"
} else {
  if (-not $Token) { throw "-Token is required the first time (create one in the dashboard)" }
  $installId = & node -e "process.stdout.write(require('crypto').randomUUID())"
  Write-JsonFile $configFile ([ordered]@{
    url         = $Url
    token       = $Token
    installId   = $installId
    insecureTls = [bool]$InsecureTls
  })

  # The token lives here, and the service runs as SYSTEM, so lock the file down
  # to the service account and administrators.
  $acl = Get-Acl $configFile
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM", "FullControl", "Allow")))
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("BUILTIN\Administrators", "FullControl", "Allow")))
  Set-Acl -Path $configFile -AclObject $acl
}

# ---------------------------------------------------------------------- task

Write-Host "Registering the service..."

# SYSTEM, from boot, always reporting. StartWhenAvailable catches the trigger
# even if the machine was off at boot time, and the restart settings bring the
# agent back if it ever exits.
$action = New-ScheduledTaskAction -Execute $node.Source `
  -Argument "`"$launcher`" --config `"$configFile`"" -WorkingDirectory $InstallDir
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$trigger = New-ScheduledTaskTrigger -AtStartup

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal | Out-Null

# The agent stamps its config every time it reaches the hub. Read the previous
# stamp so a re-install waits for a fresh connection rather than an old one.
function Read-LastConnected {
  try { return [long]((Get-Content $configFile -Raw | ConvertFrom-Json).lastConnectedAt) } catch { return 0 }
}
$before = Read-LastConnected

Start-ScheduledTask -TaskName $TaskName

# Waiting for the stamp to move is what turns "should appear" into proof. It is
# why a device that silently never enrolls tells you here instead of just being
# missing from the dashboard.
Write-Host "Waiting for the device to reach the hub..."
$connected = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if ((Read-LastConnected) -gt $before) { $connected = $true; break }
}

Write-Host ""
Write-Step "runs as a service from boot, so it reports whether or not anyone is signed in"
Write-Host ""
if ($connected) {
  Write-Host "Done. The device is enrolled and reporting to the hub."
} else {
  Write-Host "The service is installed, but the device has not reached the hub yet."
  Write-Host "Check that this machine can open $Url, then look at the 'Beacon agent'"
  Write-Host "task in Task Scheduler. It keeps trying, so the device may still appear."

  # The agent mirrors its output here, so whatever went wrong is readable now
  # rather than being lost with the process that exited.
  $logFile = Join-Path $InstallDir "agent.log"
  if (Test-Path $logFile) {
    Write-Host ""
    Write-Host "Last lines of ${logFile}:"
    Get-Content $logFile -Tail 20 | ForEach-Object { Write-Host "  $_" }
  } else {
    # Built by concatenation so the quoting stays readable and cannot trip the
    # parser the way nested escaped quotes do.
    $manualRun = '  & "' + $node.Source + '" "' + $launcher + '" --config "' + $configFile + '"'
    Write-Host ""
    Write-Host "No ${logFile} was written, so the agent never started. Run this to see why:"
    Write-Host $manualRun
  }
}
Write-Host "Remove it later with:"
Write-Host "  & ([scriptblock]::Create((irm $Url/install.ps1))) -Url $Url -Uninstall"
