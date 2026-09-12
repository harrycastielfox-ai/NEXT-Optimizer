use crate::safe_mode;
use serde::{Deserialize, Serialize};
use std::{
    process::{Command, Stdio},
    thread,
    time::{Duration, SystemTime},
};

const POWERSHELL_TIMEOUT_SECONDS: u64 = 16;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntiCheatReport {
    pub generated_at: String,
    pub engine_version: String,
    pub read_only: bool,
    pub score: u8,
    pub status: String,
    pub summary: String,
    pub checks: AntiCheatChecks,
    pub services: AntiCheatServices,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntiCheatChecks {
    pub tpm: AntiCheatCheck,
    pub secure_boot: AntiCheatCheck,
    pub core_isolation: AntiCheatCheck,
    pub driver_signature: AntiCheatCheck,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntiCheatServices {
    pub riot_vanguard: AntiCheatCheck,
    pub easy_anti_cheat: AntiCheatCheck,
    pub battleye: AntiCheatCheck,
    pub faceit: AntiCheatCheck,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntiCheatCheck {
    pub label: String,
    pub status: String,
    pub detail: String,
    pub ok: bool,
    pub points: u8,
    pub max_points: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAntiCheatReport {
    tpm_present: Option<bool>,
    tpm_enabled: Option<bool>,
    tpm_ready: Option<bool>,
    tpm_version: Option<String>,
    secure_boot_enabled: Option<bool>,
    secure_boot_supported: Option<bool>,
    bios_mode: Option<String>,
    core_isolation_enabled: Option<bool>,
    unsigned_driver_count: Option<f64>,
    unsigned_driver_sample: Option<Vec<String>>,
    vanguard_installed: Option<bool>,
    vanguard_running: Option<bool>,
    easy_anti_cheat_installed: Option<bool>,
    easy_anti_cheat_running: Option<bool>,
    battleye_installed: Option<bool>,
    battleye_running: Option<bool>,
    faceit_installed: Option<bool>,
    faceit_running: Option<bool>,
    warnings: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntiCheatActivationRequest {
    pub confirmed: bool,
    pub dry_run: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AntiCheatActivationResult {
    pub dry_run: bool,
    pub changed: bool,
    pub already_enabled: bool,
    pub restart_required: bool,
    pub requires_admin: bool,
    pub message: String,
    pub actions: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawMemoryIntegrityActivation {
    changed: Option<bool>,
    already_enabled: Option<bool>,
    restart_required: Option<bool>,
    requires_admin: Option<bool>,
    message: Option<String>,
}

#[tauri::command]
pub async fn anti_cheat_engine_read() -> Result<AntiCheatReport, String> {
    tauri::async_runtime::spawn_blocking(collect_anti_cheat_report)
        .await
        .map_err(|err| format!("Falha ao executar Anti-Cheat em segundo plano: {err}"))?
}

#[tauri::command]
pub async fn anti_cheat_enable_memory_integrity(
    request: Option<AntiCheatActivationRequest>,
) -> Result<AntiCheatActivationResult, String> {
    tauri::async_runtime::spawn_blocking(move || enable_memory_integrity(request))
        .await
        .map_err(|err| format!("Falha ao ativar Integridade de Memoria: {err}"))?
}

pub fn collect_anti_cheat_report() -> Result<AntiCheatReport, String> {
    match collect_windows_anti_cheat() {
        Ok(raw) => Ok(build_report(raw)),
        Err(error) => {
            let mut report = fallback_report();
            report.warnings.push(error);
            Ok(report)
        }
    }
}

pub fn collect_anti_cheat_component_score() -> (u8, String) {
    match collect_anti_cheat_report() {
        Ok(report) => (report.score, report.status),
        Err(_) => (60, "Indisponivel".to_string()),
    }
}

fn enable_memory_integrity(
    request: Option<AntiCheatActivationRequest>,
) -> Result<AntiCheatActivationResult, String> {
    if !cfg!(target_os = "windows") {
        return Err("Integridade de Memoria esta disponivel apenas no Windows.".to_string());
    }

    let request = request.unwrap_or(AntiCheatActivationRequest {
        confirmed: false,
        dry_run: Some(true),
    });
    let requested_dry_run = request.dry_run.unwrap_or(!request.confirmed);
    let dry_run = safe_mode::force_dry_run(requested_dry_run);
    let actions = vec![
        "Validar Integridade de Memoria no Registro do Windows.".to_string(),
        "Habilitar HypervisorEnforcedCodeIntegrity quando estiver desativado.".to_string(),
        "Solicitar reinicio para aplicar Core Isolation.".to_string(),
    ];

    if dry_run {
        return Ok(AntiCheatActivationResult {
            dry_run,
            changed: false,
            already_enabled: false,
            restart_required: true,
            requires_admin: false,
            message: format!(
                "{} - Integridade de Memoria validada. Nenhuma alteracao real foi aplicada.",
                safe_mode::mode_prefix(dry_run)
            ),
            actions,
        });
    }

    if !request.confirmed {
        return Err("Confirmacao obrigatoria para ativar Integridade de Memoria.".to_string());
    }
    crate::licensing::require_real_license(dry_run)?;

    let stdout = run_powershell(POWERSHELL_ENABLE_MEMORY_INTEGRITY_SCRIPT)?;
    let raw = serde_json::from_str::<RawMemoryIntegrityActivation>(&stdout)
        .map_err(|err| format!("Nao foi possivel interpretar ativacao Anti-Cheat: {err}"))?;
    let changed = raw.changed.unwrap_or(false);
    let already_enabled = raw.already_enabled.unwrap_or(false);
    let restart_required = raw.restart_required.unwrap_or(changed);
    let requires_admin = raw.requires_admin.unwrap_or(false);

    Ok(AntiCheatActivationResult {
        dry_run,
        changed,
        already_enabled,
        restart_required,
        requires_admin,
        message: raw.message.unwrap_or_else(|| {
            if requires_admin {
                "Abra o NEX como administrador para aplicar esta permissao.".to_string()
            } else if already_enabled {
                "Integridade de Memoria ja estava ativa.".to_string()
            } else {
                "Integridade de Memoria ativada. Reinicie o PC para concluir.".to_string()
            }
        }),
        actions,
    })
}

fn collect_windows_anti_cheat() -> Result<RawAntiCheatReport, String> {
    if !cfg!(target_os = "windows") {
        return Err(
            "Anti-Cheat usa leitura local do Windows e esta plataforma nao e Windows.".to_string(),
        );
    }

    let stdout = run_powershell(POWERSHELL_ANTI_CHEAT_SCRIPT)?;
    serde_json::from_str::<RawAntiCheatReport>(&stdout)
        .map_err(|err| format!("Nao foi possivel interpretar diagnostico Anti-Cheat: {err}"))
}

fn build_report(raw: RawAntiCheatReport) -> AntiCheatReport {
    let tpm = tpm_check(&raw);
    let secure_boot = secure_boot_check(&raw);
    let core_isolation = core_isolation_check(&raw);
    let driver_signature = driver_signature_check(&raw);
    let riot_vanguard = service_check(
        "Vanguard Ready",
        raw.vanguard_installed,
        raw.vanguard_running,
    );
    let easy_anti_cheat = service_check(
        "EAC Ready",
        raw.easy_anti_cheat_installed,
        raw.easy_anti_cheat_running,
    );
    let battleye = service_check(
        "BattlEye Ready",
        raw.battleye_installed,
        raw.battleye_running,
    );
    let faceit = service_check("FACEIT Ready", raw.faceit_installed, raw.faceit_running);
    let services_points = service_points(&[&riot_vanguard, &easy_anti_cheat, &battleye, &faceit]);

    let score = (tpm.points as u16
        + secure_boot.points as u16
        + core_isolation.points as u16
        + driver_signature.points as u16
        + services_points as u16)
        .min(100) as u8;
    let status = anti_cheat_status(score).to_string();
    let summary = summary_text(score, &secure_boot, &tpm, &driver_signature);

    AntiCheatReport {
        generated_at: now_timestamp(),
        engine_version: "anti-cheat-readonly-v1".to_string(),
        read_only: true,
        score,
        status,
        summary,
        checks: AntiCheatChecks {
            tpm,
            secure_boot,
            core_isolation,
            driver_signature,
        },
        services: AntiCheatServices {
            riot_vanguard,
            easy_anti_cheat,
            battleye,
            faceit,
        },
        warnings: raw.warnings.unwrap_or_default(),
    }
}

fn fallback_report() -> AntiCheatReport {
    AntiCheatReport {
        generated_at: now_timestamp(),
        engine_version: "anti-cheat-fallback-v1".to_string(),
        read_only: true,
        score: 0,
        status: "Indisponivel".to_string(),
        summary: "Analise Anti-Cheat real indisponivel neste ambiente.".to_string(),
        checks: AntiCheatChecks {
            tpm: pending_check("TPM 2.0", 25),
            secure_boot: pending_check("Secure Boot", 25),
            core_isolation: pending_check("Core Isolation", 15),
            driver_signature: pending_check("Driver Signature", 20),
        },
        services: AntiCheatServices {
            riot_vanguard: pending_check("Vanguard Ready", 15),
            easy_anti_cheat: pending_check("EAC Ready", 15),
            battleye: pending_check("BattlEye Ready", 15),
            faceit: pending_check("FACEIT Ready", 15),
        },
        warnings: vec![
            "Fallback indisponivel usado. Nenhum resultado demonstrativo foi retornado."
                .to_string(),
        ],
    }
}

fn tpm_check(raw: &RawAntiCheatReport) -> AntiCheatCheck {
    let present = raw.tpm_present.unwrap_or(false);
    let enabled = raw.tpm_enabled.unwrap_or(false) || raw.tpm_ready.unwrap_or(false);
    let version = raw
        .tpm_version
        .clone()
        .unwrap_or_else(|| "Nao identificado".to_string());
    let version_ok = version.contains("2.0") || version.contains("2");

    if present && enabled && version_ok {
        check(
            "TPM 2.0",
            "OK",
            format!("TPM ativo, versao {version}."),
            true,
            25,
            25,
        )
    } else if present {
        check(
            "TPM 2.0",
            "Atencao",
            format!("TPM encontrado, mas versao/estado requer conferencia. Versao: {version}."),
            false,
            10,
            25,
        )
    } else {
        check(
            "TPM 2.0",
            "Nao compativel",
            "TPM nao foi detectado pela leitura local.",
            false,
            0,
            25,
        )
    }
}

fn secure_boot_check(raw: &RawAntiCheatReport) -> AntiCheatCheck {
    let bios_mode = raw
        .bios_mode
        .clone()
        .unwrap_or_else(|| "Desconhecido".to_string());
    match (
        raw.secure_boot_supported.unwrap_or(false),
        raw.secure_boot_enabled,
    ) {
        (_, Some(true)) => check(
            "Secure Boot",
            "OK",
            format!("Secure Boot ativo. Modo: {bios_mode}."),
            true,
            25,
            25,
        ),
        (true, Some(false)) => check(
            "Secure Boot",
            "Atencao",
            format!("Secure Boot esta desativado. Modo: {bios_mode}."),
            false,
            8,
            25,
        ),
        _ => check(
            "Secure Boot",
            "Requer BIOS",
            format!("Nao foi possivel confirmar Secure Boot via Windows. Modo: {bios_mode}."),
            false,
            0,
            25,
        ),
    }
}

fn core_isolation_check(raw: &RawAntiCheatReport) -> AntiCheatCheck {
    if raw.core_isolation_enabled.unwrap_or(false) {
        check(
            "Core Isolation",
            "OK",
            "Integridade de Memoria esta ativa.",
            true,
            15,
            15,
        )
    } else {
        check(
            "Core Isolation",
            "Atencao",
            "Integridade de Memoria esta desativada ou indisponivel. O NEX apenas informa.",
            false,
            5,
            15,
        )
    }
}

fn driver_signature_check(raw: &RawAntiCheatReport) -> AntiCheatCheck {
    let count = raw.unsigned_driver_count.unwrap_or_default().max(0.0) as u32;
    if count == 0 {
        check(
            "Driver Signature",
            "OK",
            "Nenhum driver nao assinado foi encontrado na leitura rapida.",
            true,
            20,
            20,
        )
    } else {
        let sample = raw
            .unsigned_driver_sample
            .clone()
            .unwrap_or_default()
            .join(", ");
        check(
            "Driver Signature",
            "Atencao",
            format!("{count} driver(s) sem assinatura detectado(s). Amostra: {sample}."),
            false,
            5,
            20,
        )
    }
}

fn service_check(label: &str, installed: Option<bool>, running: Option<bool>) -> AntiCheatCheck {
    match (installed.unwrap_or(false), running.unwrap_or(false)) {
        (true, true) => check(
            label,
            "OK",
            "Servico detectado e em execucao.",
            true,
            15,
            15,
        ),
        (true, false) => check(
            label,
            "Atencao",
            "Servico detectado, mas nao esta em execucao agora.",
            false,
            7,
            15,
        ),
        (false, _) => check(
            label,
            "Nao encontrado",
            "Nao instalado neste PC. Isso pode ser normal se voce nao usa esse anti-cheat.",
            true,
            15,
            15,
        ),
    }
}

fn service_points(services: &[&AntiCheatCheck]) -> u8 {
    if services.iter().any(|service| service.status == "Atencao") {
        7
    } else {
        15
    }
}

fn pending_check(label: &str, max_points: u8) -> AntiCheatCheck {
    check(
        label,
        "Aguardando",
        "Clique em Analisar Anti-Cheat para leitura local.",
        false,
        0,
        max_points,
    )
}

fn check(
    label: impl Into<String>,
    status: impl Into<String>,
    detail: impl Into<String>,
    ok: bool,
    points: u8,
    max_points: u8,
) -> AntiCheatCheck {
    AntiCheatCheck {
        label: label.into(),
        status: status.into(),
        detail: detail.into(),
        ok,
        points,
        max_points,
    }
}

fn anti_cheat_status(score: u8) -> &'static str {
    if score >= 85 {
        "Pronto"
    } else if score >= 60 {
        "Pode melhorar"
    } else {
        "Atencao"
    }
}

fn summary_text(
    score: u8,
    secure_boot: &AntiCheatCheck,
    tpm: &AntiCheatCheck,
    driver_signature: &AntiCheatCheck,
) -> String {
    if secure_boot.status != "OK" {
        return "Seu PC esta quase pronto para anti-cheats modernos. O principal ponto pendente e Secure Boot, que pode afetar Valorant, FACEIT e alguns jogos competitivos.".to_string();
    }

    if tpm.status != "OK" {
        return "A leitura encontrou oportunidade no TPM. Alguns jogos competitivos podem exigir TPM 2.0 ativo.".to_string();
    }

    if driver_signature.status != "OK" {
        return "A leitura encontrou drivers que merecem revisao. O NEX não remove nem bloqueia drivers, apenas orienta.".to_string();
    }

    if score >= 85 {
        "Seu PC esta bem preparado para anti-cheats modernos. Mantenha Windows, drivers e jogos atualizados.".to_string()
    } else {
        "Seu PC esta parcialmente preparado. Revise os pontos marcados como Atencao antes de jogos competitivos.".to_string()
    }
}

fn run_powershell(script: &str) -> Result<String, String> {
    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command
        .spawn()
        .map_err(|err| format!("Nao foi possivel iniciar PowerShell para Anti-Cheat: {err}"))?;
    let started_at = SystemTime::now();

    loop {
        if child
            .try_wait()
            .map_err(|err| format!("Falha ao aguardar PowerShell Anti-Cheat: {err}"))?
            .is_some()
        {
            break;
        }

        if SystemTime::now()
            .duration_since(started_at)
            .unwrap_or_default()
            .as_secs()
            >= POWERSHELL_TIMEOUT_SECONDS
        {
            let _ = child.kill();
            return Err("Tempo limite atingido ao coletar Anti-Cheat.".to_string());
        }

        thread::sleep(Duration::from_millis(80));
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("Nao foi possivel ler saida do Anti-Cheat: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("PowerShell retornou erro no Anti-Cheat: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        Err("PowerShell nao retornou dados Anti-Cheat.".to_string())
    } else {
        Ok(stdout)
    }
}

fn now_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    seconds.to_string()
}

const POWERSHELL_ENABLE_MEMORY_INTEGRITY_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  [pscustomobject]@{
    changed = $false
    alreadyEnabled = $false
    restartRequired = $false
    requiresAdmin = $true
    message = 'Abra o NEX como administrador para ativar Integridade de Memoria.'
  } | ConvertTo-Json -Compress
  exit 0
}

$hvciPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity'
$before = 0
try {
  $current = Get-ItemProperty -LiteralPath $hvciPath -Name Enabled -ErrorAction Stop
  $before = [int]$current.Enabled
} catch {
  $before = 0
}

New-Item -Path $hvciPath -Force | Out-Null
New-ItemProperty -LiteralPath $hvciPath -Name Enabled -PropertyType DWord -Value 1 -Force | Out-Null

$after = [int](Get-ItemProperty -LiteralPath $hvciPath -Name Enabled -ErrorAction Stop).Enabled
$changed = ($before -ne 1 -and $after -eq 1)
$alreadyEnabled = ($before -eq 1 -and $after -eq 1)
$message = if ($alreadyEnabled) {
  'Integridade de Memoria ja estava ativa.'
} elseif ($after -eq 1) {
  'Integridade de Memoria ativada. Reinicie o PC para concluir.'
} else {
  'O Windows nao confirmou a ativacao da Integridade de Memoria.'
}

[pscustomobject]@{
  changed = $changed
  alreadyEnabled = $alreadyEnabled
  restartRequired = $changed
  requiresAdmin = $false
  message = $message
} | ConvertTo-Json -Compress
"#;

const POWERSHELL_ANTI_CHEAT_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$warnings = New-Object System.Collections.Generic.List[string]

$tpm = Get-Tpm
$tpmWmi = Get-CimInstance -Namespace 'root\CIMV2\Security\MicrosoftTpm' -ClassName Win32_Tpm
$tpmVersion = $null
if ($tpmWmi -and $tpmWmi.SpecVersion) { $tpmVersion = [string]$tpmWmi.SpecVersion }

$secureBootEnabled = $null
$secureBootSupported = $false
try {
  $secureBootEnabled = [bool](Confirm-SecureBootUEFI)
  $secureBootSupported = $true
} catch {
  $warnings.Add('Secure Boot nao pode ser confirmado por Confirm-SecureBootUEFI.')
}

$biosMode = $null
try {
  $firmware = bcdedit /enum '{current}' | Select-String -Pattern 'path'
  if ($firmware -match 'winload\.efi') { $biosMode = 'UEFI' }
  elseif ($firmware -match 'winload\.exe') { $biosMode = 'Legacy/BIOS' }
} catch {
  $warnings.Add('Modo BIOS/UEFI nao identificado.')
}

$coreIsolationEnabled = $false
try {
  $hvcipath = 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity'
  $hvci = Get-ItemProperty -LiteralPath $hvcipath -Name Enabled
  $coreIsolationEnabled = ([int]$hvci.Enabled -eq 1)
} catch {
  $warnings.Add('Integridade de Memoria nao identificada via Registro.')
}

$unsignedDrivers = @()
try {
  $unsignedDrivers = @(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -and $_.IsSigned -eq $false } | Select-Object -First 8)
} catch {
  $warnings.Add('Assinatura de drivers nao pode ser lida nesta execucao.')
}

function Get-HermesServiceState($patterns) {
  $allServices = @(Get-Service)
  $services = @()
  foreach ($service in $allServices) {
    $serviceName = $service.Name
    $displayName = $service.DisplayName
    foreach ($pattern in $patterns) {
      if ($serviceName -match $pattern -or $displayName -match $pattern) {
        $services += $service
        break
      }
    }
  }
  [pscustomobject]@{
    installed = ($services.Count -gt 0)
    running = (@($services | Where-Object { $_.Status -eq 'Running' }).Count -gt 0)
  }
}

$vanguard = Get-HermesServiceState @('^vgc$','^vgk$','vanguard')
$eac = Get-HermesServiceState @('easyanticheat','easy anti-cheat','easyanticheat_eos')
$battleye = Get-HermesServiceState @('^beservice','battleye')
$faceit = Get-HermesServiceState @('faceit')

[pscustomobject]@{
  tpmPresent = [bool]$tpm.TpmPresent
  tpmEnabled = [bool]$tpm.TpmEnabled
  tpmReady = [bool]$tpm.TpmReady
  tpmVersion = $tpmVersion
  secureBootEnabled = $secureBootEnabled
  secureBootSupported = $secureBootSupported
  biosMode = $biosMode
  coreIsolationEnabled = $coreIsolationEnabled
  unsignedDriverCount = $unsignedDrivers.Count
  unsignedDriverSample = @($unsignedDrivers | ForEach-Object { $_.DeviceName })
  vanguardInstalled = [bool]$vanguard.installed
  vanguardRunning = [bool]$vanguard.running
  easyAntiCheatInstalled = [bool]$eac.installed
  easyAntiCheatRunning = [bool]$eac.running
  battleyeInstalled = [bool]$battleye.installed
  battleyeRunning = [bool]$battleye.running
  faceitInstalled = [bool]$faceit.installed
  faceitRunning = [bool]$faceit.running
  warnings = @($warnings)
} | ConvertTo-Json -Depth 5 -Compress
"#;
