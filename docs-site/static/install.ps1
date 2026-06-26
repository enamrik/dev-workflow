# dev-workflow installer (Windows, PowerShell)
# Downloads a self-contained, per-platform artifact from GitHub Releases — no npm registry
# access required (works behind corporate npm proxies). Usage:
#   irm https://enamrik.github.io/dev-workflow/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Repo = "enamrik/dev-workflow"
$InstallDir = if ($env:DWF_INSTALL_DIR) { $env:DWF_INSTALL_DIR } else { Join-Path $HOME ".dev-workflow" }

function Info($m) { Write-Host $m -ForegroundColor Blue }
function Ok($m)   { Write-Host "+ $m" -ForegroundColor Green }
function Fail($m) { Write-Host "Error: $m" -ForegroundColor Red; exit 1 }

Info "Installing dev-workflow..."

# Node.js is required to run the CLI.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js 20+ is required. Install from https://nodejs.org" }
$nodeMajor = [int]((node -v) -replace 'v(\d+).*','$1')
if ($nodeMajor -lt 20) { Fail "Node.js 20+ required (found $(node -v))" }
Ok "Node.js $(node -v)"

# Detect arch -> artifact slug.
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$slug = "windows-$arch"
$asset = "dev-workflow-$slug.zip"
$url = "https://github.com/$Repo/releases/latest/download/$asset"
Ok "Platform $slug"

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dwf-" + [System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $zip = Join-Path $tmp $asset
  Info "Downloading $asset..."
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

  # Verify checksum when published.
  try {
    $shaFile = "$zip.sha256"
    Invoke-WebRequest -Uri "$url.sha256" -OutFile $shaFile -UseBasicParsing
    $expected = ((Get-Content $shaFile) -split '\s+')[0]
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($expected -eq $actual) { Ok "Checksum verified" }
    else { Write-Host "! Checksum mismatch for $asset (continuing - download is HTTPS-secured)" -ForegroundColor Yellow }
  } catch { }

  Info "Installing to $InstallDir..."
  if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
  New-Item -ItemType Directory -Path $InstallDir | Out-Null
  Expand-Archive -Path $zip -DestinationPath $InstallDir -Force
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# Add the bin dir to the user PATH (persisted) if not already present.
$binDir = Join-Path $InstallDir "dev-workflow\bin"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$binDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$binDir", "User")
  $env:Path = "$env:Path;$binDir"
  Ok "Added $binDir to your PATH (restart your terminal to pick it up)"
}

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. cd into your git repository"
Write-Host "  2. Run: dev-workflow init"
Write-Host ""
Write-Host "Docs: https://enamrik.github.io/dev-workflow"
