# dfl uninstaller (Windows, PowerShell)
# Removes the dfl install, PATH entry, global skills, and MCP registration. Preserves your data
# (~/.dfl/track) unless you pass -Purge. Usage:
#   irm https://enamrik.github.io/dev-workflow/uninstall.ps1 | iex
#   & ([scriptblock]::Create((irm https://enamrik.github.io/dev-workflow/uninstall.ps1))) -Purge
param([switch]$Purge)
$ErrorActionPreference = "Stop"

$DflDir = if ($env:DFL_INSTALL_DIR) { $env:DFL_INSTALL_DIR } else { Join-Path $HOME ".dfl" }
$InstallDir = Join-Path $DflDir "install"

function Info($m) { Write-Host $m -ForegroundColor Blue }
function Ok($m)   { Write-Host "+ $m" -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }

Info "Uninstalling dfl..."

# Install dir. Data in $DflDir\track is left intact.
if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
Ok "Removed install dir"

# Remove the bin dir from the user PATH.
$binDir = Join-Path $InstallDir "bin"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath) {
  $cleaned = ($userPath -split ';' | Where-Object { $_ -and $_ -ne $binDir }) -join ';'
  if ($cleaned -ne $userPath) {
    [Environment]::SetEnvironmentVariable("Path", $cleaned, "User")
    Ok "Removed dfl from PATH"
  }
}

# Global skills.
$skillsDest = Join-Path $HOME ".claude\skills"
if (Test-Path $skillsDest) {
  Get-ChildItem -Path $skillsDest -Directory -Filter "dfl-*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
  Ok "Removed dfl-* skills from ~/.claude/skills"
}

# Global MCP registration (best-effort, all scopes).
if (Get-Command claude -ErrorAction SilentlyContinue) {
  foreach ($scope in @("user","local","project")) {
    claude mcp remove dev-workflow-tracker --scope $scope 2>$null | Out-Null
  }
  Ok "Removed MCP registration"
}

if ($Purge) {
  $track = Join-Path $DflDir "track"
  if (Test-Path $track) { Remove-Item -Recurse -Force $track }
  Warn "Purged all data ($DflDir\track)"
} else {
  Info "Data preserved at $DflDir\track. Re-run with -Purge to delete it."
}

Write-Host ""
Write-Host "Uninstall complete." -ForegroundColor Green
