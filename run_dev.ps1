param(
  [switch]$ApiOnly
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

$npmCmd = Resolve-NpmCommand
Push-Location frontend
try {
  if (Test-Path "package-lock.json") {
    Invoke-Native -FilePath $npmCmd -Arguments @("ci") -FailureMessage "npm ci failed"
  }
  else {
    Invoke-Native -FilePath $npmCmd -Arguments @("install") -FailureMessage "npm install failed"
  }
  Invoke-Native -FilePath $npmCmd -Arguments @("run", "build") -FailureMessage "npm run build failed"
}
finally {
  Pop-Location
}

if ($ApiOnly) {
  Invoke-Native -FilePath "python" -Arguments @("app.py") -FailureMessage "Failed to start API server"
}
else {
  Invoke-Native -FilePath "python" -Arguments @("desktop.py") -FailureMessage "Failed to start desktop app"
}
