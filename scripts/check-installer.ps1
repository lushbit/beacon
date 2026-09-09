# Fails if the Windows installer has a syntax error.
$ErrorActionPreference = "Stop"
$path = Join-Path $PSScriptRoot "install-agent.ps1"
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errors) | Out-Null
if ($errors) {
  $errors | ForEach-Object { Write-Host "$($_.Extent.StartLineNumber): $($_.Message)" }
  exit 1
}
Write-Host "install-agent.ps1 parses cleanly"
