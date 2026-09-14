param(
  [string]$OutputRoot,
  [string]$ResultsRoot,
  [switch]$PreserveTemp,
  [switch]$AllowInstallSmoke
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $root ".release\manual-qa-test-drop"
}
if ([string]::IsNullOrWhiteSpace($ResultsRoot)) {
  $ResultsRoot = Join-Path $OutputRoot "results"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runRoot = Join-Path $ResultsRoot "auto-$timestamp"
$logsRoot = Join-Path $runRoot "logs"
$tempRoot = Join-Path $OutputRoot "tmp\auto-$timestamp"
$extractRoot = Join-Path $tempRoot "extracted"

New-Item -ItemType Directory -Force -Path $logsRoot | Out-Null
New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null

$steps = New-Object System.Collections.Generic.List[object]

function Read-JsonFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "JSON nao encontrado: $Path"
  }

  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function ConvertTo-RelativeLogPath {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return $null
  }

  return $Path
}

function Invoke-LoggedProcess {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$ArgumentList,
    [hashtable]$Environment
  )

  $safeName = $Name -replace "[^a-zA-Z0-9_.-]", "-"
  $stdoutPath = Join-Path $logsRoot "$safeName.stdout.log"
  $stderrPath = Join-Path $logsRoot "$safeName.stderr.log"
  $startedAt = Get-Date

  $oldEnv = @{}
  if ($Environment) {
    foreach ($key in $Environment.Keys) {
      $oldEnv[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
      [Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], "Process")
    }
  }

  try {
    $process = Start-Process `
      -FilePath $FilePath `
      -ArgumentList $ArgumentList `
      -WorkingDirectory $root `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -NoNewWindow `
      -Wait `
      -PassThru

    $exitCode = [int]$process.ExitCode
  } finally {
    if ($Environment) {
      foreach ($key in $Environment.Keys) {
        [Environment]::SetEnvironmentVariable($key, $oldEnv[$key], "Process")
      }
    }
  }

  $endedAt = Get-Date
  $step = [pscustomobject]@{
    name = $Name
    filePath = $FilePath
    arguments = @($ArgumentList)
    startedAt = $startedAt.ToString("o")
    endedAt = $endedAt.ToString("o")
    durationSeconds = [math]::Round(($endedAt - $startedAt).TotalSeconds, 3)
    exitCode = $exitCode
    stdout = ConvertTo-RelativeLogPath $stdoutPath
    stderr = ConvertTo-RelativeLogPath $stderrPath
  }
  $steps.Add($step)

  if ($exitCode -ne 0) {
    throw "Etapa '$Name' falhou com exit code $exitCode. Logs: $stdoutPath / $stderrPath"
  }

  return $step
}

function Assert-PathInside {
  param(
    [string]$Path,
    [string]$Parent
  )

  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $resolvedParent = [System.IO.Path]::GetFullPath($Parent)
  if (-not $resolvedParent.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $resolvedParent += [System.IO.Path]::DirectorySeparatorChar
  }

  if (-not $resolvedPath.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Caminho fora da pasta esperada. Path=$resolvedPath Parent=$resolvedParent"
  }
}

function Test-ManualQaSessionReady {
  $manualQaRoot = Join-Path $root ".release\manual-qa"
  if (-not (Test-Path -LiteralPath $manualQaRoot -PathType Container)) {
    return $false
  }

  $latestSession = Get-ChildItem -LiteralPath $manualQaRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $latestSession) {
    return $false
  }

  return (Test-Path -LiteralPath (Join-Path $latestSession.FullName "manual-qa-session.json") -PathType Leaf)
}

$report = [ordered]@{
  generatedAt = (Get-Date).ToString("o")
  status = "RUNNING"
  runRoot = $runRoot
  logsRoot = $logsRoot
  tempRoot = $tempRoot
  autoSafeMode = (-not [bool]$AllowInstallSmoke)
  allowInstallSmoke = [bool]$AllowInstallSmoke
  admin = [bool]([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  notes = if ($AllowInstallSmoke) {
    @(
      "Fluxo executado com -AllowInstallSmoke.",
      "Esta modalidade permite instalacao/GUI do install smoke e deve rodar somente em GitHub Actions, VM limpa ou maquina descartavel.",
      "Este modo e necessario para fechar os P0 install-nsis e install-msi."
    )
  } else {
    @(
      "Fluxo local executado em HERMES_QA_AUTO_SAFE=1.",
      "Etapas de instalacao/GUI sao bloqueadas pelo runner para evitar alteracao permanente no Windows do host.",
      "Itens de instalacao e Authenticode continuam bloqueios reais para release publico."
    )
  }
  zip = $null
  sha256 = $null
  runner = $null
  generatedEvidence = $null
  copiedEvidenceTo = $null
  steps = @()
  warnings = @()
  failures = @()
}

try {
  if ($AllowInstallSmoke -and -not [bool]$report.admin) {
    throw "Install smoke real exige PowerShell/runner em modo administrador. Rode em GitHub Actions windows-latest, VM limpa elevada ou maquina descartavel elevada."
  }

  if (-not (Test-ManualQaSessionReady)) {
    Invoke-LoggedProcess `
      -Name "00-build-windows-test-for-clean-runner" `
      -FilePath "npm.cmd" `
      -ArgumentList @("run", "build:windows:test") | Out-Null

    Invoke-LoggedProcess `
      -Name "00-release-internal-for-clean-runner" `
      -FilePath "npm.cmd" `
      -ArgumentList @("run", "release:internal") | Out-Null
  }

  Invoke-LoggedProcess `
    -Name "01-create-drop" `
    -FilePath "npm.cmd" `
    -ArgumentList @("run", "qa:manual:drop") | Out-Null

  Invoke-LoggedProcess `
    -Name "02-package-drop-zip" `
    -FilePath "npm.cmd" `
    -ArgumentList @("run", "qa:manual:drop:zip") | Out-Null

  $packageManifestPath = Join-Path $OutputRoot "latest-manual-qa-test-drop-package.json"
  $packageManifest = Read-JsonFile -Path $packageManifestPath
  $zipPath = [string]$packageManifest.zipPath
  $shaPath = [string]$packageManifest.zipSha256Path
  $expectedSha = [string]$packageManifest.zipSha256

  if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) {
    throw "ZIP do drop nao encontrado: $zipPath"
  }
  if (-not (Test-Path -LiteralPath $shaPath -PathType Leaf)) {
    throw "Arquivo SHA256 do ZIP nao encontrado: $shaPath"
  }

  $actualSha = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
  if ($actualSha -ne $expectedSha) {
    throw "SHA256 do ZIP diverge. Esperado=$expectedSha Atual=$actualSha"
  }

  $shaFileContent = Get-Content -LiteralPath $shaPath -Raw
  if ($shaFileContent -notmatch [regex]::Escape($actualSha)) {
    throw "Arquivo .sha256 nao contem o hash calculado."
  }

  $report.zip = $zipPath
  $report.sha256 = $actualSha

  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

  $runner = Get-ChildItem -LiteralPath $extractRoot -Recurse -File -Filter "RODAR-QA-HERMES-NA-VM.ps1" |
    Sort-Object FullName |
    Select-Object -First 1
  if (-not $runner) {
    throw "Runner RODAR-QA-HERMES-NA-VM.ps1 nao encontrado depois de extrair o ZIP."
  }
  $report.runner = $runner.FullName

  $runnerEnvironment = if ($AllowInstallSmoke) {
    @{ HERMES_QA_AUTO_SAFE = "0" }
  } else {
    @{ HERMES_QA_AUTO_SAFE = "1" }
  }

  Invoke-LoggedProcess `
    -Name "03-run-extracted-runner-pending-evidence" `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runner.FullName, "-InitializeOnly") `
    -Environment $runnerEnvironment | Out-Null

  $generatedEvidence = Get-ChildItem -LiteralPath $extractRoot -Recurse -Directory -Filter "HermesQA" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $generatedEvidence) {
    throw "Pasta HermesQA nao encontrada no ambiente temporario."
  }
  $manualEvidence = Join-Path $generatedEvidence.FullName "manual-qa-evidence.json"
  if (-not (Test-Path -LiteralPath $manualEvidence -PathType Leaf)) {
    throw "manual-qa-evidence.json nao foi gerado em $($generatedEvidence.FullName)."
  }
  $report.generatedEvidence = $generatedEvidence.FullName

  $latestDrop = Read-JsonFile -Path (Join-Path $OutputRoot "latest-manual-qa-test-drop.json")
  $targetEvidence = Join-Path ([string]$latestDrop.extractedPackage) "HermesQA"
  Assert-PathInside -Path $targetEvidence -Parent ([string]$latestDrop.dropRoot)
  if (Test-Path -LiteralPath $targetEvidence -PathType Container) {
    Remove-Item -LiteralPath $targetEvidence -Recurse -Force
  }
  Copy-Item -LiteralPath $generatedEvidence.FullName -Destination $targetEvidence -Recurse -Force
  $report.copiedEvidenceTo = $targetEvidence

  Invoke-LoggedProcess `
    -Name "04-drop-check" `
    -FilePath "npm.cmd" `
    -ArgumentList @("run", "qa:manual:drop:check") | Out-Null

  $receiveEnvironment = if ($AllowInstallSmoke) {
    @{ HERMES_QA_ALLOW_WITHOUT_INSTALL_SMOKE = "0" }
  } else {
    @{ HERMES_QA_ALLOW_WITHOUT_INSTALL_SMOKE = "1" }
  }

  Invoke-LoggedProcess `
    -Name "05-drop-receive" `
    -FilePath "npm.cmd" `
    -ArgumentList @("run", "qa:manual:drop:receive") `
    -Environment $receiveEnvironment | Out-Null

  $report.status = "OK"
} catch {
  $report.status = "FAILED"
  $report.failures += $_.Exception.Message
} finally {
  $report.steps = @($steps.ToArray())
  $jsonPath = Join-Path $runRoot "manual-qa-drop-auto-result.json"
  $mdPath = Join-Path $runRoot "manual-qa-drop-auto-result.md"
  $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

  $markdown = New-Object System.Collections.Generic.List[string]
  $markdown.Add("# Hermes Manual QA Drop Auto")
  $markdown.Add("")
  $markdown.Add("- Status: **$($report.status)**")
  $markdown.Add("- Auto safe mode: $($report.autoSafeMode)")
  $markdown.Add("- Allow install smoke: $($report.allowInstallSmoke)")
  $markdown.Add("- Admin: $($report.admin)")
  $markdown.Add("- ZIP: $($report.zip)")
  $markdown.Add("- SHA256: $($report.sha256)")
  $markdown.Add("- Runner: $($report.runner)")
  $markdown.Add("- Evidencia gerada: $($report.generatedEvidence)")
  $markdown.Add("- Evidencia copiada para: $($report.copiedEvidenceTo)")
  $markdown.Add("")
  $markdown.Add("## Etapas")
  $markdown.Add("")
  foreach ($step in @($report.steps)) {
    $markdown.Add("- $($step.name): exit $($step.exitCode) em $($step.durationSeconds)s")
    $markdown.Add(("  - stdout: ``{0}``" -f $step.stdout))
    $markdown.Add(("  - stderr: ``{0}``" -f $step.stderr))
  }
  $markdown.Add("")
  $markdown.Add("## Observacoes")
  $markdown.Add("")
  foreach ($note in @($report.notes)) {
    $markdown.Add("- $note")
  }
  $markdown.Add("")
  $markdown.Add("## Falhas")
  $markdown.Add("")
  if (@($report.failures).Count -gt 0) {
    foreach ($failure in @($report.failures)) {
      $markdown.Add("- $failure")
    }
  } else {
    $markdown.Add("- Nenhuma falha.")
  }
  $markdown | Set-Content -LiteralPath $mdPath -Encoding UTF8

  if (-not $PreserveTemp -and (Test-Path -LiteralPath $tempRoot -PathType Container)) {
    Assert-PathInside -Path $tempRoot -Parent (Join-Path $OutputRoot "tmp")
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }

  Write-Host "Manual QA drop auto: $($report.status)"
  Write-Host "Resultado: $jsonPath"
  Write-Host "Resumo: $mdPath"
}

if ($report.status -ne "OK") {
  exit 1
}
