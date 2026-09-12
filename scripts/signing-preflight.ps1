param(
  [string]$CertificateThumbprint = $env:HERMES_CERT_THUMBPRINT,
  [string]$TimestampUrl = $env:HERMES_TIMESTAMP_URL,
  [switch]$Tsp
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
. (Join-Path $PSScriptRoot "get-windows-installer-targets.ps1")
$releaseDir = Join-Path $root ".release"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

function Normalize-Thumbprint {
  param([string]$Thumbprint)

  return ($Thumbprint -replace "\s", "").ToUpperInvariant()
}

function Get-SigningCertificateOrNull {
  param([string]$Thumbprint)

  if ([string]::IsNullOrWhiteSpace($Thumbprint)) {
    return $null
  }

  $normalizedThumbprint = Normalize-Thumbprint $Thumbprint
  $stores = @("Cert:\CurrentUser\My", "Cert:\LocalMachine\My")

  foreach ($store in $stores) {
    $certificate = Get-ChildItem -Path $store -ErrorAction SilentlyContinue |
      Where-Object { (Normalize-Thumbprint $_.Thumbprint) -eq $normalizedThumbprint } |
      Select-Object -First 1

    if ($certificate) {
      return [pscustomobject]@{
        store       = $store
        certificate = $certificate
      }
    }
  }

  return $null
}

function Get-InstallerReport {
  param(
    [string]$Kind,
    [string]$Path
  )

  $exists = Test-Path -LiteralPath $Path -PathType Leaf
  $signatureStatus = "Missing"
  $signerSubject = $null
  $sha256 = $null
  $lengthBytes = 0

  if ($exists) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    $signatureStatus = [string]$signature.Status
    if ($signature.SignerCertificate) {
      $signerSubject = $signature.SignerCertificate.Subject
    }
    $sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    $lengthBytes = (Get-Item -LiteralPath $Path).Length
  }

  return [pscustomobject]@{
    kind            = $Kind
    path            = $Path
    exists          = $exists
    lengthBytes     = $lengthBytes
    sha256          = $sha256
    signatureStatus = $signatureStatus
    signerSubject   = $signerSubject
  }
}

function Find-SignToolOrNull {
  $pathCommand = Get-Command "signtool.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pathCommand) {
    return [pscustomobject]@{
      path   = $pathCommand.Source
      source = "PATH"
    }
  }

  $candidateRoots = @(
    (Join-Path $env:ProgramFiles "Windows Kits\10\bin"),
    (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"),
    (Join-Path $env:ProgramFiles "Windows Kits\8.1\bin"),
    (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\8.1\bin")
  ) | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Container)
  }

  $candidates = foreach ($candidateRoot in $candidateRoots) {
    Get-ChildItem -LiteralPath $candidateRoot -Recurse -Filter "signtool.exe" -File -ErrorAction SilentlyContinue |
      ForEach-Object {
        $score = 0
        if ($_.FullName -match "\\x64\\signtool\.exe$") { $score += 100 }
        if ($_.FullName -match "\\x86\\signtool\.exe$") { $score += 50 }
        if ($_.FullName -match "\\arm64\\signtool\.exe$") { $score += 10 }
        if ($_.FullName -match "\\10\.0\.(\d+)\.") {
          $score += [int]$Matches[1]
        }

        [pscustomobject]@{
          path   = $_.FullName
          source = "WindowsKits"
          score  = $score
        }
      }
  }

  $bestCandidate = $candidates | Sort-Object score, path -Descending | Select-Object -First 1
  if (-not $bestCandidate) {
    return $null
  }

  return [pscustomobject]@{
    path   = $bestCandidate.path
    source = $bestCandidate.source
  }
}

if ([string]::IsNullOrWhiteSpace($TimestampUrl)) {
  $TimestampUrl = "http://timestamp.digicert.com"
}

$normalizedThumbprint = if ([string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
  $null
} else {
  Normalize-Thumbprint $CertificateThumbprint
}

$certificateMatch = Get-SigningCertificateOrNull -Thumbprint $CertificateThumbprint
$certificate = if ($certificateMatch) { $certificateMatch.certificate } else { $null }
$signtool = Find-SignToolOrNull

$installerReports = @(Get-NextWindowsInstallerTargets -RootPath $root | ForEach-Object {
  Get-InstallerReport -Kind $_.kind -Path $_.path
})

$blockers = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

if ([string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
  $blockers.Add("HERMES_CERT_THUMBPRINT nao definido.")
} elseif (-not $certificateMatch) {
  $blockers.Add("Certificado nao encontrado em Cert:\CurrentUser\My ou Cert:\LocalMachine\My.")
} else {
  if (-not $certificate.HasPrivateKey) {
    $blockers.Add("Certificado encontrado, mas sem chave privada.")
  }
  if ($certificate.NotAfter -lt (Get-Date)) {
    $blockers.Add("Certificado expirado em $($certificate.NotAfter.ToString('yyyy-MM-dd')).")
  }
}

if (-not $signtool) {
  $warnings.Add("signtool.exe nao encontrado no PATH nem no Windows Kits. Tauri pode assinar via configuracao, mas o SDK ajuda na verificacao manual.")
}

foreach ($installer in $installerReports) {
  if (-not $installer.exists) {
    $warnings.Add("Instalador $($installer.kind.ToUpperInvariant()) ausente para verificar assinatura atual.")
  } elseif ($installer.signatureStatus -ne "Valid") {
    $warnings.Add("Instalador $($installer.kind.ToUpperInvariant()) esta $($installer.signatureStatus).")
  }
}

$readyToSign = $blockers.Count -eq 0
$allInstallersSigned = -not ($installerReports | Where-Object { $_.signatureStatus -ne "Valid" })

$report = [pscustomobject]@{
  generatedAt              = (Get-Date).ToString("o")
  readyToSign              = $readyToSign
  allInstallersSigned      = $allInstallersSigned
  certificateThumbprint    = $normalizedThumbprint
  certificateFound         = [bool]$certificateMatch
  certificateStore         = if ($certificateMatch) { $certificateMatch.store } else { $null }
  certificateSubject       = if ($certificate) { $certificate.Subject } else { $null }
  certificateNotAfter      = if ($certificate) { $certificate.NotAfter.ToString("o") } else { $null }
  certificateHasPrivateKey = if ($certificate) { [bool]$certificate.HasPrivateKey } else { $false }
  timestampUrl             = $TimestampUrl
  tsp                      = [bool]$Tsp
  signtoolPath             = if ($signtool) { $signtool.path } else { $null }
  signtoolSource           = if ($signtool) { $signtool.source } else { $null }
  installers               = $installerReports
  blockers                 = @($blockers)
  warnings                 = @($warnings)
}

$jsonPath = Join-Path $releaseDir "signing-preflight.json"
$mdPath = Join-Path $releaseDir "signing-preflight.md"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

$markdown = New-Object System.Collections.Generic.List[string]
$markdown.Add("# Hermes Signing Preflight")
$markdown.Add("")
$markdown.Add("- Pronto para assinar: **$(if ($readyToSign) { 'SIM' } else { 'NAO' })**")
$markdown.Add("- Instaladores ja assinados: **$(if ($allInstallersSigned) { 'SIM' } else { 'NAO' })**")
$markdown.Add("- Certificado encontrado: $(if ($certificateMatch) { 'sim' } else { 'nao' })")
$markdown.Add("- Chave privada: $(if ($certificate -and $certificate.HasPrivateKey) { 'sim' } else { 'nao' })")
$markdown.Add("- Timestamp: $TimestampUrl")
$markdown.Add("- SignTool: $(if ($signtool) { "$($signtool.path) ($($signtool.source))" } else { 'nao encontrado' })")
$markdown.Add("")
$markdown.Add("## Instaladores")
$markdown.Add("")
foreach ($installer in $installerReports) {
  $markdown.Add("- $($installer.kind.ToUpperInvariant()): $($installer.signatureStatus) | $($installer.path)")
}
$markdown.Add("")
$markdown.Add("## Bloqueios")
$markdown.Add("")
if ($blockers.Count -gt 0) {
  foreach ($blocker in $blockers) {
    $markdown.Add("- $blocker")
  }
} else {
  $markdown.Add("- Nenhum bloqueio de certificado.")
}
$markdown.Add("")
$markdown.Add("## Avisos")
$markdown.Add("")
if ($warnings.Count -gt 0) {
  foreach ($warning in $warnings) {
    $markdown.Add("- $warning")
  }
} else {
  $markdown.Add("- Nenhum aviso.")
}
$markdown.Add("")
$markdown.Add("## Comando recomendado")
$markdown.Add("")
$markdown.Add("~~~powershell")
$markdown.Add('$env:HERMES_CERT_THUMBPRINT = "SHA1_THUMBPRINT_DO_CERTIFICADO"')
$markdown.Add('$env:HERMES_TIMESTAMP_URL = "' + $TimestampUrl + '"')
$markdown.Add("npm run build:windows:real:signed")
$markdown.Add("~~~")

$markdown | Set-Content -LiteralPath $mdPath -Encoding UTF8

Write-Host "Signing preflight: $(if ($readyToSign) { 'PRONTO' } else { 'BLOQUEADO' })"
Write-Host "Instaladores assinados: $(if ($allInstallersSigned) { 'SIM' } else { 'NAO' })"
Write-Host "Certificado: $(if ($certificateMatch) { $certificate.Subject } else { 'nao encontrado' })"
Write-Host "Evidencia: $jsonPath"
Write-Host "Resumo: $mdPath"

if ($blockers.Count -gt 0) {
  Write-Host ""
  Write-Host "Bloqueios:" -ForegroundColor Yellow
  foreach ($blocker in $blockers) {
    Write-Host "- $blocker" -ForegroundColor Yellow
  }
}
