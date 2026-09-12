param(
  [ValidateSet("test", "real")]
  [string]$Mode = "test",

  [ValidateSet("all", "msi", "nsis")]
  [string]$Bundles = "all",

  [switch]$InternalQaBypass,
  [switch]$Signed,
  [string]$CertificateThumbprint = $env:HERMES_CERT_THUMBPRINT,
  [string]$TimestampUrl = $env:HERMES_TIMESTAMP_URL,
  [switch]$Tsp
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
. (Join-Path $PSScriptRoot "get-windows-installer-targets.ps1")
$releaseGateScript = Join-Path $PSScriptRoot "verify-release-gates.ps1"
$safeModeValue = if ($Mode -eq "real") { "false" } else { "true" }
$internalQaBypassValue = if ($InternalQaBypass) { "true" } else { "false" }
$bundleTargets = if ($Bundles -eq "all") { "msi,nsis" } else { $Bundles }

if ($InternalQaBypass -and $Mode -ne "real") {
  throw "O bypass interno de QA so pode ser usado com -Mode real."
}

if ($InternalQaBypass -and $Signed) {
  throw "Build assinado bloqueado: o bypass interno de QA nunca pode acompanhar um release assinado."
}

function Normalize-Thumbprint {
  param([string]$Thumbprint)

  return ($Thumbprint -replace "\s", "").ToUpperInvariant()
}

function Get-HermesSigningCertificate {
  param([string]$Thumbprint)

  $normalizedThumbprint = Normalize-Thumbprint $Thumbprint
  $stores = @("Cert:\CurrentUser\My", "Cert:\LocalMachine\My")

  foreach ($store in $stores) {
    $certificate = Get-ChildItem -Path $store -ErrorAction SilentlyContinue |
      Where-Object { (Normalize-Thumbprint $_.Thumbprint) -eq $normalizedThumbprint } |
      Select-Object -First 1

    if ($certificate) {
      return $certificate
    }
  }

  return $null
}

function Get-HermesInstallerTargets {
  param(
    [string]$RootPath,
    [string]$BundleSelection
  )

  return @(Get-NextWindowsInstallerTargets -RootPath $RootPath -Bundles $BundleSelection)
}

function Assert-HermesSignedInstallers {
  param(
    [array]$Targets,
    [string]$ExpectedThumbprint
  )

  $normalizedExpectedThumbprint = Normalize-Thumbprint $ExpectedThumbprint

  foreach ($target in $Targets) {
    if (-not (Test-Path -LiteralPath $target.path -PathType Leaf)) {
      throw "Assinatura bloqueada: instalador $($target.kind.ToUpperInvariant()) nao encontrado em $($target.path)."
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $target.path
    if ([string]$signature.Status -ne "Valid") {
      throw "Assinatura bloqueada: instalador $($target.kind.ToUpperInvariant()) esta com Authenticode '$($signature.Status)'."
    }

    if (-not $signature.SignerCertificate) {
      throw "Assinatura bloqueada: instalador $($target.kind.ToUpperInvariant()) nao possui certificado de assinatura legivel."
    }

    $actualThumbprint = Normalize-Thumbprint $signature.SignerCertificate.Thumbprint
    if ($actualThumbprint -ne $normalizedExpectedThumbprint) {
      throw "Assinatura bloqueada: instalador $($target.kind.ToUpperInvariant()) foi assinado por thumbprint diferente do configurado."
    }

    Write-Host ("Assinatura valida: {0} | {1}" -f $target.kind.ToUpperInvariant(), $signature.SignerCertificate.Subject) -ForegroundColor Green
  }
}

Write-Host "Validando release gates..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $releaseGateScript
if ($LASTEXITCODE -ne 0) {
  throw "Build bloqueado: os release gates do Hermes falharam."
}

$env:VITE_HERMES_SAFE_TEST_MODE = $safeModeValue
$env:HERMES_SAFE_TEST_MODE = $safeModeValue
$env:VITE_NEX_INTERNAL_QA_BYPASS = $internalQaBypassValue

Write-Host "Hermes Windows build"
Write-Host "Modo: $Mode"
Write-Host "Frontend VITE_HERMES_SAFE_TEST_MODE=$env:VITE_HERMES_SAFE_TEST_MODE"
Write-Host "Backend  HERMES_SAFE_TEST_MODE=$env:HERMES_SAFE_TEST_MODE"
Write-Host "Licenca VITE_NEX_INTERNAL_QA_BYPASS=$env:VITE_NEX_INTERNAL_QA_BYPASS"
Write-Host "Bundles: $bundleTargets"

if ($Mode -eq "real") {
  Write-Host "ATENCAO: este build libera execucao real nas engines implementadas." -ForegroundColor Yellow
}

if ($InternalQaBypass) {
  Write-Host "QA INTERNO: login/licenca ignorados somente neste build nao assinado." -ForegroundColor Yellow
}

$configPath = $null
if ($Signed) {
  if ([string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
    throw "Defina HERMES_CERT_THUMBPRINT ou passe -CertificateThumbprint para assinar o instalador."
  }

  $signingCertificate = Get-HermesSigningCertificate -Thumbprint $CertificateThumbprint
  if (-not $signingCertificate) {
    throw "Certificado de assinatura nao encontrado no Windows Certificate Store para o thumbprint informado."
  }

  if (-not $signingCertificate.HasPrivateKey) {
    throw "Certificado de assinatura encontrado, mas sem chave privada disponivel para assinar."
  }

  if ([string]::IsNullOrWhiteSpace($TimestampUrl)) {
    $TimestampUrl = "http://timestamp.digicert.com"
  }

  $releaseDir = Join-Path $root ".release"
  New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
  $configPath = Join-Path $releaseDir "tauri.windows.signing.generated.json"

  $config = @{
    bundle = @{
      windows = @{
        certificateThumbprint = $CertificateThumbprint.Trim()
        digestAlgorithm       = "sha256"
        timestampUrl          = $TimestampUrl.Trim()
        tsp                   = [bool]$Tsp
      }
    }
  }

  $config | ConvertTo-Json -Depth 8 | Set-Content -Path $configPath -Encoding UTF8
  Write-Host "Assinatura: $($CertificateThumbprint.Trim())"
  Write-Host "Certificado: $($signingCertificate.Subject)"
  Write-Host "Timestamp: $($TimestampUrl.Trim())"
}

Push-Location $root
try {
  $tauriArgs = @("tauri", "build", "--bundles", $bundleTargets)
  if ($configPath) {
    $tauriArgs += @("--config", $configPath)
  }

  & npx.cmd @tauriArgs
  $buildExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($buildExitCode -ne 0) {
  throw "Build Tauri falhou (exit $buildExitCode). Nenhum instalador foi validado."
}

if ($Signed) {
  $installerTargets = Get-HermesInstallerTargets -RootPath $root -BundleSelection $Bundles
  Assert-HermesSignedInstallers -Targets $installerTargets -ExpectedThumbprint $CertificateThumbprint
}
