# Fails if the Windows installer, or a PowerShell script the agent runs, has a
# syntax error. The agent's scripts live in its code, so the OS updates test
# writes them to release/ps before this runs.
$ErrorActionPreference = "Stop"
$paths = @(Join-Path $PSScriptRoot "install-agent.ps1")
$generated = Join-Path (Split-Path $PSScriptRoot -Parent) "release/ps"
if (Test-Path $generated) {
  $paths += Get-ChildItem -Path $generated -Filter *.ps1 | ForEach-Object { $_.FullName }
}
$failed = $false
foreach ($path in $paths) {
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errors) | Out-Null
  if ($errors) {
    $errors | ForEach-Object { Write-Host "$(Split-Path $path -Leaf):$($_.Extent.StartLineNumber): $($_.Message)" }
    $failed = $true
  } else {
    Write-Host "$(Split-Path $path -Leaf) parses cleanly"
  }
}
if ($failed) { exit 1 }
