param(
  [string]$SessionPath,
  [string]$SessionsRoot,
  [string]$OutputRoot,
  [switch]$LaunchSandbox
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$releaseRoot = Join-Path $root ".release"
if ([string]::IsNullOrWhiteSpace($SessionsRoot)) {
  $SessionsRoot = Join-Path $releaseRoot "manual-qa"
}
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $releaseRoot "manual-qa-test-drop"
}

function Read-JsonFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "JSON nao encontrado: $Path"
  }

  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Copy-FileRequired {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Arquivo obrigatorio nao encontrado: $Source"
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Get-SafePathForSandboxXml {
  param([string]$Path)

  return [System.Security.SecurityElement]::Escape($Path)
}

if ([string]::IsNullOrWhiteSpace($SessionPath)) {
  if (-not (Test-Path -LiteralPath $SessionsRoot -PathType Container)) {
    throw "Pasta de sessoes de QA manual nao encontrada: $SessionsRoot"
  }

  $activePath = Join-Path $SessionsRoot "active-manual-qa-session.json"
  $latestSession = $null
  if (Test-Path -LiteralPath $activePath -PathType Leaf) {
    $active = Get-Content -LiteralPath $activePath -Raw | ConvertFrom-Json
    if ($active -and -not [string]::IsNullOrWhiteSpace([string]$active.sessionPath) -and (Test-Path -LiteralPath ([string]$active.sessionPath) -PathType Container)) {
      $latestSession = Get-Item -LiteralPath ([string]$active.sessionPath)
    }
  }

  if (-not $latestSession) {
    $latestSession = Get-ChildItem -LiteralPath $SessionsRoot -Directory |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
  }

  if (-not $latestSession) {
    throw "Nenhuma sessao de QA manual encontrada. Execute npm run qa:manual:new primeiro."
  }

  $SessionPath = $latestSession.FullName
}

if (-not (Test-Path -LiteralPath $SessionPath -PathType Container)) {
  throw "Sessao de QA manual nao encontrada: $SessionPath"
}

$portableScript = Join-Path $PSScriptRoot "create-manual-qa-portable.ps1"
$doctorScript = Join-Path $PSScriptRoot "check-manual-qa-package.ps1"
$planScript = Join-Path $PSScriptRoot "create-manual-qa-action-plan.ps1"

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $portableScript -SessionPath $SessionPath
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao gerar pacote QA portatil."
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $doctorScript -RootPath $SessionPath
if ($LASTEXITCODE -ne 0) {
  throw "Doctor do pacote QA portatil falhou."
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $planScript -SessionPath $SessionPath
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao gerar plano de acao do QA manual."
}

$session = Read-JsonFile -Path (Join-Path $SessionPath "manual-qa-session.json")
$portableManifest = Get-ChildItem -LiteralPath $SessionPath -File -Filter "hermes-manual-qa-portable-*-manifest.json" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $portableManifest) {
  throw "Manifesto do pacote QA portatil nao encontrado em $SessionPath."
}

$portable = Read-JsonFile -Path $portableManifest.FullName
$qaZipPath = [string]$portable.zipPath
if ([string]::IsNullOrWhiteSpace($qaZipPath) -or -not (Test-Path -LiteralPath $qaZipPath -PathType Leaf)) {
  throw "ZIP QA portatil nao encontrado: $qaZipPath"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dropName = "hermes-manual-qa-drop-$($session.version)-$timestamp"
$dropRoot = Join-Path $OutputRoot $dropName
$dropFilesRoot = Join-Path $dropRoot "arquivos"
$dropExtractRoot = Join-Path $dropRoot "qa-extraido"
$dropEvidenceRoot = Join-Path $dropRoot "evidencias"

New-Item -ItemType Directory -Force -Path $dropFilesRoot | Out-Null
New-Item -ItemType Directory -Force -Path $dropExtractRoot | Out-Null
New-Item -ItemType Directory -Force -Path $dropEvidenceRoot | Out-Null

$qaZipName = Split-Path -Leaf $qaZipPath
Copy-FileRequired -Source $qaZipPath -Destination (Join-Path $dropFilesRoot $qaZipName)
if (Test-Path -LiteralPath "$qaZipPath.sha256" -PathType Leaf) {
  Copy-FileRequired -Source "$qaZipPath.sha256" -Destination (Join-Path $dropFilesRoot "$qaZipName.sha256")
}

foreach ($evidenceFile in @(
    "manual-qa-action-plan.md",
    "manual-qa-action-plan.json",
    "manual-qa-summary.md",
    "manual-qa-package-doctor.md"
  )) {
  Copy-FileRequired -Source (Join-Path $SessionPath $evidenceFile) -Destination (Join-Path $dropEvidenceRoot $evidenceFile)
}

Expand-Archive -LiteralPath $qaZipPath -DestinationPath $dropExtractRoot -Force
if (-not (Test-Path -LiteralPath (Join-Path $dropExtractRoot "VERIFY-QA-PACKAGE.ps1") -PathType Leaf)) {
  throw "Falha ao extrair pacote QA portatil em $dropExtractRoot."
}

$vmRunnerPath = Join-Path $dropRoot "RODAR-QA-HERMES-NA-VM.ps1"
$vmRunner = @"
param(
  [switch]`$QuickPassAll,
  [switch]`$InitializeOnly
)

`$ErrorActionPreference = "Stop"

`$dropRoot = Split-Path -Parent `$MyInvocation.MyCommand.Path
`$packageRoot = Join-Path `$dropRoot "qa-extraido"
`$autoSafeMode = [string]`$env:HERMES_QA_AUTO_SAFE -eq "1"

if (-not (Test-Path -LiteralPath `$packageRoot -PathType Container)) {
  throw "Pacote extraido nao encontrado: `$packageRoot"
}

Push-Location `$packageRoot
try {
  powershell -NoProfile -ExecutionPolicy Bypass -File .\VERIFY-QA-PACKAGE.ps1
  if (`$autoSafeMode) {
    Write-Host "HERMES_QA_AUTO_SAFE=1 detectado. Smoke de instalacao/GUI bloqueado para nao alterar o Windows do host."
    `$qaRoot = Join-Path `$packageRoot "HermesQA"
    if (-not (Test-Path -LiteralPath `$qaRoot -PathType Container)) {
      New-Item -ItemType Directory -Force -Path `$qaRoot | Out-Null
    }
    `$blockedReport = [pscustomobject]@{
      generatedAt = (Get-Date).ToString("o")
      status = "BLOCKED_BY_AUTO_SAFE"
      reason = "RUN-INSTALL-SMOKE.ps1 instala e abre o Hermes; o fluxo automatico local bloqueia esta etapa para nao fazer alteracao permanente nem abrir GUI."
      requiresAdmin = `$true
      destructiveOrPersistent = `$true
      recommendedEnvironment = "GitHub Actions windows-latest, Windows Sandbox, VM limpa ou maquina descartavel."
      commandToRunWhenAllowed = "powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN-INSTALL-SMOKE.ps1"
    }
    `$blockedPath = Join-Path `$qaRoot "install-smoke-auto-safe-blocked.json"
    `$blockedReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath `$blockedPath -Encoding UTF8
    Write-Host "Relatorio de bloqueio seguro: `$blockedPath"
  } else {
    powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN-INSTALL-SMOKE.ps1
  }
  if (`$InitializeOnly -or `$autoSafeMode) {
    powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN-MANUAL-QA-EVIDENCE.ps1 -InitializeOnly
  } elseif (`$QuickPassAll) {
    powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN-MANUAL-QA-QUICK-PASS.ps1
  } else {
    powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN-MANUAL-QA-EVIDENCE.ps1
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "QA concluido. Copie a pasta qa-extraido\HermesQA de volta para o host."
"@
$vmRunner | Set-Content -LiteralPath $vmRunnerPath -Encoding UTF8

$receiveCommand = "npm run qa:manual:drop:receive"
$sandboxPath = Join-Path $dropRoot "HERMES-MANUAL-QA.wsb"
$sandboxHostPath = Get-SafePathForSandboxXml -Path $dropRoot
$sandboxCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process explorer.exe ''C:\Users\WDAGUtilityAccount\Desktop\HermesManualQA''; Start-Process notepad.exe ''C:\Users\WDAGUtilityAccount\Desktop\HermesManualQA\LEIA-ME-QA-MANUAL.md''"'
$sandboxXml = @"
<Configuration>
  <VGpu>Enable</VGpu>
  <Networking>Enable</Networking>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <ClipboardRedirection>Enable</ClipboardRedirection>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$sandboxHostPath</HostFolder>
      <SandboxFolder>C:\Users\WDAGUtilityAccount\Desktop\HermesManualQA</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>$sandboxCommand</Command>
  </LogonCommand>
</Configuration>
"@
$sandboxXml | Set-Content -LiteralPath $sandboxPath -Encoding UTF8

$readmePath = Join-Path $dropRoot "LEIA-ME-QA-MANUAL.md"
$readme = New-Object System.Collections.Generic.List[string]
$readme.Add("# Hermes QA Manual - Drop pronto para VM")
$readme.Add("")
$readme.Add("- Sessao: $($session.candidateName)")
$readme.Add("- ZIP QA: $qaZipName")
$readme.Add("- Pacote extraido: $dropExtractRoot")
$readme.Add("- Runner: $vmRunnerPath")
$readme.Add("- Windows Sandbox: $sandboxPath")
$readme.Add("")
$readme.Add("## Dentro da VM ou maquina limpa")
$readme.Add("")
$readme.Add("1. Abra PowerShell nesta pasta.")
$readme.Add("2. Rode:")
$readme.Add("")
$readme.Add("~~~powershell")
$readme.Add("powershell -NoProfile -ExecutionPolicy Bypass -File .\RODAR-QA-HERMES-NA-VM.ps1")
$readme.Add("~~~")
$readme.Add("")
$readme.Add("3. No coletor manual, use o modo rapido por grupos quando a mesma evidencia cobrir varias telas.")
$readme.Add("4. Se voce ja validou que janela, navegacao, scroll, Dashboard, Otimizar, Defender, Manutencao e Configuracoes passaram, rode o runner direto com quick pass:")
$readme.Add("   Internamente, esse modo chama `qa-extraido\RUN-MANUAL-QA-QUICK-PASS.ps1` para gerar a evidencia rapida.")
$readme.Add("")
$readme.Add("~~~powershell")
$readme.Add("powershell -NoProfile -ExecutionPolicy Bypass -File .\RODAR-QA-HERMES-NA-VM.ps1 -QuickPassAll")
$readme.Add("~~~")
$readme.Add("")
$readme.Add("5. Ao finalizar, feche a VM/Sandbox. A pasta `qa-extraido\HermesQA` fica dentro deste drop quando a pasta estiver mapeada.")
$readme.Add("")
$readme.Add("## No host do projeto")
$readme.Add("")
$readme.Add("Se voce usou este drop mapeado na VM/Sandbox, rode:")
$readme.Add("")
$readme.Add("~~~powershell")
$readme.Add("npm run qa:manual:drop:check")
$readme.Add($receiveCommand)
$readme.Add("")
$readme.Add("# Alternativa, se voce copiou HermesQA para outro lugar:")
$readme.Add('npm run qa:manual:receive -- -EvidenceDropPath "C:\Temp\HermesQA"')
$readme.Add("npm run qa:manual:plan")
$readme.Add("npm run release:status")
$readme.Add("~~~")
$readme.Add("")
$readme.Add("## Importante")
$readme.Add("")
$readme.Add("- Este drop e para QA manual, nao e release publico.")
$readme.Add("- O modo teste deve impedir mudancas reais no Windows.")
$readme.Add("- Authenticode continua separado: exige certificado Code Signing real.")
$readme | Set-Content -LiteralPath $readmePath -Encoding UTF8

$manifestPath = Join-Path $dropRoot "manual-qa-test-drop-manifest.json"
$manifest = [pscustomobject]@{
  generatedAt = (Get-Date).ToString("o")
  dropName = $dropName
  dropRoot = $dropRoot
  sessionPath = (Resolve-Path $SessionPath).Path
  candidateName = [string]$session.candidateName
  qaPortableZip = Join-Path $dropFilesRoot $qaZipName
  qaPortableZipSha256 = (Get-FileHash -LiteralPath $qaZipPath -Algorithm SHA256).Hash
  extractedPackage = $dropExtractRoot
  vmRunnerPath = $vmRunnerPath
  sandboxPath = $sandboxPath
  readmePath = $readmePath
  receiveCommand = $receiveCommand
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$latestDropPath = Join-Path $OutputRoot "latest-manual-qa-test-drop.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $latestDropPath -Encoding UTF8

$latestMarkdownPath = Join-Path $OutputRoot "latest-manual-qa-test-drop.md"
$latestMarkdown = New-Object System.Collections.Generic.List[string]
$latestMarkdown.Add("# Hermes Latest Manual QA Test Drop")
$latestMarkdown.Add("")
$latestMarkdown.Add("- Drop: $dropName")
$latestMarkdown.Add("- Pasta: $dropRoot")
$latestMarkdown.Add("- Guia: $readmePath")
$latestMarkdown.Add("- Runner VM: $vmRunnerPath")
$latestMarkdown.Add("- Windows Sandbox: $sandboxPath")
$latestMarkdown.Add("- Recebimento: $receiveCommand")
$latestMarkdown | Set-Content -LiteralPath $latestMarkdownPath -Encoding UTF8

Write-Host "Hermes manual QA test drop gerado:"
Write-Host "- $dropRoot"
Write-Host "- $readmePath"
Write-Host "- $vmRunnerPath"
Write-Host "- $sandboxPath"
Write-Host "- $manifestPath"

if ($LaunchSandbox) {
  Write-Host "Abrindo Windows Sandbox..."
  Start-Process -FilePath $sandboxPath
} else {
  Write-Host "Sandbox nao aberto. Use -LaunchSandbox para abrir automaticamente."
}
