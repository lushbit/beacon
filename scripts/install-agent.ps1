<#
.SYNOPSIS
  Beacon agent installer for Windows.

.EXAMPLE
  & ([scriptblock]::Create((irm https://your-hub/install.ps1))) -Url https://your-hub -Token TOKEN

.DESCRIPTION
  Installs the agent, registers a scheduled task that keeps it running, and
  starts it. Run in an elevated prompt to install for all users.
#>
[CmdletBinding()]
param(
  [string]$Url,
  [string]$Token,
  [string]$InstallDir,
  [switch]$InsecureTls,
  [switch]$Uninstall,
  # Run as SYSTEM from boot instead of in your desktop session. Use this for
  # headless machines and servers. It starts before anyone logs in, but SYSTEM
  # has no desktop, so screen viewing is not available.
  [switch]$SystemService
)

$ErrorActionPreference = "Stop"
$TaskName = "Beacon agent"

function Write-Step($message) { Write-Host "  $message" }

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$isAdmin = Test-Admin
if (-not $InstallDir) {
  $InstallDir = if ($isAdmin) { Join-Path $env:ProgramData "BeaconAgent" } else { Join-Path $env:LOCALAPPDATA "BeaconAgent" }
}

if ($Uninstall) {
  Write-Host "Removing the Beacon agent..."
  Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path -like "*node*" -and (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -like "*BeaconAgent*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
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
  # older ones kept theirs, and nothing the agent runs comes from them, so an
  # older hub still installs from a plain PowerShell window.
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
[ordered]@{
  version      = $manifest.version
  previous     = $previous
  pendingSince = $null
  failures     = 0
} | ConvertTo-Json | Set-Content -Path $statePath -Encoding UTF8

# --------------------------------------------------------------------- config

$configFile = Join-Path $InstallDir "agent.json"
if (Test-Path $configFile) {
  Write-Step "keeping the existing configuration (this device stays enrolled)"
} else {
  if (-not $Token) { throw "-Token is required the first time (create one in the dashboard)" }
  $installId = & node -e "process.stdout.write(require('crypto').randomUUID())"
  $config = [ordered]@{
    url         = $Url
    token       = $Token
    installId   = $installId
    insecureTls = [bool]$InsecureTls
  }
  $config | ConvertTo-Json | Set-Content -Path $configFile -Encoding UTF8

  # Readable only by this account and administrators.
  $acl = Get-Acl $configFile
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().Name, "FullControl", "Allow")
  $acl.SetAccessRule($rule)
  Set-Acl -Path $configFile -AclObject $acl
}

# ---------------------------------------------------------------------- task

Write-Host "Registering the scheduled task..."

$action = New-ScheduledTaskAction -Execute $node.Source `
  -Argument "`"$launcher`" --config `"$configFile`"" -WorkingDirectory $InstallDir

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

if ($SystemService) {
  # Starts with the machine. No desktop session, so no screen viewing.
  if (-not $isAdmin) { throw "-SystemService needs an elevated PowerShell prompt." }
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $triggers = @(New-ScheduledTaskTrigger -AtStartup)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
    -Settings $settings -Principal $principal | Out-Null
  Write-Step "runs as SYSTEM from boot, before anyone logs in"
  Write-Step "screen viewing is unavailable in this mode - SYSTEM has no desktop"
} else {
  # Runs in your own desktop session, which is the only place a screen exists to
  # capture. Elevated installs additionally get full rights over processes.
  $userId = "$env:USERDOMAIN\$env:USERNAME"
  $level = if ($isAdmin) { "Highest" } else { "Limited" }
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel $level
  $triggers = @(New-ScheduledTaskTrigger -AtLogOn -User $userId)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
    -Settings $settings -Principal $principal | Out-Null
  Write-Step "starts when $env:USERNAME logs in, in that desktop session"
  if ($isAdmin) {
    Write-Step "elevated: full process visibility and screen viewing both work"
  } else {
    Write-Step "not elevated: screen viewing works, process control is limited to your account"
    Write-Step "re-run in an elevated prompt for full process rights"
  }
  Write-Step "nothing is reported while no one is logged in - use -SystemService for that instead"
}

Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Done. The device should appear in the dashboard within a few seconds."
Write-Host "Remove it later with:  & ([scriptblock]::Create((irm $Url/install.ps1))) -Uninstall"
