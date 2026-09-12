$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$failures = New-Object System.Collections.Generic.List[string]

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    $script:failures.Add($Message)
  }
}

function Read-Text {
  param([string]$Path)
  return Get-Content -LiteralPath $Path -Raw -Encoding UTF8
}

$packagePath = Join-Path $root "package.json"
$tauriConfigPath = Join-Path $root "src-tauri\tauri.conf.json"
$manifestPath = Join-Path $root "src-tauri\windows-app-manifest.xml"
$buildRsPath = Join-Path $root "src-tauri\build.rs"
$capabilityPath = Join-Path $root "src-tauri\capabilities\default.json"
$safeModeTsPath = Join-Path $root "src\lib\safe-mode.ts"
$safeModeRsPath = Join-Path $root "src-tauri\src\safe_mode.rs"
$buildModeSyncScript = Join-Path $root "scripts\verify-build-mode-sync.ps1"
$noSigningSecretsScript = Join-Path $root "scripts\verify-no-signing-secrets.ps1"
$manualQaBulkPath = Join-Path $root "scripts\update-manual-qa-bulk.ps1"
$manualQaSelectPath = Join-Path $root "scripts\select-manual-qa-session.ps1"
$manualQaAlignCurrentRcPath = Join-Path $root "scripts\align-manual-qa-to-current-rc.ps1"
$manualQaPlanPath = Join-Path $root "scripts\create-manual-qa-action-plan.ps1"
$manualQaDropPath = Join-Path $root "scripts\create-manual-qa-test-drop.ps1"
$manualQaDropVerifyPath = Join-Path $root "scripts\check-manual-qa-test-drop.ps1"
$manualQaDropReceivePath = Join-Path $root "scripts\receive-manual-qa-test-drop.ps1"
$manualQaDropOpenPath = Join-Path $root "scripts\open-manual-qa-test-drop.ps1"
$manualQaDropZipPath = Join-Path $root "scripts\package-manual-qa-test-drop.ps1"
$manualQaDropAutoPath = Join-Path $root "scripts\run-manual-qa-test-drop-auto.ps1"
$manualQaDropInstallElevatedPath = Join-Path $root "scripts\run-install-smoke-elevated.ps1"
$signingHandoffPath = Join-Path $root "scripts\create-signing-handoff.ps1"
$signingImportPfxPath = Join-Path $root "scripts\import-signing-pfx.ps1"
$signingDoctorPath = Join-Path $root "scripts\check-signing-doctor.ps1"
$launchPlanPath = Join-Path $root "scripts\create-release-launch-plan.ps1"
$publicReleasePipelinePath = Join-Path $root "scripts\run-public-release-pipeline.ps1"
$publicReleasePackagePath = Join-Path $root "scripts\create-public-release-package.ps1"
$releaseProgressPath = Join-Path $root "scripts\show-release-progress.ps1"
$betaShipPath = Join-Path $root "scripts\run-beta-ship.ps1"
$betaDoctorPath = Join-Path $root "scripts\check-beta-doctor.ps1"
$betaSandboxPath = Join-Path $root "scripts\prepare-beta-sandbox.ps1"
$betaVmPackPath = Join-Path $root "scripts\package-beta-vm-pack.ps1"
$betaTestDropPath = Join-Path $root "scripts\create-beta-test-drop.ps1"
$betaTestDropVerifyPath = Join-Path $root "scripts\verify-beta-test-drop.ps1"
$betaTestDropOpenPath = Join-Path $root "scripts\open-beta-test-drop.ps1"
$betaTestDropZipPath = Join-Path $root "scripts\package-beta-test-drop.ps1"
$betaTestDropReceivePath = Join-Path $root "scripts\receive-beta-test-drop.ps1"
$qaWindowsDropWorkflowPath = Join-Path $root ".github\workflows\qa-windows-drop.yml"
$signedWindowsWorkflowPath = Join-Path $root ".github\workflows\release-windows-signed.yml"
$publicReleaseReadyPath = Join-Path $root "scripts\verify-public-release-ready.ps1"
$releasePolicyPath = Join-Path $root "docs\release-policy.json"

$package = Read-Text $packagePath | ConvertFrom-Json
$tauriConfig = Read-Text $tauriConfigPath | ConvertFrom-Json
$cargoToml = Read-Text (Join-Path $root "src-tauri\Cargo.toml")
$oldBrand = 'liga' + 'hub'
$oldBrandPattern = "play\.$oldBrand|org\.$oldBrand"
$manifest = Read-Text $manifestPath
$buildRs = Read-Text $buildRsPath
$capability = Read-Text $capabilityPath | ConvertFrom-Json
$safeModeTs = Read-Text $safeModeTsPath
$safeModeRs = Read-Text $safeModeRsPath
$manualQaBulk = Read-Text $manualQaBulkPath
$manualQaSelect = Read-Text $manualQaSelectPath
$manualQaAlignCurrentRc = Read-Text $manualQaAlignCurrentRcPath
$manualQaPlan = Read-Text $manualQaPlanPath
$manualQaDrop = Read-Text $manualQaDropPath
$manualQaDropVerify = Read-Text $manualQaDropVerifyPath
$manualQaDropReceive = Read-Text $manualQaDropReceivePath
$manualQaDropOpen = Read-Text $manualQaDropOpenPath
$manualQaDropZip = Read-Text $manualQaDropZipPath
$manualQaDropAuto = Read-Text $manualQaDropAutoPath
$manualQaDropInstallElevated = Read-Text $manualQaDropInstallElevatedPath
$signingHandoff = Read-Text $signingHandoffPath
$signingImportPfx = Read-Text $signingImportPfxPath
$signingDoctor = Read-Text $signingDoctorPath
$launchPlan = Read-Text $launchPlanPath
$publicReleasePipeline = Read-Text $publicReleasePipelinePath
$publicReleasePackage = Read-Text $publicReleasePackagePath
$releaseProgress = Read-Text $releaseProgressPath
$betaShip = Read-Text $betaShipPath
$betaDoctor = Read-Text $betaDoctorPath
$betaSandbox = Read-Text $betaSandboxPath
$betaVmPack = Read-Text $betaVmPackPath
$betaTestDrop = Read-Text $betaTestDropPath
$betaTestDropVerify = Read-Text $betaTestDropVerifyPath
$betaTestDropOpen = Read-Text $betaTestDropOpenPath
$betaTestDropZip = Read-Text $betaTestDropZipPath
$betaTestDropReceive = Read-Text $betaTestDropReceivePath
$qaWindowsDropWorkflow = Read-Text $qaWindowsDropWorkflowPath
$signedWindowsWorkflow = Read-Text $signedWindowsWorkflowPath
$publicReleaseReady = Read-Text $publicReleaseReadyPath
$releasePolicy = Read-Text $releasePolicyPath | ConvertFrom-Json

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $buildModeSyncScript
Assert-True ($LASTEXITCODE -eq 0) `
  "Build mode sync precisa garantir frontend/backend juntos em test/real."

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $noSigningSecretsScript
Assert-True ($LASTEXITCODE -eq 0) `
  "Repositorio nao pode rastrear PFX, chaves privadas ou senha real de assinatura."

Assert-True ($manifest -match 'requestedExecutionLevel\s+level="requireAdministrator"') `
  "Manifest Windows precisa exigir requireAdministrator."
Assert-True ($buildRs -match 'windows-app-manifest\.xml') `
  "build.rs precisa embutir windows-app-manifest.xml."
Assert-True ([string]$tauriConfig.identifier -eq "com.nexoptimizer.desktop") `
  "Identifier Tauri precisa usar o namespace NEX: com.nexoptimizer.desktop."
Assert-True ([string]$tauriConfig.identifier -notmatch $oldBrand) `
  "Identifier Tauri nao pode conter branding tecnico antigo."
Assert-True ((Read-Text $tauriConfigPath) -notmatch $oldBrandPattern) `
  "tauri.conf.json nao pode manter branding tecnico antigo."
Assert-True ($cargoToml -notmatch $oldBrandPattern) `
  "Cargo.toml nao pode manter repository/branding tecnico antigo."

& node (Join-Path $root "scripts\verify-optimization-catalog.mjs")
Assert-True ($LASTEXITCODE -eq 0) `
  "Catalogo de Otimizar Tudo precisa manter 150+ acoes e a meta HERMES_ACTION_TARGET sincronizada."

& node (Join-Path $root "scripts\verify-gamer-dependency-manifest.mjs")
Assert-True ($LASTEXITCODE -eq 0) `
  "Manifesto de dependencias gamer precisa manter instalacao bloqueada ate URL, SHA256 e assinatura."

& node (Join-Path $root "scripts\verify-feature-preservation.mjs")
Assert-True ($LASTEXITCODE -eq 0) `
  "Funcionalidades existentes precisam continuar preservadas mesmo fora da sidebar principal."

Assert-True ($safeModeTs -match 'VITE_HERMES_SAFE_TEST_MODE') `
  "Frontend precisa ler VITE_HERMES_SAFE_TEST_MODE."
Assert-True ($safeModeTs -match 'parseSafeModeFlag\(SAFE_TEST_MODE_ENV\)\s*\?\?\s*true') `
  "Frontend precisa manter modo teste como padrao."
Assert-True ($safeModeRs -match 'option_env!\("HERMES_SAFE_TEST_MODE"\)') `
  "Backend precisa ler HERMES_SAFE_TEST_MODE em tempo de build."
Assert-True ($safeModeRs -match 'DEFAULT_SAFE_TEST_MODE:\s*bool\s*=\s*true') `
  "Backend precisa manter modo teste como padrao."

$scripts = $package.scripts
Assert-True ([bool]$scripts.'build:windows:test') "package.json precisa ter build:windows:test."
Assert-True ([bool]$scripts.'build:windows:real') "package.json precisa ter build:windows:real."
Assert-True ([bool]$scripts.'build:windows:real:signed') "package.json precisa ter build:windows:real:signed."
Assert-True ([bool]$scripts.'verify:build-mode') "package.json precisa ter verify:build-mode."
Assert-True ([bool]$scripts.'verify:feature-preservation') "package.json precisa ter verify:feature-preservation."
Assert-True ([bool]$scripts.'verify:no-signing-secrets') "package.json precisa ter verify:no-signing-secrets."
Assert-True ([bool]$scripts.'qa:manual:bulk') "package.json precisa ter qa:manual:bulk para QA em lote com evidencia."
Assert-True ([bool]$scripts.'qa:manual:select') "package.json precisa ter qa:manual:select."
Assert-True ([bool]$scripts.'qa:manual:select:best') "package.json precisa ter qa:manual:select:best."
Assert-True ([bool]$scripts.'qa:manual:align-current-rc') "package.json precisa ter qa:manual:align-current-rc."
Assert-True ([bool]$scripts.'qa:manual:plan') "package.json precisa ter qa:manual:plan."
Assert-True ([bool]$scripts.'qa:manual:drop') "package.json precisa ter qa:manual:drop."
Assert-True ([bool]$scripts.'qa:manual:drop:verify') "package.json precisa ter qa:manual:drop:verify."
Assert-True ([bool]$scripts.'qa:manual:drop:open') "package.json precisa ter qa:manual:drop:open."
Assert-True ([bool]$scripts.'qa:manual:drop:sandbox') "package.json precisa ter qa:manual:drop:sandbox."
Assert-True ([bool]$scripts.'qa:manual:drop:zip') "package.json precisa ter qa:manual:drop:zip."
Assert-True ([bool]$scripts.'qa:manual:drop:auto') "package.json precisa ter qa:manual:drop:auto."
Assert-True ([bool]$scripts.'qa:manual:drop:auto:install') "package.json precisa ter qa:manual:drop:auto:install."
Assert-True ([bool]$scripts.'qa:manual:drop:auto:install:elevated') "package.json precisa ter qa:manual:drop:auto:install:elevated."
Assert-True ([bool]$scripts.'qa:manual:drop:check') "package.json precisa ter qa:manual:drop:check."
Assert-True ([bool]$scripts.'qa:manual:drop:receive') "package.json precisa ter qa:manual:drop:receive."
Assert-True ([bool]$scripts.'release:signing:handoff') "package.json precisa ter release:signing:handoff."
Assert-True ([bool]$scripts.'release:signing:import-pfx') "package.json precisa ter release:signing:import-pfx."
Assert-True ([bool]$scripts.'release:signing:doctor') "package.json precisa ter release:signing:doctor."
Assert-True ([bool]$scripts.'release:progress') "package.json precisa ter release:progress."
Assert-True ([bool]$scripts.'release:launch-plan') "package.json precisa ter release:launch-plan."
Assert-True ([bool]$scripts.'release:public:pipeline') "package.json precisa ter release:public:pipeline."
Assert-True ([bool]$scripts.'release:public:pipeline:preview') "package.json precisa ter release:public:pipeline:preview."
Assert-True ([bool]$scripts.'release:public:pipeline:signed') "package.json precisa ter release:public:pipeline:signed."
Assert-True ([bool]$scripts.'release:public:pipeline:signed:install') "package.json precisa ter release:public:pipeline:signed:install."
Assert-True ([bool]$scripts.'release:public:verify') "package.json precisa ter release:public:verify."
Assert-True ([bool]$scripts.'release:public:package') "package.json precisa ter release:public:package."
Assert-True ([bool]$scripts.'release:beta:doctor') "package.json precisa ter release:beta:doctor."
Assert-True ([bool]$scripts.'release:beta:sandbox') "package.json precisa ter release:beta:sandbox."
Assert-True ([bool]$scripts.'release:beta:vm:pack') "package.json precisa ter release:beta:vm:pack."
Assert-True ([bool]$scripts.'release:beta:ship') "package.json precisa ter release:beta:ship."
Assert-True ([bool]$scripts.'release:beta:drop:verify') "package.json precisa ter release:beta:drop:verify."
Assert-True ([bool]$scripts.'release:beta:drop:open') "package.json precisa ter release:beta:drop:open."
Assert-True ([bool]$scripts.'release:beta:drop:sandbox') "package.json precisa ter release:beta:drop:sandbox."
Assert-True ([bool]$scripts.'release:beta:drop:zip') "package.json precisa ter release:beta:drop:zip."
Assert-True ([bool]$scripts.'release:beta:drop:check') "package.json precisa ter release:beta:drop:check."
Assert-True ([bool]$scripts.'release:beta:drop:receive') "package.json precisa ter release:beta:drop:receive."
Assert-True ($manualQaBulk -match 'ConfirmBulkPass') `
  "QA manual em lote precisa exigir ConfirmBulkPass para aprovacao em massa."
Assert-True ($manualQaBulk -match 'install-nsis' -and $manualQaBulk -match 'install-msi' -and $manualQaBulk -match 'authenticode') `
  "QA manual em lote precisa proteger instaladores e Authenticode por padrao."
Assert-True ($manualQaBulk -match 'AllowProtected') `
  "QA manual em lote precisa exigir AllowProtected para itens criticos."
Assert-True ($manualQaSelect -match 'active-manual-qa-session' -and $manualQaSelect -match 'p0Passed' -and $manualQaSelect -match 'Best') `
  "QA manual precisa permitir selecionar sessao ativa e recuperar a sessao com melhor progresso."
Assert-True ($manualQaAlignCurrentRc -match 'SHA256' -and $manualQaAlignCurrentRc -match 'installer-sha256-identical' -and $manualQaAlignCurrentRc -match 'select-manual-qa-session') `
  "QA manual precisa alinhar progresso ao RC atual somente quando os instaladores tiverem SHA256 identico."
Assert-True ($manualQaPlan -match 'qa:manual:receive' -and $manualQaPlan -match 'all-non-protected') `
  "Plano de QA manual precisa orientar receive da VM e aprovacao em lote nao protegida."
Assert-True ($manualQaDrop -match 'RODAR-QA-HERMES-NA-VM.ps1' -and $manualQaDrop -match 'HERMES-MANUAL-QA.wsb') `
  "Drop de QA manual precisa gerar runner de VM e arquivo Windows Sandbox."
Assert-True ($manualQaDropVerify -match 'manual-qa-test-drop-verification' -and $manualQaDropVerify -match 'RUN-INSTALL-SMOKE.ps1') `
  "Verificador do drop de QA manual precisa validar pacote, runner e smoke."
Assert-True ($manualQaDropReceive -match 'receive-manual-qa-evidence.ps1' -and $manualQaDropReceive -match 'HermesQA') `
  "Recebimento do drop de QA manual precisa chamar receive-manual-qa-evidence com HermesQA do drop."
Assert-True ($manualQaDropReceive -match 'CheckOnly' -and $manualQaDropReceive -match 'manual-qa-test-drop-receive-check') `
  "Recebimento do drop de QA manual precisa ter modo CheckOnly antes de importar evidencias."
Assert-True ($manualQaDropOpen -match 'WindowsSandbox.exe' -and $manualQaDropOpen -match 'explorer.exe' -and $manualQaDropOpen -match 'qa:manual:drop:check') `
  "Abridor do drop de QA manual precisa abrir pasta, suportar Sandbox e mostrar comandos de retorno."
Assert-True ($manualQaDropZip -match 'Compress-Archive' -and $manualQaDropZip -match 'SHA256' -and $manualQaDropZip -match 'RODAR-QA-HERMES-NA-VM.ps1') `
  "Empacotador do drop de QA manual precisa gerar ZIP com SHA256 e instrucoes de VM."
Assert-True ($manualQaDrop -match 'HERMES_QA_AUTO_SAFE' -and $manualQaDrop -match 'BLOCKED_BY_AUTO_SAFE') `
  "Runner do drop de QA manual precisa bloquear install smoke/GUI no modo automatico seguro."
Assert-True ($manualQaDropReceive -match 'HERMES_QA_ALLOW_WITHOUT_INSTALL_SMOKE') `
  "Recebimento do drop precisa permitir importacao controlada sem install smoke no modo automatico seguro."
Assert-True ($manualQaDropAuto -match 'qa:manual:drop:zip' -and $manualQaDropAuto -match 'RODAR-QA-HERMES-NA-VM.ps1' -and $manualQaDropAuto -match 'HERMES_QA_AUTO_SAFE' -and $manualQaDropAuto -match 'manual-qa-drop-auto-result') `
  "Fluxo automatico do drop precisa zipar, validar SHA256, extrair, rodar QuickPassAll em modo seguro e gerar relatorio."
Assert-True ($manualQaDropAuto -match 'build:windows:test' -and $manualQaDropAuto -match 'release:internal') `
  "Fluxo automatico do drop precisa inicializar build/sessao quando rodar em checkout limpo."
Assert-True ($manualQaDropAuto -match 'AllowInstallSmoke' -and $manualQaDropAuto -match 'Install smoke real exige') `
  "Fluxo automatico precisa ter modo explicito para install smoke real em runner/VM elevado."
Assert-True ($manualQaDropInstallElevated -match 'Verb RunAs' -and $manualQaDropInstallElevated -match 'qa:manual:drop:auto:install' -and $manualQaDropInstallElevated -match 'latest-elevated-install-smoke') `
  "Install smoke real precisa ter lancador elevado com log e resultado em .release."
Assert-True ($signingHandoff -match 'Code Signing' -and $signingHandoff -match 'HERMES_CERT_THUMBPRINT') `
  "Handoff de assinatura precisa explicar certificado Code Signing e HERMES_CERT_THUMBPRINT."
Assert-True ($signingImportPfx -match 'HERMES_SIGNING_PFX_BASE64' -and $signingImportPfx -match 'CodeSigning' -and $signingImportPfx -match 'hermes-signing-env.ps1') `
  "Importacao de PFX precisa aceitar base64/arquivo, validar Code Signing e gerar env com thumbprint."
Assert-True ($signingDoctor -match 'verify-no-signing-secrets.ps1' -and $signingDoctor -match 'signing-doctor.json' -and $signingDoctor -match 'NEEDS_CERTIFICATE' -and $signingDoctor -match 'release:public:pipeline:signed') `
  "Doctor de assinatura precisa consolidar segredos, certificado, preflight, status e proximo comando."
Assert-True ($launchPlan -match 'qa:manual:drop:open' -and $launchPlan -match 'release:signing:handoff' -and $launchPlan -match 'build:windows:real:signed') `
  "Plano de lancamento precisa orientar QA manual, handoff de assinatura e build real assinado."
Assert-True ($publicReleasePipeline -match 'BuildSigned -and -not \$RegenerateReleaseCandidate' -and $publicReleasePipeline -match 'AllowInstallSmoke -and -not \$RegenerateReleaseCandidate' -and $publicReleasePipeline -match 'AllowInstallSmoke' -and $publicReleasePipeline -match 'ImportPfx' -and $publicReleasePipeline -match 'release:signing:import-pfx' -and $publicReleasePipeline -match 'release:signing:doctor' -and $publicReleasePipeline -match 'signingDoctorNextCommand' -and $publicReleasePipeline -match 'BuildSigned' -and $publicReleasePipeline -match 'RegenerateReleaseCandidate' -and $publicReleasePipeline -match 'build-real-signed' -and $publicReleasePipeline -match 'qa-drop-auto-install-smoke-current-rc' -and $publicReleasePipeline -match 'release:public:verify' -and $publicReleasePipeline -match 'release:public:package' -and $publicReleasePipeline -match 'public-release-pipeline-latest') `
  "Pipeline publico precisa exigir RC atual para build assinado/install smoke, assinar, testar o RC atual e entao executar gate publico."
Assert-True ([string]$scripts.'release:public:pipeline:signed' -match 'ImportPfx' -and [string]$scripts.'release:public:pipeline:signed' -match 'BuildSigned' -and [string]$scripts.'release:public:pipeline:signed' -match 'RegenerateReleaseCandidate') `
  "Atalho signed precisa importar PFX, gerar build assinado e regenerar RC."
Assert-True ([string]$scripts.'release:public:pipeline:signed:install' -match 'AllowInstallSmoke') `
  "Atalho signed:install precisa executar install smoke real em VM/runner."
Assert-True ($publicReleasePackage -match 'verify-public-release-ready.ps1' -and $publicReleasePackage -match 'Authenticode' -and $publicReleasePackage -match 'public-release-manifest.json' -and $publicReleasePackage -match 'latest-public-release-package') `
  "Pacote publico precisa rodar gate publico, exigir Authenticode Valid e gerar manifesto/ponteiro final."
Assert-True ($releaseProgress -match 'Hermes - progresso curto' -and $releaseProgress -match 'QA funcional P0' -and $releaseProgress -match 'Gate release bloqueado' -and $releaseProgress -match 'release-policy\.json' -and $releaseProgress -match 'codeSigningDeferred' -and $releaseProgress -match 'release:beta:drop' -and $releaseProgress -match 'release:beta:sandbox' -and $releaseProgress -match 'release:beta:vm:pack' -and $releaseProgress -match 'betaDropReady' -and $releaseProgress -match 'betaSandboxReady' -and $releaseProgress -match 'betaVmPackReady' -and $releaseProgress -match 'betaDropEvidenceReady' -and $releaseProgress -match 'Assinatura publica' -and $releaseProgress -match 'Proximo comando') `
  "Resumo curto de release precisa mostrar status, QA funcional, gate de release, beta/drop e respeitar release-policy.json quando Code Signing estiver adiado."
Assert-True ($betaShip -match 'run-beta-internal.ps1' -and $betaShip -match 'verify-beta-ready-to-send.ps1' -and $betaShip -match 'create-beta-test-drop.ps1' -and $betaShip -match 'package-beta-test-drop.ps1' -and $betaShip -match 'latest-beta-ship') `
  "Fluxo beta ship precisa orquestrar beta, drop, zip, progresso e resumo final em um comando."
Assert-True ($betaDoctor -match 'verify-beta-test-drop.ps1' -and $betaDoctor -match 'WindowsSandbox.exe' -and $betaDoctor -match 'READY_WITHOUT_SANDBOX' -and $betaDoctor -match 'overallStatus -eq "GO"' -and $betaDoctor -match 'beta-doctor') `
  "Beta doctor precisa validar drop, manter publico NO-GO, diagnosticar Sandbox e aceitar fallback VM externa sem alterar o host."
Assert-True ($betaSandbox -match 'check-beta-doctor.ps1' -and $betaSandbox -match 'Run-Hermes-Beta-In-Sandbox.wsb' -and $betaSandbox -match '<Networking>Disable</Networking>|<Networking>\$networking</Networking>' -and $betaSandbox -match '<ReadOnly>true</ReadOnly>' -and $betaSandbox -match '<ReadOnly>false</ReadOnly>' -and $betaSandbox -match 'sandbox-start.ps1' -and $betaSandbox -match 'C:\\Temp\\HermesQA' -and $betaSandbox -notmatch 'Start-Process -FilePath \$wsbPath') `
  "Beta sandbox precisa apenas preparar WSB/script, mapear beta read-only, evidencias writable, rede desabilitavel e nao abrir/instalar no host."
Assert-True ($betaVmPack -match 'check-beta-doctor.ps1' -and $betaVmPack -match 'README-VM-TEST.md' -and $betaVmPack -match 'CHECKLIST-VM-TEST.md' -and $betaVmPack -match 'collect-hermes-evidence.ps1' -and $betaVmPack -match 'signatureStatus' -and $betaVmPack -match 'NotSigned|unsignedInstallerWarning' -and $betaVmPack -match 'release:beta:drop:receive|qa:manual:receive' -and $betaVmPack -notmatch 'Start-Process') `
  "VM pack precisa validar doctor, gerar README/checklist/coletor/manifesto e nao executar instalador no host."
Assert-True ($betaTestDrop -match 'verify-beta-test-drop.ps1' -and $betaTestDrop -match 'RODAR-DENTRO-DA-VM.ps1' -and $betaTestDrop -match 'HERMES-BETA-QA.wsb' -and $betaTestDrop -match 'latest-beta-test-drop') `
  "Drop beta precisa gerar runner/Windows Sandbox, ponteiros latest e verificar o pacote antes de liberar uso."
Assert-True ($betaTestDropVerify -match 'latest-beta-test-drop-verification' -and $betaTestDropVerify -match 'VERIFY-QA-PACKAGE.ps1' -and $betaTestDropVerify -match 'Drop pertence ao beta atual' -and $betaTestDropVerify -match 'SHA256 do ZIP beta' -and $betaTestDropVerify -match 'LEIA-ME-QA-PORTATIL.md') `
  "Verificador do drop beta precisa validar beta atual, SHA256, QA portatil extraido e relatorio de verificacao."
Assert-True ($betaTestDropOpen -match 'WindowsSandbox.exe' -and $betaTestDropOpen -match 'explorer.exe' -and $betaTestDropOpen -match 'verify-beta-test-drop.ps1' -and $betaTestDropOpen -match 'beta-test-drop-open.json') `
  "Abridor do drop beta precisa validar, abrir pasta/guia, suportar Sandbox e registrar relatorio."
Assert-True ($betaTestDropZip -match 'Compress-Archive' -and $betaTestDropZip -match 'SHA256' -and $betaTestDropZip -match 'verify-beta-test-drop.ps1' -and $betaTestDropZip -match 'latest-beta-test-drop-package') `
  "Empacotador do drop beta precisa validar antes, gerar ZIP, SHA256 e ponteiro latest."
Assert-True ($betaTestDropReceive -match 'receive-manual-qa-evidence.ps1' -and $betaTestDropReceive -match 'C:\\Temp\\HermesQA' -and $betaTestDropReceive -match 'beta-test-drop-receive-check.json' -and $betaTestDropReceive -match 'verify-beta-test-drop.ps1') `
  "Recebimento do drop beta precisa validar o drop, detectar HermesQA local/C:\\Temp e chamar o recebimento do QA manual."
Assert-True ([string]$releasePolicy.publicSignedRelease -eq "blocked" -and [string]$releasePolicy.codeSigning.status -eq "deferred" -and -not [bool]$releasePolicy.codeSigning.allowUnsignedPublicRelease -and [string]$releasePolicy.nextWhenPublicSigningDeferred -eq "npm run release:beta") `
  "Politica de release precisa congelar Code Signing por agora, bloquear release publico sem assinatura e apontar beta interno como proximo passo."
Assert-True ($qaWindowsDropWorkflow -match 'windows-latest' -and $qaWindowsDropWorkflow -match 'repository.private == false' -and $qaWindowsDropWorkflow -match 'npm ci --ignore-scripts' -and $qaWindowsDropWorkflow -match 'build:windows:test' -and $qaWindowsDropWorkflow -match 'test-rust-unit-safe.ps1' -and $qaWindowsDropWorkflow -match 'GITHUB_STEP_SUMMARY' -and $qaWindowsDropWorkflow -match 'inputs.upload_artifacts' -and $qaWindowsDropWorkflow -notmatch 'qa:manual:drop:auto:install') `
  "Workflow QA Windows Drop precisa usar runner publico padrao, build teste, testes auditados e artifacts opt-in sem instalar/executar o app."
Assert-True ($signedWindowsWorkflow -match 'windows-latest' -and $signedWindowsWorkflow -match 'HERMES_SIGNING_PFX_BASE64' -and $signedWindowsWorkflow -match 'HERMES_SIGNING_PFX_PASSWORD' -and $signedWindowsWorkflow -match 'release:signing:import-pfx' -and $signedWindowsWorkflow -match 'release:signing:doctor' -and $signedWindowsWorkflow -match 'signing-doctor.json' -and $signedWindowsWorkflow -match 'build:windows:real:signed' -and $signedWindowsWorkflow -match 'release:internal' -and $signedWindowsWorkflow -match 'qa:manual:drop:auto:install' -and $signedWindowsWorkflow -match 'release:public:verify' -and $signedWindowsWorkflow -match 'release:public:package' -and $signedWindowsWorkflow -match 'hermes-windows-public-release-package' -and $signedWindowsWorkflow -match '\.release/public/\*\*' -and $signedWindowsWorkflow -match 'actions/upload-artifact') `
  "Workflow Release Windows Signed precisa importar PFX, assinar, gerar RC atual, testar instalador assinado, rodar gate publico, gerar pacote publico final e publicar evidencias."
Assert-True ($publicReleaseReady -match 'unsignedInstallerCount' -and $publicReleaseReady -match 'signingAllInstallersSigned' -and $publicReleaseReady -match 'publicDecision' -and $publicReleaseReady -match 'P0 funcionais incompletos' -and $publicReleaseReady -match 'Authenticode Valid') `
  "Gate de publicacao publica precisa bloquear P0 funcional incompleto, instalador sem assinatura e RC NO-GO."

$permissions = @($capability.permissions)
$forbiddenPermissions = @(
  "shell:default",
  "fs:default",
  "dialog:default",
  "http:default",
  "process:default",
  "updater:default"
)

foreach ($forbidden in $forbiddenPermissions) {
  Assert-True (-not ($permissions -contains $forbidden)) "Permissao ampla proibida encontrada: $forbidden."
}

Assert-True ($permissions -contains "core:default") "Capability precisa manter core:default."
Assert-True ($permissions -contains "core:window:allow-start-dragging") `
  "Capability precisa permitir arrastar a janela customizada."
Assert-True ($permissions -contains "core:window:allow-toggle-maximize") `
  "Capability precisa permitir maximizar a janela customizada."

$csp = [string]$tauriConfig.app.security.csp
Assert-True ($csp -match "default-src 'self'") "CSP precisa limitar default-src a self."
Assert-True ($csp -match "script-src 'self'") "CSP precisa limitar scripts a self."
Assert-True ($csp -notmatch "'unsafe-eval'") "CSP nao pode liberar unsafe-eval."
Assert-True ($csp -match "object-src 'none'") "CSP precisa bloquear object-src."
Assert-True ($csp -match "base-uri 'self'") "CSP precisa limitar base-uri."
Assert-True ($csp -match "frame-ancestors 'none'") "CSP precisa bloquear embedding."
Assert-True ($csp -match "connect-src 'self' ipc:") "CSP precisa permitir somente self/ipc como base."

if ($failures.Count -gt 0) {
  Write-Host "Hermes release gates: FALHOU" -ForegroundColor Red
  foreach ($failure in $failures) {
    Write-Host "- $failure" -ForegroundColor Red
  }
  exit 1
}

Write-Host "Hermes release gates: OK" -ForegroundColor Green
Write-Host "- Manifest Windows exige administrador."
Write-Host "- Safe mode e controlado por variaveis de build e padrao teste."
Write-Host "- Build real/teste sincroniza frontend e backend."
Write-Host "- Permissoes Tauri continuam minimas."
Write-Host "- CSP contem as travas obrigatorias."
Write-Host "- Scripts de build test/real/signed existem."
Write-Host "- QA manual em lote existe com travas de evidencia e itens protegidos."
Write-Host "- Plano de acao do QA manual existe para VM, lote e assinatura."
Write-Host "- Drop de QA manual existe para VM/maquina limpa."
Write-Host "- Verificador do drop de QA manual existe."
Write-Host "- Abridor do drop de QA manual existe."
Write-Host "- ZIP exportavel do drop de QA manual existe."
Write-Host "- Fluxo automatico local do drop existe com logs, SHA256 e bloqueio seguro de install/GUI."
Write-Host "- Fluxo automatico possui modo opt-in de install smoke real para VM/runner elevado."
Write-Host "- Install smoke real possui lancador elevado com log em .release."
Write-Host "- Workflow GitHub Actions compila em modo teste e roda testes auditados; instalacao/GUI continuam pendentes e artifacts sao opt-in."
Write-Host "- Workflow manual de release assinado importa PFX via secrets, gera MSI/NSIS assinados e bloqueia publicacao se o gate publico falhar."
Write-Host "- Gate de publicacao publica bloqueia RC NO-GO e instaladores sem Authenticode Valid."
Write-Host "- Check de retorno do drop de QA manual existe."
Write-Host "- Recebimento automatico do drop de QA manual existe."
Write-Host "- Preservacao de rotas, motores e documentos importantes esta protegida."
Write-Host "- Handoff de assinatura existe para destravar Authenticode."
Write-Host "- Plano de lancamento final existe para orientar QA manual, assinatura e build publicavel."
Write-Host "- Pipeline publico unico existe para orquestrar checks, QA drop, assinatura opt-in, status e gate final."
Write-Host "- Resumo curto de progresso existe para mostrar onde estamos sem relatorio longo."
Write-Host "- Beta unsigned possui doctor e preparo seguro para Windows Sandbox."
Write-Host "- Beta unsigned possui pack oficial para VM externa/outro PC limpo."
Write-Host "- Beta interno pode ser preparado para envio em um comando."
Write-Host "- Drop beta interno e verificado automaticamente antes de uso."
Write-Host "- Drop beta interno pode ser aberto em Explorer ou Windows Sandbox por comando."
Write-Host "- Drop beta interno pode ser empacotado em ZIP com SHA256."
Write-Host "- Drop beta interno pode checar/receber HermesQA por comando."
