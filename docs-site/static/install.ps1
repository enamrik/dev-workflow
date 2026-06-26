# dev-workflow installer (Windows, PowerShell)
# Downloads a self-contained, per-platform artifact from GitHub Releases — no npm registry
# access required (works behind corporate npm proxies). Usage:
#   irm https://enamrik.github.io/dev-workflow/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Repo = "enamrik/dev-workflow"
# ~/.dwf holds both the install (~/.dwf/install) and data (~/.dwf/track). Only the install
# subdir is replaced on (re)install; track/ is left untouched.
$DwfDir = if ($env:DWF_INSTALL_DIR) { $env:DWF_INSTALL_DIR } else { Join-Path $HOME ".dwf" }
$InstallDir = Join-Path $DwfDir "install"

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
    if ($expected -ne $actual) { Fail "Checksum mismatch for $asset - corrupt or incomplete download; retry" }
    Ok "Checksum verified"
  } catch { }

  Info "Installing to $InstallDir..."
  # Replace only the install dir; preserve sibling data in $DwfDir\track. The zip's single
  # top-level dir is "install", so extracting into $DwfDir yields $DwfDir\install.
  if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
  New-Item -ItemType Directory -Force -Path $DwfDir | Out-Null
  Expand-Archive -Path $zip -DestinationPath $DwfDir -Force
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# Install skills globally so they apply across all projects (Claude Code loads
# ~/.claude/skills everywhere). Updating the tool thus updates skills for every project.
$skillsSrc = Join-Path $InstallDir "skills"
if (Test-Path $skillsSrc) {
  $skillsDest = Join-Path $HOME ".claude\skills"
  New-Item -ItemType Directory -Force -Path $skillsDest | Out-Null
  Copy-Item -Path (Join-Path $skillsSrc '*') -Destination $skillsDest -Recurse -Force
  Ok "Installed skills to ~/.claude/skills"
}

# Add the bin dir to the user PATH (persisted) if not already present.
$binDir = Join-Path $InstallDir "bin"
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
Write-Host "  2. Run: dwf init"
Write-Host ""
Write-Host "Docs: https://enamrik.github.io/dev-workflow"
