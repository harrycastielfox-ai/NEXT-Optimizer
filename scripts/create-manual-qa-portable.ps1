param(
  [string]$SessionPath,
  [string]$SessionsRoot
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
if ([string]::IsNullOrWhiteSpace($SessionsRoot)) {
  $SessionsRoot = Join-Path $root ".release\manual-qa"
}

if ([string]::IsNullOrWhiteSpace($SessionPath)) {
  if (-not (Test-Path -LiteralPath $SessionsRoot -PathType Container)) {
    throw "Pasta de sessoes de QA manual nao encontrada: $SessionsRoot"
  }

  $latestSession = Get-ChildItem -LiteralPath $SessionsRoot -Directory |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $latestSession) {
    throw "Nenhuma sessao de QA manual encontrada. Execute npm run qa:manual:new primeiro."
  }

  $SessionPath = $latestSession.FullName
}

if (-not (Test-Path -LiteralPath $SessionPath -PathType Container)) {
  throw "Sessao de QA manual nao encontrada: $SessionPath"
}

$sessionJsonPath = Join-Path $SessionPath "manual-qa-session.json"
if (-not (Test-Path -LiteralPath $sessionJsonPath -PathType Leaf)) {
  throw "Arquivo manual-qa-session.json ausente: $sessionJsonPath"
}

$session = Get-Content -LiteralPath $sessionJsonPath -Raw | ConvertFrom-Json
$candidatePath = [string]$session.candidatePath
if ([string]::IsNullOrWhiteSpace($candidatePath) -or -not (Test-Path -LiteralPath $candidatePath -PathType Container)) {
  throw "Release candidate da sessao nao encontrado: $candidatePath"
}

$installSmokeScript = Join-Path $PSScriptRoot "create-manual-qa-install-smoke.ps1"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installSmokeScript -SessionPath $SessionPath

function New-ManualQaChecklist {
  param(
    [object]$Session,
    [string]$Path
  )

  $installerLines = (@($Session.installers) | ForEach-Object {
    "- $($_.kind.ToUpperInvariant()): $($_.relativePath) | SHA256 $($_.sha256) | Authenticode $($_.signatureStatus)"
  }) -join "`r`n"

  if ([string]::IsNullOrWhiteSpace($installerLines)) {
    $installerLines = "- Nenhum instalador registrado na sessao."
  }

  $itemLines = (@($Session.items) | ForEach-Object {
    $status = if ([string]::IsNullOrWhiteSpace([string]$_.status)) { "pending" } else { [string]$_.status }
    "- [ ] [$($_.priority)] $($_.area) - $($_.title)`r`n  - Status atual: $status`r`n  - Esperado: $($_.expected)`r`n  - Evidencia: $($_.evidence)`r`n  - Notas: $($_.notes)"
  }) -join "`r`n`r`n"

  if ([string]::IsNullOrWhiteSpace($itemLines)) {
    $itemLines = "- Nenhum item registrado na sessao."
  }

  $markdown = @"
# NEX Optimizer - Sessao de QA Manual

Status: $($Session.status)
Tester: $($Session.tester)
Gerado em: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Release candidate: $($Session.candidateName)
Decisao publica atual: $($Session.publicDecision)

## Instaladores

$installerLines

## Como preencher

- Marque cada item como aprovado ou falhou.
- Anexe print, video curto, hash, mensagem de erro ou observacao objetiva.
- Qualquer falha P0 mantem o release como NO-GO.
- NotSigned e aceitavel para teste interno, mas bloqueia release publica.

## Checklist

$itemLines

## Decisao final do QA manual

- [ ] APROVADO para proxima etapa interna
- [ ] REPROVADO / manter NO-GO

Resumo:

"@

  $markdown | Set-Content -LiteralPath $Path -Encoding UTF8
}

$checklistPath = Join-Path $SessionPath "manual-qa-checklist.md"
if (-not (Test-Path -LiteralPath $checklistPath -PathType Leaf)) {
  New-ManualQaChecklist -Session $session -Path $checklistPath
  Write-Host "Checklist manual ausente reconstruido:"
  Write-Host "- $checklistPath"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$packageName = "hermes-manual-qa-portable-$($session.version)-$timestamp"
$portableRoot = Join-Path $SessionPath $packageName
$portableRc = Join-Path $portableRoot "HermesRC"
$portableQa = Join-Path $portableRoot "HermesQA"

New-Item -ItemType Directory -Force -Path $portableRc | Out-Null
New-Item -ItemType Directory -Force -Path $portableQa | Out-Null

Copy-Item -Path (Join-Path $candidatePath "*") -Destination $portableRc -Recurse -Force

$qaFiles = @(
  "run-install-smoke.ps1",
  "install-smoke-readme.md",
  "manual-qa-checklist.md",
  "manual-qa-session.json",
  "manual-qa-summary.md",
  "manual-qa-verification.json"
)

foreach ($fileName in $qaFiles) {
  $sourcePath = Join-Path $SessionPath $fileName
  if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $portableQa $fileName) -Force
  }
}

$launcherPath = Join-Path $portableRoot "RUN-INSTALL-SMOKE.ps1"
$launcher = @'
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$rcPath = Join-Path $root "HermesRC"
$qaPath = Join-Path $root "HermesQA"
$smokePath = Join-Path $qaPath "run-install-smoke.ps1"

if (-not (Test-Path -LiteralPath $smokePath -PathType Leaf)) {
  throw "run-install-smoke.ps1 nao encontrado em $smokePath"
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $smokePath -RcPath $rcPath -QaPath $qaPath
exit $LASTEXITCODE
'@
$launcher | Set-Content -LiteralPath $launcherPath -Encoding UTF8

$manualEvidenceLauncherPath = Join-Path $portableRoot "RUN-MANUAL-QA-EVIDENCE.ps1"
$manualEvidenceLauncher = @'
param(
  [switch]$QuickPassAll,
  [switch]$InitializeOnly,
  [string]$QuickEvidence = "Validado em maquina limpa/VM: janela, rotas, scroll, Dashboard leitura, Botoes 1/2 em modo teste, Fate Trigger, Defender, Manutencao e Configuracoes.",
  [string]$QuickNotes = "Evidencia gerada pelo modo rapido do pacote QA Hermes. Itens protegidos de instalacao e Authenticode ficam fora deste arquivo."
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$qaPath = Join-Path $root "HermesQA"
$sessionPath = Join-Path $qaPath "manual-qa-session.json"

if (-not (Test-Path -LiteralPath $sessionPath -PathType Leaf)) {
  throw "manual-qa-session.json nao encontrado em $sessionPath"
}

$session = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
$manualItemIds = @(
  "normal-window",
  "sidebar-routes",
  "scroll",
  "dashboard-read-only",
  "phase2-locked",
  "prepare-test",
  "restart-gate",
  "optimize-test-fate",
  "safe-mode-no-real-change",
  "defender-page",
  "scheduled-maintenance",
  "settings-language"
)

Write-Host ""
Write-Host "Hermes Manual QA Evidence"
Write-Host "Sessao: $($session.candidateName)"
Write-Host ""
Write-Host "Use: p=passou, f=falhou, b=bloqueado, s=ignorar, Enter=pendente."
Write-Host "Modo rapido por grupos evita responder item por item quando o mesmo teste cobre varias telas."
Write-Host ""

function Convert-ChoiceToStatus {
  param([string]$Choice)

  switch ($Choice.Trim().ToLowerInvariant()) {
    "p" { return "passed" }
    "pass" { return "passed" }
    "passou" { return "passed" }
    "f" { return "failed" }
    "falhou" { return "failed" }
    "b" { return "blocked" }
    "bloqueado" { return "blocked" }
    "s" { return "skipped" }
    "skip" { return "skipped" }
    default { return "pending" }
  }
}

function New-ManualEvidenceEntry {
  param(
    [object]$Item,
    [string]$Status,
    [string]$Evidence,
    [string]$Notes
  )

  return [pscustomobject]@{
    id       = $Item.id
    status   = $Status
    evidence = $Evidence
    notes    = $Notes
  }
}

$results = New-Object System.Collections.Generic.List[object]

if ($InitializeOnly) {
  $evidencePath = Join-Path $qaPath "manual-qa-evidence.json"
  if (Test-Path -LiteralPath $evidencePath -PathType Leaf) {
    Write-Host "Evidencia existente preservada; nenhuma aprovacao manual foi criada."
    return
  }
  foreach ($itemId in $manualItemIds) {
    $item = @($session.items) | Where-Object { $_.id -eq $itemId } | Select-Object -First 1
    if ($item) {
      $results.Add((New-ManualEvidenceEntry -Item $item -Status "pending" -Evidence "" -Notes "Nao testado: exige validacao humana em ambiente autorizado."))
    }
  }
  [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    computerName = $env:COMPUTERNAME
    userName = $env:USERNAME
    candidateName = $session.candidateName
    version = $session.version
    mode = "initialize-pending-only"
    items = @($results.ToArray())
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidencePath -Encoding UTF8
  Write-Host "Checklist inicializado como pendente; nenhum teste funcional aprovado."
  return
}

if ($QuickPassAll) {
  if ([string]$env:HERMES_QA_AUTO_SAFE -eq "1" -or [string]$env:CI -eq "true") {
    throw "Aprovacao manual em lote bloqueada em execucao automatica. Use -InitializeOnly."
  }
  $confirmation = Read-Host "Somente apos testar todos os itens em maquina autorizada, digite VALIDADO para registrar aprovacao"
  if ($confirmation -cne "VALIDADO") { throw "Validacao humana nao confirmada; nada foi aprovado." }
  foreach ($itemId in $manualItemIds) {
    $item = @($session.items) | Where-Object { $_.id -eq $itemId } | Select-Object -First 1
    if (-not $item) {
      continue
    }

    $results.Add((New-ManualEvidenceEntry -Item $item -Status "passed" -Evidence $QuickEvidence -Notes $QuickNotes))
  }

  $report = [pscustomobject]@{
    generatedAt   = (Get-Date).ToString("o")
    computerName  = $env:COMPUTERNAME
    userName      = $env:USERNAME
    candidateName = $session.candidateName
    version       = $session.version
    mode          = "quick-pass-all-non-protected"
    items         = @($results.ToArray())
  }

  $evidencePath = Join-Path $qaPath "manual-qa-evidence.json"
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidencePath -Encoding UTF8

  Write-Host "Evidencia rapida salva em:"
  Write-Host $evidencePath
  Write-Host ""
  Write-Host "Itens de instalacao e Authenticode continuam protegidos e dependem do smoke/assinatura."
  return
}

$quickGroups = @(
  [pscustomobject]@{
    name = "Janela e navegacao"
    ids = @("normal-window", "sidebar-routes", "scroll")
  },
  [pscustomobject]@{
    name = "Fluxo seguro de otimizacao"
    ids = @("dashboard-read-only", "phase2-locked", "prepare-test", "restart-gate", "optimize-test-fate", "safe-mode-no-real-change")
  },
  [pscustomobject]@{
    name = "Telas complementares"
    ids = @("defender-page", "scheduled-maintenance", "settings-language")
  }
)

$quickModeChoice = (Read-Host "Usar modo rapido por grupos? (s/N)").Trim().ToLowerInvariant()
if ($quickModeChoice -in @("s", "sim", "y", "yes")) {
  foreach ($group in $quickGroups) {
    $groupItems = @($group.ids | ForEach-Object {
      $id = $_
      @($session.items) | Where-Object { $_.id -eq $id } | Select-Object -First 1
    } | Where-Object { $_ })

    if ($groupItems.Count -eq 0) {
      continue
    }

    Write-Host "Grupo: $($group.name)"
    foreach ($item in $groupItems) {
      Write-Host "- [$($item.priority)] $($item.id) - $($item.title)"
    }

    $status = Convert-ChoiceToStatus (Read-Host "Resultado do grupo")
    $evidence = ""
    $notes = ""
    if ($status -ne "pending") {
      $evidence = Read-Host "Evidencia curta do grupo"
      $notes = Read-Host "Notas opcionais do grupo"
    }

    foreach ($item in $groupItems) {
      $results.Add((New-ManualEvidenceEntry -Item $item -Status $status -Evidence $evidence -Notes $notes))
    }

    Write-Host ""
  }
} else {
foreach ($itemId in $manualItemIds) {
  $item = @($session.items) | Where-Object { $_.id -eq $itemId } | Select-Object -First 1
  if (-not $item) {
    continue
  }

  Write-Host "[$($item.priority)] $($item.id) - $($item.title)"
  Write-Host "Esperado: $($item.expected)"
  $status = Convert-ChoiceToStatus (Read-Host "Resultado")

  $evidence = ""
  $notes = ""
  if ($status -ne "pending") {
    $evidence = Read-Host "Evidencia curta"
    $notes = Read-Host "Notas opcionais"
  }

  $results.Add((New-ManualEvidenceEntry -Item $item -Status $status -Evidence $evidence -Notes $notes))

  Write-Host ""
}
}

$report = [pscustomobject]@{
  generatedAt   = (Get-Date).ToString("o")
  computerName  = $env:COMPUTERNAME
  userName      = $env:USERNAME
  candidateName = $session.candidateName
  version       = $session.version
  items         = @($results.ToArray())
}

$evidencePath = Join-Path $qaPath "manual-qa-evidence.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidencePath -Encoding UTF8

Write-Host "Evidencia salva em:"
Write-Host $evidencePath
Write-Host ""
Write-Host "Copie este arquivo junto com qualquer HermesQA\\install-smoke-* de volta para a sessao no host."
'@
$manualEvidenceLauncher | Set-Content -LiteralPath $manualEvidenceLauncherPath -Encoding UTF8

$quickPassLauncherPath = Join-Path $portableRoot "RUN-MANUAL-QA-QUICK-PASS.ps1"
$quickPassLauncher = @'
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manualEvidencePath = Join-Path $root "RUN-MANUAL-QA-EVIDENCE.ps1"

if (-not (Test-Path -LiteralPath $manualEvidencePath -PathType Leaf)) {
  throw "RUN-MANUAL-QA-EVIDENCE.ps1 nao encontrado em $manualEvidencePath"
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manualEvidencePath -QuickPassAll
exit $LASTEXITCODE
'@
$quickPassLauncher | Set-Content -LiteralPath $quickPassLauncherPath -Encoding UTF8

$verifyPackagePath = Join-Path $portableRoot "VERIFY-QA-PACKAGE.ps1"
$verifyPackage = @'
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$rcPath = Join-Path $root "HermesRC"
$qaPath = Join-Path $root "HermesQA"
$manifestPath = Join-Path $rcPath "release-candidate-manifest.json"
$failures = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Add-Failure {
  param([string]$Message)
  $script:failures.Add($Message)
}

function Assert-File {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Add-Failure "$Label ausente: $Path"
    return $false
  }

  return $true
}

Write-Host ""
Write-Host "Hermes QA Package Verification"
Write-Host "Pacote: $root"
Write-Host ""

if (-not (Assert-File -Path $manifestPath -Label "Manifesto do RC")) {
  throw "Pacote invalido: manifesto do RC ausente."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
Write-Host "RC: $($manifest.candidateName)"
Write-Host "Versao: $($manifest.version)"
Write-Host "Decisao publica do RC: $($manifest.publicDecision)"

if (-not [bool]$manifest.technicalPass) {
  $warnings.Add("RC nao marcou technicalPass=true.")
}

$requiredFiles = @(
  @{ path = (Join-Path $qaPath "run-install-smoke.ps1"); label = "Smoke de instalacao" },
  @{ path = (Join-Path $qaPath "manual-qa-session.json"); label = "Sessao de QA" },
  @{ path = (Join-Path $qaPath "manual-qa-checklist.md"); label = "Checklist manual" },
  @{ path = (Join-Path $root "RUN-INSTALL-SMOKE.ps1"); label = "Launcher de smoke" },
  @{ path = (Join-Path $root "RUN-MANUAL-QA-EVIDENCE.ps1"); label = "Launcher de evidencia manual" },
  @{ path = (Join-Path $root "RUN-MANUAL-QA-QUICK-PASS.ps1"); label = "Launcher de evidencia rapida" }
)

foreach ($required in $requiredFiles) {
  Assert-File -Path $required.path -Label $required.label | Out-Null
}

foreach ($installer in @($manifest.installers)) {
  $installerPath = Join-Path $rcPath ([string]$installer.relativePath)
  if (-not (Assert-File -Path $installerPath -Label "Instalador $($installer.kind)")) {
    continue
  }

  $item = Get-Item -LiteralPath $installerPath
  if ([int64]$installer.lengthBytes -ne $item.Length) {
    Add-Failure "Tamanho divergente em $($installer.kind): esperado $($installer.lengthBytes), atual $($item.Length)"
  }

  $hash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
  if ($hash -ne [string]$installer.sha256) {
    Add-Failure "SHA256 divergente em $($installer.kind): esperado $($installer.sha256), atual $hash"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
  Write-Host "- $($installer.kind.ToUpperInvariant()): SHA256 OK, Authenticode $($signature.Status)"
  if ([string]$installer.signatureStatus -ne [string]$signature.Status) {
    $warnings.Add("Authenticode atual de $($installer.kind) difere do manifesto: manifesto=$($installer.signatureStatus), atual=$($signature.Status)")
  }
}

if ($warnings.Count -gt 0) {
  Write-Host ""
  Write-Host "Avisos:"
  foreach ($warning in $warnings) {
    Write-Host "- $warning"
  }
}

if ($failures.Count -gt 0) {
  Write-Host ""
  Write-Host "Falhas:"
  foreach ($failure in $failures) {
    Write-Host "- $failure"
  }
  exit 1
}

Write-Host ""
Write-Host "Pacote QA verificado. Pode rodar RUN-INSTALL-SMOKE.ps1."
'@
$verifyPackage | Set-Content -LiteralPath $verifyPackagePath -Encoding UTF8

$readmePath = Join-Path $portableRoot "LEIA-ME-QA-PORTATIL.md"
$readme = @"
# Hermes QA Portatil

- Sessao: $($session.candidateName)
- Versao: $($session.version)
- Origem: $SessionPath
- RC: $candidatePath

## Como usar em VM ou maquina limpa

1. Copie este pacote para uma VM ou maquina Windows limpa.
2. Extraia o ZIP em uma pasta local.
3. Abra PowerShell nessa pasta.
4. Verifique a integridade do pacote:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\VERIFY-QA-PACKAGE.ps1
~~~

5. Rode:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN-INSTALL-SMOKE.ps1
~~~

6. Depois dos testes visuais/fluxos, rode. Use o modo rapido por grupos quando uma mesma evidencia cobrir navegacao, fluxo seguro e telas complementares:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN-MANUAL-QA-EVIDENCE.ps1
~~~

Se tudo visual/fluxo passou na VM e voce quer gerar uma evidencia unica para todos os itens nao protegidos, rode:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN-MANUAL-QA-QUICK-PASS.ps1
~~~

## O que conferir manualmente

- Instalacao NSIS e MSI.
- Janela normal, arrastar, redimensionar, maximizar e restaurar.
- Rotas: Dashboard, Otimizar, Anti-Cheat, Defender, Manutencao Programada e Configuracoes.
- Scroll em telas longas.
- Botao 1 Preparar PC em modo teste.
- Botao 2 bloqueado antes da Fase 1 e fluxo Fate Trigger depois da Fase 1.
- Nenhuma mudanca real no Windows em modo teste.

## Como voltar a evidencia

Depois do smoke e da evidencia manual, copie a pasta `HermesQA` inteira de volta para o host. Pode ser em qualquer pasta local, por exemplo:

~~~text
C:\Temp\HermesQA
~~~

No host do projeto, rode:

~~~powershell
npm run qa:manual:receive -- -EvidenceDropPath "C:\Temp\HermesQA"
~~~

Se precisar depurar em etapas, use `npm run qa:manual:sync`, `npm run qa:manual:import`, `npm run qa:manual:status` e `npm run release:status` separadamente.

Se o smoke passar, o recebimento aprova os itens NSIS/MSI conforme o resultado e reabre os P0 que estavam bloqueados por falta de maquina limpa para revisao manual.
"@
$readme | Set-Content -LiteralPath $readmePath -Encoding UTF8

$zipPath = Join-Path $SessionPath "$packageName.zip"
Compress-Archive -Path (Join-Path $portableRoot "*") -DestinationPath $zipPath -Force
$zipItem = Get-Item -LiteralPath $zipPath
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
$zipShaPath = Join-Path $SessionPath "$packageName.zip.sha256"
"$zipHash *$($zipItem.Name)" | Set-Content -LiteralPath $zipShaPath -Encoding ASCII

$portableManifestPath = Join-Path $SessionPath "$packageName-manifest.json"
$portableManifest = [pscustomobject]@{
  generatedAt     = (Get-Date).ToString("o")
  packageName     = $packageName
  sessionName     = Split-Path -Leaf $SessionPath
  candidateName   = $session.candidateName
  version         = $session.version
  zipPath         = $zipPath
  zipSha256Path   = $zipShaPath
  zipLengthBytes  = $zipItem.Length
  zipSha256       = $zipHash
  portableRoot    = $portableRoot
  requiredCommands = @(
    ".\VERIFY-QA-PACKAGE.ps1",
    ".\RUN-INSTALL-SMOKE.ps1",
    ".\RUN-MANUAL-QA-EVIDENCE.ps1",
    ".\RUN-MANUAL-QA-QUICK-PASS.ps1"
  )
}
$portableManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $portableManifestPath -Encoding UTF8

$guidePath = Join-Path $SessionPath "manual-qa-portable.md"
$guide = @"
# Hermes Manual QA - Pacote Portatil

- Sessao: $($session.candidateName)
- Pasta: $portableRoot
- ZIP: $zipPath
- ZIP SHA256: $zipHash
- ZIP SHA256 file: $zipShaPath
- Manifesto do pacote: $portableManifestPath

## Proximo passo

Copie o ZIP para uma VM ou maquina Windows limpa. Opcionalmente confira o hash antes de extrair:

~~~powershell
Get-FileHash -Algorithm SHA256 .\$($zipItem.Name)
~~~

Extraia e rode:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\VERIFY-QA-PACKAGE.ps1
~~~

Depois rode:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN-INSTALL-SMOKE.ps1
~~~

Depois confira as telas/fluxos do app instalado e gere a evidencia manual. O coletor pode registrar por grupos para nao aprovar item por item quando uma mesma evidencia cobrir varias telas:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN-MANUAL-QA-EVIDENCE.ps1
~~~

Se a validacao visual/fluxos passou inteira em VM, gere a evidencia rapida de todos os itens nao protegidos:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN-MANUAL-QA-QUICK-PASS.ps1
~~~

Depois copie a pasta `HermesQA` inteira de volta para qualquer pasta local no host, por exemplo `C:\Temp\HermesQA`. O recebimento copia a evidencia para a sessao correta.

Se preferir copiar manualmente para a sessao, os arquivos principais sao:

- `HermesQA\install-smoke-*`
- `HermesQA\manual-qa-evidence.json`, se ele foi gerado

No host do projeto, rode:

~~~powershell
npm run qa:manual:receive -- -EvidenceDropPath "C:\Temp\HermesQA"
~~~

Quando o smoke voltar com launch detectado, o recebimento tira os P0 dependentes de maquina limpa do estado bloqueado e deixa esses itens prontos para aprovacao manual.
"@
$guide | Set-Content -LiteralPath $guidePath -Encoding UTF8

Write-Host "Pacote portatil de QA gerado:"
Write-Host "- $zipPath"
Write-Host "- $zipShaPath"
Write-Host "- $portableManifestPath"
Write-Host "- $portableRoot"
Write-Host "- $guidePath"
