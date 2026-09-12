use crate::safe_mode;
use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSecurityContext {
    pub is_windows: bool,
    pub is_elevated: bool,
    pub username: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemBootContext {
    pub is_windows: bool,
    pub available: bool,
    pub current_boot_id: Option<String>,
    pub booted_at: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemRestartRequest {
    pub confirmed: bool,
    pub dry_run: Option<bool>,
    pub delay_seconds: Option<u64>,
}

impl Default for SystemRestartRequest {
    fn default() -> Self {
        Self {
            confirmed: false,
            dry_run: Some(true),
            delay_seconds: Some(60),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemRestartResult {
    pub dry_run: bool,
    pub scheduled: bool,
    pub cancelled: bool,
    pub delay_seconds: u64,
    pub message: String,
}

#[tauri::command]
pub fn system_security_context_read() -> SystemSecurityContext {
    if !cfg!(target_os = "windows") {
        return SystemSecurityContext {
            is_windows: false,
            is_elevated: false,
            username: None,
            warnings: vec!["Contexto de administrador disponivel apenas no Windows.".to_string()],
        };
    }

    match read_windows_security_context() {
        Ok(context) => context,
        Err(error) => SystemSecurityContext {
            is_windows: true,
            is_elevated: false,
            username: None,
            warnings: vec![error],
        },
    }
}

#[tauri::command]
pub fn system_boot_context_read() -> SystemBootContext {
    if !cfg!(target_os = "windows") {
        return SystemBootContext {
            is_windows: false,
            available: false,
            current_boot_id: None,
            booted_at: None,
            warnings: vec!["Boot do sistema disponivel apenas no Windows.".to_string()],
        };
    }

    match read_windows_boot_context() {
        Ok(context) => context,
        Err(error) => SystemBootContext {
            is_windows: true,
            available: false,
            current_boot_id: None,
            booted_at: None,
            warnings: vec![error],
        },
    }
}

#[tauri::command]
pub fn system_open_windows_security() -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("Seguranca do Windows disponivel apenas no Windows.".to_string());
    }

    let mut command = Command::new("cmd");
    command
        .args(["/C", "start", "", "windowsdefender:"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    command
        .spawn()
        .map_err(|error| format!("Nao foi possivel abrir a Seguranca do Windows: {error}"))?;

    Ok(())
}

#[tauri::command]
pub fn system_restart_computer(
    request: Option<SystemRestartRequest>,
) -> Result<SystemRestartResult, String> {
    if !cfg!(target_os = "windows") {
        return Err("Reinicio automatico disponivel apenas no Windows.".to_string());
    }

    let request = request.unwrap_or_default();
    let requested_dry_run = request.dry_run.unwrap_or(!request.confirmed);
    let dry_run = safe_mode::force_dry_run(requested_dry_run);
    let delay_seconds = request.delay_seconds.unwrap_or(60).clamp(5, 300);

    if !dry_run && !request.confirmed {
        return Err("Confirmacao obrigatoria para reiniciar o computador.".to_string());
    }

    if dry_run {
        return Ok(SystemRestartResult {
            dry_run,
            scheduled: false,
            cancelled: false,
            delay_seconds,
            message: format!(
                "{} - reinicio validado. O Windows nao sera reiniciado enquanto o modo teste estiver ativo.",
                safe_mode::mode_prefix(dry_run)
            ),
        });
    }

    crate::licensing::require_real_license(dry_run)?;
    run_shutdown_command(&[
        "/r",
        "/t",
        &delay_seconds.to_string(),
        "/c",
        "NEXT Optimizer solicitou reinicio para concluir a otimizacao.",
    ])?;

    Ok(SystemRestartResult {
        dry_run,
        scheduled: true,
        cancelled: false,
        delay_seconds,
        message: format!("Reinicio agendado em {delay_seconds} segundos pelo NEX Optimizer."),
    })
}

#[tauri::command]
pub fn system_cancel_restart(dry_run: Option<bool>) -> Result<SystemRestartResult, String> {
    if !cfg!(target_os = "windows") {
        return Err("Cancelamento de reinicio disponivel apenas no Windows.".to_string());
    }

    let dry_run = safe_mode::force_dry_run(dry_run.unwrap_or(true));

    if dry_run {
        return Ok(SystemRestartResult {
            dry_run,
            scheduled: false,
            cancelled: false,
            delay_seconds: 0,
            message: format!(
                "{} - cancelamento validado. Nenhum reinicio estava agendado pelo modo teste.",
                safe_mode::mode_prefix(dry_run)
            ),
        });
    }

    run_shutdown_command(&["/a"])?;

    Ok(SystemRestartResult {
        dry_run,
        scheduled: false,
        cancelled: true,
        delay_seconds: 0,
        message: "Reinicio agendado cancelado.".to_string(),
    })
}

fn run_shutdown_command(args: &[&str]) -> Result<(), String> {
    let mut command = Command::new("shutdown.exe");
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let output = command
        .spawn()
        .map_err(|error| format!("Nao foi possivel executar shutdown.exe: {error}"))?
        .wait_with_output()
        .map_err(|error| format!("Falha aguardando shutdown.exe: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "shutdown.exe retornou erro sem detalhes.".to_string()
    })
}

fn read_windows_security_context() -> Result<SystemSecurityContext, String> {
    let script = r#"
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{
  isElevated = $isAdmin
  username = $identity.Name
} | ConvertTo-Json -Compress
"#;

    let mut command = Command::new("powershell");
    command
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("Nao foi possivel ler contexto do Windows: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Falha lendo contexto do Windows: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "PowerShell retornou erro ao detectar administrador.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let value = serde_json::from_str::<serde_json::Value>(&stdout)
        .map_err(|error| format!("Contexto do Windows veio em formato invalido: {error}"))?;

    Ok(SystemSecurityContext {
        is_windows: true,
        is_elevated: value
            .get("isElevated")
            .and_then(|item| item.as_bool())
            .unwrap_or(false),
        username: value
            .get("username")
            .and_then(|item| item.as_str())
            .map(|item| item.to_string()),
        warnings: Vec::new(),
    })
}

fn read_windows_boot_context() -> Result<SystemBootContext, String> {
    let script = r#"
$ErrorActionPreference = 'Stop'
$rawBoot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
if ($rawBoot -is [datetime]) {
  $boot = $rawBoot
} else {
  $boot = [Management.ManagementDateTimeConverter]::ToDateTime([string]$rawBoot)
}
$bootUtc = $boot.ToUniversalTime()
$bootIso = $bootUtc.ToString('o')
[pscustomobject]@{
  available = $true
  currentBootId = "windows:$bootIso"
  bootedAt = $bootIso
} | ConvertTo-Json -Compress
"#;

    let mut command = Command::new("powershell");
    command
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("Nao foi possivel ler boot do Windows: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Falha lendo boot do Windows: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "PowerShell retornou erro ao detectar boot do Windows.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let value = serde_json::from_str::<serde_json::Value>(&stdout)
        .map_err(|error| format!("Boot do Windows veio em formato invalido: {error}"))?;

    Ok(SystemBootContext {
        is_windows: true,
        available: value
            .get("available")
            .and_then(|item| item.as_bool())
            .unwrap_or(false),
        current_boot_id: value
            .get("currentBootId")
            .and_then(|item| item.as_str())
            .map(|item| item.to_string()),
        booted_at: value
            .get("bootedAt")
            .and_then(|item| item.as_str())
            .map(|item| item.to_string()),
        warnings: Vec::new(),
    })
}
