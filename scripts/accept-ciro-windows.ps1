# CIRO V0.8 Windows local acceptance; use a disposable Windows user / VM.
# No GitHub Actions dispatch or paid cloud runners.
param([switch]$InstallInDisposableSession)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$receiptDir = Join-Path $repo '.ciro-runtime\acceptance'
New-Item -ItemType Directory -Path $receiptDir -Force | Out-Null
$receiptPath = Join-Path $receiptDir 'ciro-v08-windows-local.json'
$receipt = [ordered]@{
  schema = 'ciro.v08.windows-local-acceptance.v1'
  observedAt = (Get-Date).ToUniversalTime().ToString('o')
  commit = 'UNKNOWN'
  nodeTests = 'NOT_RUN'
  frontendBuild = 'NOT_RUN'
  browserE2E = 'NOT_RUN'
  windowsNsisBuild = 'NOT_RUN'
  installerSHA256 = $null
  signatureStatus = 'NOT_RUN'
  cleanInstallBootUninstall = 'NOT_RUN'
  githubLiveRead = 'NOT_RUN'
  nativeModelStream = 'NOT_RUN'
  nativeNcpaAuthority = 'NOT_VERIFIED'
  graduated = $false
  warnings = @()
}
function Save-Receipt {
  $receipt.observedAt = (Get-Date).ToUniversalTime().ToString('o')
  ($receipt | ConvertTo-Json -Depth 7) | Set-Content -Path $receiptPath -Encoding utf8
}
function Assert-Command([string]$cmd) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Missing local command: $cmd" }
}
function Run-Local([string]$label,[string[]]$argv) {
  Write-Host ('LOCAL: ' + ($argv -join ' '))
  $tail = @($argv | Select-Object -Skip 1)
  & $argv[0] @tail
  if ($LASTEXITCODE -ne 0) { throw "$label failed with exit $LASTEXITCODE" }
  $receipt[$label] = 'PASS'
  Save-Receipt
}
try {
  if ([System.Environment]::OSVersion.Platform -ne 'Win32NT') {
    throw 'Actual Windows host required. Linux Wine/emulation is not Windows acceptance.'
  }
  Assert-Command 'node'
  Assert-Command 'npm'
  Assert-Command 'git'
  Push-Location $repo
  try {
    $receipt.commit = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Exact Git commit unavailable' }
    $dirty = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0) {
      throw 'Git working tree must be clean to qualify the exact commit'
    }
    if (-not (Test-Path (Join-Path $repo 'node_modules\express\package.json'))) {
      throw 'Local production dependencies missing. On a trusted Windows host first run npm install --no-audit --no-fund. No paid CI will be started.'
    }
    Run-Local 'nodeTests' @('npm','test')
    Run-Local 'frontendBuild' @('npm','run','build')
    Run-Local 'browserE2E' @('npm','run','test:e2e')
    Run-Local 'windowsNsisBuild' @('npm','run','desktop:win')
    $setups = @(Get-ChildItem -Path (Join-Path $repo 'release') -Filter 'Ciro-Desktop-*-Setup.exe' -File | Sort-Object LastWriteTime -Descending)
    if ($setups.Count -lt 1) { throw 'No Windows NSIS setup EXE was produced' }
    $setup = $setups[0].FullName
    $receipt.installerSHA256 = (Get-FileHash -Path $setup -Algorithm SHA256).Hash.ToLowerInvariant()
    $receipt.signatureStatus = (Get-AuthenticodeSignature -FilePath $setup).Status.ToString()
    Save-Receipt
    if ($InstallInDisposableSession) {
      $dataDir = Join-Path $env:APPDATA 'Ciro'
      $installDir = Join-Path $env:LOCALAPPDATA 'CiroAcceptanceInstall'
      if ((Test-Path $dataDir) -or (Test-Path $installDir)) {
        throw 'Existing Ciro user data or install found. Use a fresh disposable Windows user account.'
      }
      Write-Host 'Installing candidate into the disposable per-user location.'
      & $setup '/S' ("/D=" + $installDir)
      if ($LASTEXITCODE -ne 0) { throw 'NSIS silent installation failed' }
      $appExe = Join-Path $installDir 'Ciro.exe'
      if (-not (Test-Path $appExe)) { throw 'Installed Ciro.exe not found' }
      $appProcess = Start-Process -FilePath $appExe -PassThru
      try {
        $started = $false
        for ($i=0; $i -lt 45; $i++) {
          Start-Sleep -Seconds 1
          if (Test-Path (Join-Path $dataDir 'desktop-secrets.json')) { $started = $true; break }
          if ($appProcess.HasExited) { break }
        }
        if (-not $started) { throw 'Desktop first-start key file not created' }
        if ($appProcess.HasExited) { throw 'Ciro quit unexpectedly after first boot' }
        $windowReady = $false
        for ($i=0; $i -lt 30; $i++) {
          $appProcess.Refresh()
          if ($appProcess.MainWindowHandle -ne [IntPtr]::Zero) { $windowReady = $true; break }
          Start-Sleep -Seconds 1
        }
        if (-not $windowReady) { throw 'Electron main window did not become visible' }
        if (-not $appProcess.CloseMainWindow()) { throw 'Could not request a clean Electron window close' }
        if (-not $appProcess.WaitForExit(10000)) { throw 'Desktop failed to close cleanly within 10 s' }
      } finally {
        if (-not $appProcess.HasExited) {
          Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
        }
      }
      $uninstaller = Join-Path $installDir 'Uninstall Ciro.exe'
      if (-not (Test-Path $uninstaller)) { throw 'NSIS uninstaller was not generated' }
      & $uninstaller '/S'
      if ($LASTEXITCODE -ne 0) { throw 'NSIS uninstaller failed' }
      if (Test-Path $appExe) { throw 'Ciro.exe persisted after uninstallation' }
      if (-not (Test-Path (Join-Path $dataDir 'desktop-secrets.json'))) {
        throw 'NSIS uninstall deleted owner data without consent'
      }
      $receipt.cleanInstallBootUninstall = 'PASS_DISPOSABLE_WINDOWS_USER'
      Save-Receipt
    } else {
      $receipt.warnings += 'Clean install/bootstrap/uninstall not run: use -InstallInDisposableSession on a fresh disposable Windows user.'
    }
    if ($env:CIRO_ACCEPTANCE_BASE_URL -and $env:CIRO_ACCEPTANCE_EMAIL -and
        $env:CIRO_ACCEPTANCE_PASSWORD -and $env:CIRO_ACCEPTANCE_REPO) {
      $livePath = Join-Path $receiptDir 'ciro-v08-live-client.json'
      & node (Join-Path $repo 'scripts\verify-ciro-desktop-live.mjs') | Set-Content -Path $livePath -Encoding utf8
      if ($LASTEXITCODE -ne 0) { throw 'Live CIRO login/GitHub/model probe failed' }
      $live = Get-Content $livePath -Raw | ConvertFrom-Json
      if ($live.github.status -eq 'PASS_LIVE_READ') { $receipt.githubLiveRead = 'PASS_LIVE_READ' }
      if ($live.model.status -eq 'PASS_HTTP_STREAM') { $receipt.nativeModelStream = 'PASS_HTTP_STREAM_ONLY' }
      Save-Receipt
    } else {
      $receipt.warnings += 'CIRO local endpoint and credentials not provided: no live login or inference test was run.'
    }
    $receipt.warnings += 'Native NCPA provenance and human-approved GitHub write/draft PR need separate evidence.'
  } finally { Pop-Location }
} catch {
  $receipt.warnings += ('FAIL: ' + $_.Exception.Message)
  Save-Receipt
  Write-Error ('CIRO Windows acceptance stopped: ' + $_.Exception.Message)
  exit 1
}
Save-Receipt
Write-Host ('Receipt: ' + $receiptPath)
Write-Host 'CIRO full graduation: NOT QUALIFIED until native NCPA provenance and live approved writes are proven.'
