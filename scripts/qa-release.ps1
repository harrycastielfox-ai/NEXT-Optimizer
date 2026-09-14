$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
. (Join-Path $PSScriptRoot "get-windows-installer-targets.ps1")
$tauriConfig = Get-Content -LiteralPath (Join-Path $root "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$releaseDir = Join-Path $root ".release"
$reportPath = Join-Path $releaseDir "qa-latest.json"
$installerTargets = @(Get-NextWindowsInstallerTargets -RootPath $root)
$results = New-Object System.Collections.Generic.List[object]

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

function Invoke-QaStep {
  param(
    [string]$Name,
    [string]$Command,
    [string[]]$Arguments
  )

  Write-Host ""
  Write-Host "== $Name ==" -ForegroundColor Cyan
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $lines = New-Object System.Collections.Generic.List[string]
  $previousErrorActionPreference = $ErrorActionPreference

  try {
    $ErrorActionPreference = "Continue"
    & $Command @Arguments 2>&1 | ForEach-Object {
      $line = [string]$_
      $lines.Add($line)
      Write-Host $line
    }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $watch.Stop()

  $results.Add([pscustomobject]@{
    name       = $Name
    passed     = ($exitCode -eq 0)
    exitCode   = $exitCode
    durationMs = $watch.ElapsedMilliseconds
    outputTail = @($lines | Select-Object -Last 12)
  })
}

Push-Location $root
try {
  Invoke-QaStep "Release gates" "powershell.exe" @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $PSScriptRoot "verify-release-gates.ps1")
  )
  Invoke-QaStep "Branding and copy" "npm.cmd" @("run", "verify:branding-copy")
  Invoke-QaStep "UI shell" "npm.cmd" @("run", "verify:ui-shell")
  Invoke-QaStep "Optimization flow" "npm.cmd" @("run", "verify:optimization-flow")
  Invoke-QaStep "Safe mode flow" "npm.cmd" @("run", "verify:safe-mode-flow")
  Invoke-QaStep "Build mode sync" "npm.cmd" @("run", "verify:build-mode")
  Invoke-QaStep "TypeScript" "npx.cmd" @("tsc", "--noEmit")
  Invoke-QaStep "Pure frontend unit tests" "npm.cmd" @("run", "test:unit")
  Invoke-QaStep "Lint" "npm.cmd" @("run", "lint")
  Invoke-QaStep "Build web" "npm.cmd" @("run", "build")
  Invoke-QaStep "Build Tauri frontend" "npm.cmd" @("run", "build:tauri")
  Invoke-QaStep "Cargo check" "cargo.exe" @("check", "--manifest-path", "src-tauri\Cargo.toml")
  Invoke-QaStep "Audited Cargo unit tests" "powershell.exe" @(
    "-NoProfile",
    "-File", (Join-Path $PSScriptRoot "test-rust-unit-safe.ps1")
  )
} finally {
  Pop-Location
}

$installerReports = @($installerTargets | ForEach-Object {
  $exists = Test-Path -LiteralPath $_.path -PathType Leaf
  $signatureStatus = "Missing"
  $signerSubject = $null
  $sha256 = $null
  $lengthBytes = 0

  if ($exists) {
    $signature = Get-AuthenticodeSignature -LiteralPath $_.path
    $signatureStatus = [string]$signature.Status
    if ($signature.SignerCertificate) {
      $signerSubject = $signature.SignerCertificate.Subject
    }
    $sha256 = (Get-FileHash -LiteralPath $_.path -Algorithm SHA256).Hash
    $lengthBytes = (Get-Item -LiteralPath $_.path).Length
  }

  [pscustomobject]@{
    kind            = $_.kind
    path            = $_.path
    exists          = $exists
    lengthBytes     = $lengthBytes
    sha256          = $sha256
    signatureStatus = $signatureStatus
    signerSubject   = $signerSubject
  }
})

$technicalPass = -not ($results | Where-Object { -not $_.passed })
$installersFound = -not ($installerReports | Where-Object { -not $_.exists })
$signatureValid = -not ($installerReports | Where-Object { $_.signatureStatus -ne "Valid" })
$stepResults = @($results | ForEach-Object { $_ })
$report = [pscustomobject]@{
  generatedAt     = (Get-Date).ToString("o")
  version         = [string]$tauriConfig.version
  technicalPass   = $technicalPass
  releaseReady    = ($technicalPass -and $installersFound -and $signatureValid)
  installers      = $installerReports
  steps           = $stepResults
  manualBlockers  = @(
    "Instalacao e navegacao em maquina limpa Windows 10/11",
    "Execucao real controlada dos Botoes 1 e 2",
    "Validacao manual de rollback em VM descartavel",
    "Certificado oficial com Authenticode valido"
  )
}

$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host ""
Write-Host "Relatorio QA: $reportPath"
Write-Host "Tecnico: $(if ($technicalPass) { 'PASSOU' } else { 'FALHOU' })"
Write-Host "Instaladores: $(if ($installersFound) { 'ENCONTRADOS' } else { 'AUSENTES' })"
foreach ($installer in $installerReports) {
  Write-Host ("- {0}: {1} | Assinatura: {2}" -f $installer.kind.ToUpperInvariant(), $(if ($installer.exists) { 'ENCONTRADO' } else { 'AUSENTE' }), $installer.signatureStatus)
}
Write-Host "Release publica: $(if ($report.releaseReady) { 'GO' } else { 'NO-GO' })"

if (-not $technicalPass) {
  exit 1
}
