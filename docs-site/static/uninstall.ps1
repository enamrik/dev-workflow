# dwf uninstaller (Windows, PowerShell)
# Removes the dwf install, PATH entry, global skills, and MCP registration. Preserves your data
# (~/.dwf/track) unless you pass -Purge. Usage:
#   irm https://enamrik.github.io/dev-workflow/uninstall.ps1 | iex
#   & ([scriptblock]::Create((irm https://enamrik.github.io/dev-workflow/uninstall.ps1))) -Purge
param([switch]$Purge)
$ErrorActionPreference = "Stop"

$DwfDir = if ($env:DWF_INSTALL_DIR) { $env:DWF_INSTALL_DIR } else { Join-Path $HOME ".dwf" }
$InstallDir = Join-Path $DwfDir "install"

function Info($m) { Write-Host $m -ForegroundColor Blue }
function Ok($m)   { Write-Host "+ $m" -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }

Info "Uninstalling dwf..."

# Install dir. Data in $DwfDir\track is left intact.
if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
Ok "Removed install dir"

# Remove the bin dir from the user PATH.
$binDir = Join-Path $InstallDir "bin"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath) {
  $cleaned = ($userPath -split ';' | Where-Object { $_ -and $_ -ne $binDir }) -join ';'
  if ($cleaned -ne $userPath) {
    [Environment]::SetEnvironmentVariable("Path", $cleaned, "User")
    Ok "Removed dwf from PATH"
  }
}

# Global skills.
$skillsDest = Join-Path $HOME ".claude\skills"
if (Test-Path $skillsDest) {
  Get-ChildItem -Path $skillsDest -Directory -Filter "dwf-*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
  Ok "Removed dwf-* skills from ~/.claude/skills"
}

# Global MCP registration (best-effort, all scopes).
if (Get-Command claude -ErrorAction SilentlyContinue) {
  foreach ($scope in @("user","local","project")) {
    claude mcp remove dev-workflow-tracker --scope $scope 2>$null | Out-Null
  }
  Ok "Removed MCP registration"
}

if ($Purge) {
  $track = Join-Path $DwfDir "track"
  if (Test-Path $track) { Remove-Item -Recurse -Force $track }
  Warn "Purged all data ($DwfDir\track)"
} else {
  Info "Data preserved at $DwfDir\track. Re-run with -Purge to delete it."
}

Write-Host ""
Write-Host "Uninstall complete." -ForegroundColor Green
