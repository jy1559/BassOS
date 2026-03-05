param(
  [string]$Name = "BassOS",
  [switch]$SkipFrontendBuild
)

$ErrorActionPreference = "Stop"

function Resolve-NpmCommand {
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npm) { return $npm.Source }

  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($npm) { return $npm.Source }

  $fallback = "C:\Program Files\nodejs\npm.cmd"
  if (Test-Path $fallback) { return $fallback }

  throw "npm was not found. Install Node.js or add npm to PATH."
}

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit code: $LASTEXITCODE)"
  }
}

Invoke-Native -FilePath "python" -Arguments @("-m", "pip", "install", "-r", "requirements.txt") -FailureMessage "pip install failed"

$iconPng = "designPack/docs/icon.png"
$iconIco = "designPack/docs/icon.ico"
if (!(Test-Path $iconPng)) {
  throw "Required icon not found: $iconPng"
}
$frontendIcon = "frontend/public/app-icon.png"
Copy-Item $iconPng $frontendIcon -Force

if (-not $SkipFrontendBuild) {
  $npmCmd = Resolve-NpmCommand
  $nodeDir = Split-Path -Parent $npmCmd
  if (!(Test-Path (Join-Path $nodeDir "node.exe"))) {
    throw "node.exe not found near npm: $nodeDir"
  }
  if ($env:PATH -notlike "*$nodeDir*") {
    $env:PATH = "$nodeDir;$env:PATH"
  }

  Write-Host "Using npm: $npmCmd"

  Push-Location frontend
  try {
    if (!(Test-Path "node_modules")) {
      Invoke-Native -FilePath $npmCmd -Arguments @("ci") -FailureMessage "npm ci failed"
    }
    Invoke-Native -FilePath $npmCmd -Arguments @("run", "build") -FailureMessage "npm run build failed"
  }
  finally {
    Pop-Location
  }
}

if (!(Test-Path "frontend/dist/index.html")) {
  Write-Host "frontend/dist not found. Build frontend first."
  exit 1
}

$latestSrc = Get-ChildItem "frontend/src" -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$latestDist = Get-ChildItem "frontend/dist" -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($latestSrc -and $latestDist -and $latestDist.LastWriteTime -lt $latestSrc.LastWriteTime) {
  throw "frontend/dist is older than frontend/src. Frontend build is stale."
}

try {
@"
from pathlib import Path
from PIL import Image

src = Path(r"$iconPng")
dst = Path(r"$iconIco")
if src.exists():
    img = Image.open(src).convert("RGBA")
    side = max(img.width, img.height)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    offset = ((side - img.width) // 2, (side - img.height) // 2)
    canvas.paste(img, offset, img)
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    canvas.save(dst, format="ICO", sizes=sizes)
"@ | python -
  if ($LASTEXITCODE -ne 0) { throw "icon conversion failed" }
} catch {
  throw "Failed to convert $iconPng to .ico"
}

$legacyExe = "dist/$Name.exe"
if (Test-Path $legacyExe) {
  Remove-Item $legacyExe -Force
}

$pyInstallerArgs = @(
  "--noconfirm",
  "--clean",
  "--windowed",
  "--name", $Name
)
if (Test-Path $iconIco) {
  $pyInstallerArgs += @("--icon", $iconIco)
}
$pyInstallerArgs += @(
  "--add-data", "frontend/dist;frontend/dist",
  "--add-data", "designPack/data;designPack/data",
  "--add-data", "designPack/mock_datasets;designPack/mock_datasets",
  "--add-data", "designPack/docs/icon.png;designPack/docs",
  "--add-data", "designPack/docs/icon.ico;designPack/docs",
  "desktop.py"
)
Invoke-Native -FilePath "pyinstaller" -Arguments $pyInstallerArgs -FailureMessage "PyInstaller build failed"

Write-Host "EXE build complete: dist/$Name/$Name.exe"
