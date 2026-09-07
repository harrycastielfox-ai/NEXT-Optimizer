use crate::safe_mode;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const DEPENDENCY_ENGINE_VERSION: &str = "gamer-dependencies-verifier-v1";
const DEPENDENCY_INSTALL_ENGINE_VERSION: &str = "gamer-dependencies-install-v1";
const DEPENDENCY_MANIFEST_AUDIT_ENGINE_VERSION: &str = "gamer-dependencies-manifest-audit-v1";
const INSTALLER_TIMEOUT_SECONDS: u64 = 900;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerDependencyVerifyRequest {
    pub packages: Vec<GamerDependencyVerifyPackage>,
    pub package_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerDependencyInstallRequest {
    pub confirmed: bool,
    pub dry_run: Option<bool>,
    pub package_ids: Option<Vec<String>>,
    pub packages: Vec<GamerDependencyVerifyPackage>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerDependencyVerifyPackage {
    pub id: String,
    pub title: String,
    pub installer_file_name: String,
    pub official_source_page: String,
    pub official_url: Option<String>,
    pub expected_sha256: Option<String>,
    pub required_publisher: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerDependencyVerificationReport {
    pub generated_at: String,
    pub engine_version: String,
    pub cache_dir: String,
    pub total_packages: usize,
    pub ready_count: usize,
    pub installed_locally_count: usize,
    pub blocked_count: usize,
    pub packages: Vec<GamerDependencyVerificationItem>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerDependencyDownloadResult {
    pub downloaded_count: usize,
    pub skipped_count: usize,
    pub failed_count: usize,
    pub messages: Vec<String>,
    pub report: GamerDependencyVerificationReport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerDependencyManifestAuditResult {
    pub generated_at: String,
    pub engine_version: String,
    pub audit_dir: String,
    pub total_packages: usize,
    pub audited_count: usize,
    pub cached_count: usize,
    pub failed_count: usize,
    pub blocked_count: usize,
    pub items: Vec<GamerDependencyManifestAuditItem>,
    pub messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerDependencyManifestAuditItem {
    pub package_id: String,
    pub title: String,
    pub installer_file_name: String,
    pub official_url: Option<String>,
    pub audit_path: String,
    pub status: GamerDependencyManifestAuditStatus,
    pub message: String,
    pub sha256: Option<String>,
    pub signature_status: Option<String>,
    pub signature_subject: Option<String>,
    pub publisher_matches: Option<bool>,
    pub manifest_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GamerDependencyManifestAuditStatus {
    Audited,
    Cached,
    Failed,
    Blocked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerDependencyInstallResult {
    pub generated_at: String,
    pub engine_version: String,
    pub dry_run: bool,
    pub installed_count: usize,
    pub skipped_count: usize,
    pub failed_count: usize,
    pub blocked_count: usize,
    pub actions: Vec<GamerDependencyInstallActionResult>,
    pub message: String,
    pub report: GamerDependencyVerificationReport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerDependencyInstallActionResult {
    pub package_id: String,
    pub title: String,
    pub installer_file_name: String,
    pub status: GamerDependencyInstallActionStatus,
    pub message: String,
    pub command_preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GamerDependencyInstallActionStatus {
    DryRun,
    Installed,
    Skipped,
    Failed,
    Blocked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerDependencyVerificationItem {
    pub package_id: String,
    pub title: String,
    pub installer_file_name: String,
    pub official_source_page: String,
    pub official_url: Option<String>,
    pub cached_path: String,
    pub file_exists: bool,
    pub installed_locally: bool,
    pub status: GamerDependencyVerificationStatus,
    pub sha256: Option<String>,
    pub expected_sha256: Option<String>,
    pub sha256_matches: Option<bool>,
    pub signature_status: Option<String>,
    pub signature_subject: Option<String>,
    pub publisher_matches: Option<bool>,
    pub blocked_reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GamerDependencyVerificationStatus {
    Missing,
    Blocked,
    Verified,
    Failed,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileSecurityProbe {
    sha256: Option<String>,
    signature_status: Option<String>,
    signature_subject: Option<String>,
}

#[tauri::command]
pub async fn gamer_dependency_verify_installers(
    app: AppHandle,
    request: GamerDependencyVerifyRequest,
) -> Result<GamerDependencyVerificationReport, String> {
    tauri::async_runtime::spawn_blocking(move || verify_installers_blocking(app, request))
        .await
        .map_err(|err| format!("Falha ao verificar dependencias gamer em segundo plano: {err}"))?
}

#[tauri::command]
pub fn gamer_dependency_open_cache_dir(app: AppHandle) -> Result<String, String> {
    let cache_dir = dependency_cache_dir(&app)?;
    open_directory(&cache_dir)?;
    Ok(cache_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn gamer_dependency_download_official_installers(
    app: AppHandle,
    request: GamerDependencyVerifyRequest,
) -> Result<GamerDependencyDownloadResult, String> {
    tauri::async_runtime::spawn_blocking(move || download_installers_blocking(app, request))
        .await
        .map_err(|err| format!("Falha ao baixar dependencias gamer em segundo plano: {err}"))?
}

#[tauri::command]
pub async fn gamer_dependency_audit_official_manifest(
    app: AppHandle,
    request: GamerDependencyVerifyRequest,
) -> Result<GamerDependencyManifestAuditResult, String> {
    tauri::async_runtime::spawn_blocking(move || audit_manifest_blocking(app, request))
        .await
        .map_err(|err| format!("Falha ao auditar manifesto gamer em segundo plano: {err}"))?
}

#[tauri::command]
pub async fn gamer_dependency_install_verified(
    app: AppHandle,
    request: GamerDependencyInstallRequest,
) -> Result<GamerDependencyInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || install_verified_blocking(app, request))
        .await
        .map_err(|err| format!("Falha ao instalar dependencias gamer em segundo plano: {err}"))?
}

fn verify_installers_blocking(
    app: AppHandle,
    request: GamerDependencyVerifyRequest,
) -> Result<GamerDependencyVerificationReport, String> {
    let cache_dir = dependency_cache_dir(&app)?;
    let mut warnings = Vec::new();

    if !cfg!(target_os = "windows") {
        warnings.push(
            "Verificacao de assinatura Authenticode disponivel apenas no Windows.".to_string(),
        );
    }

    let packages = request
        .packages
        .iter()
        .map(|package| verify_package(&cache_dir, package))
        .collect::<Vec<_>>();
    let ready_count = packages
        .iter()
        .filter(|item| matches!(item.status, GamerDependencyVerificationStatus::Verified))
        .count();
    let installed_locally_count = packages
        .iter()
        .filter(|item| item.installed_locally)
        .count();
    let blocked_count = packages.len().saturating_sub(ready_count);

    Ok(GamerDependencyVerificationReport {
        generated_at: now_timestamp(),
        engine_version: DEPENDENCY_ENGINE_VERSION.to_string(),
        cache_dir: cache_dir.to_string_lossy().to_string(),
        total_packages: packages.len(),
        ready_count,
        installed_locally_count,
        blocked_count,
        packages,
        warnings,
    })
}

fn download_installers_blocking(
    app: AppHandle,
    request: GamerDependencyVerifyRequest,
) -> Result<GamerDependencyDownloadResult, String> {
    let cache_dir = dependency_cache_dir(&app)?;
    let mut downloaded_count = 0;
    let mut skipped_count = 0;
    let mut failed_count = 0;
    let mut messages = Vec::new();
    let package_ids = normalized_package_ids(request.package_ids.as_ref());
    let downloadable_packages = request
        .packages
        .iter()
        .filter(|package| {
            package_ids
                .as_ref()
                .map(|ids| ids.iter().any(|id| id == &package.id))
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();

    if !cfg!(target_os = "windows") {
        let package_count = downloadable_packages.len();
        let report = verify_installers_blocking(app, request)?;
        return Ok(GamerDependencyDownloadResult {
            downloaded_count,
            skipped_count,
            failed_count: package_count,
            messages: vec!["Downloader oficial disponivel apenas no Windows.".to_string()],
            report,
        });
    }

    for package in downloadable_packages {
        match download_package(&cache_dir, package) {
            Ok(DownloadOutcome::Downloaded(message)) => {
                downloaded_count += 1;
                messages.push(message);
            }
            Ok(DownloadOutcome::Skipped(message)) => {
                skipped_count += 1;
                messages.push(message);
            }
            Err(error) => {
                failed_count += 1;
                messages.push(format!("{}: {error}", package.title));
            }
        }
    }

    let report = verify_installers_blocking(app, request)?;
    Ok(GamerDependencyDownloadResult {
        downloaded_count,
        skipped_count,
        failed_count,
        messages,
        report,
    })
}

fn normalized_package_ids(package_ids: Option<&Vec<String>>) -> Option<Vec<String>> {
    package_ids
        .map(|items| {
            items
                .iter()
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty())
}

fn audit_manifest_blocking(
    app: AppHandle,
    request: GamerDependencyVerifyRequest,
) -> Result<GamerDependencyManifestAuditResult, String> {
    let audit_dir = dependency_audit_dir(&app)?;
    let mut items = Vec::new();
    let mut messages = Vec::new();

    if !cfg!(target_os = "windows") {
        let total_packages = request.packages.len();
        return Ok(GamerDependencyManifestAuditResult {
            generated_at: now_timestamp(),
            engine_version: DEPENDENCY_MANIFEST_AUDIT_ENGINE_VERSION.to_string(),
            audit_dir: audit_dir.to_string_lossy().to_string(),
            total_packages,
            audited_count: 0,
            cached_count: 0,
            failed_count: 0,
            blocked_count: total_packages,
            items: request
                .packages
                .iter()
                .map(|package| {
                    manifest_audit_item(
                        package,
                        package.installer_file_name.clone(),
                        None,
                        audit_dir.join(&package.installer_file_name),
                        GamerDependencyManifestAuditStatus::Blocked,
                        "Auditoria de assinatura Authenticode disponivel apenas no Windows."
                            .to_string(),
                        None,
                        None,
                    )
                })
                .collect(),
            messages: vec!["Auditoria oficial disponivel apenas no Windows.".to_string()],
        });
    }

    for package in &request.packages {
        let item = audit_manifest_package(&audit_dir, package);
        messages.push(format!("{}: {}", package.title, item.message));
        items.push(item);
    }

    let audited_count = items
        .iter()
        .filter(|item| matches!(item.status, GamerDependencyManifestAuditStatus::Audited))
        .count();
    let cached_count = items
        .iter()
        .filter(|item| matches!(item.status, GamerDependencyManifestAuditStatus::Cached))
        .count();
    let failed_count = items
        .iter()
        .filter(|item| matches!(item.status, GamerDependencyManifestAuditStatus::Failed))
        .count();
    let blocked_count = items
        .iter()
        .filter(|item| matches!(item.status, GamerDependencyManifestAuditStatus::Blocked))
        .count();

    Ok(GamerDependencyManifestAuditResult {
        generated_at: now_timestamp(),
        engine_version: DEPENDENCY_MANIFEST_AUDIT_ENGINE_VERSION.to_string(),
        audit_dir: audit_dir.to_string_lossy().to_string(),
        total_packages: request.packages.len(),
        audited_count,
        cached_count,
        failed_count,
        blocked_count,
        items,
        messages,
    })
}

fn install_verified_blocking(
    app: AppHandle,
    request: GamerDependencyInstallRequest,
) -> Result<GamerDependencyInstallResult, String> {
    let dry_run = safe_mode::force_dry_run(request.dry_run.unwrap_or(!request.confirmed));
    if !dry_run && !request.confirmed {
        return Err("Instalacao real exige confirmacao explicita.".to_string());
    }
    if !dry_run && !is_process_elevated() {
        return Err(
            "Instalacao real exige que o NEX esteja aberto como administrador.".to_string(),
        );
    }

    let verify_request = GamerDependencyVerifyRequest {
        packages: request.packages.clone(),
        package_ids: None,
    };
    let verification = verify_installers_blocking(app.clone(), verify_request)?;
    let selected_ids = normalized_package_ids(request.package_ids.as_ref());

    let mut actions = Vec::new();
    for package in &request.packages {
        if let Some(ids) = &selected_ids {
            if !ids.iter().any(|id| id == &package.id) {
                continue;
            }
        }

        actions.push(install_package_from_cache(package, &verification, dry_run));
    }

    let installed_count = actions
        .iter()
        .filter(|item| matches!(item.status, GamerDependencyInstallActionStatus::Installed))
        .count();
    let skipped_count = actions
        .iter()
        .filter(|item| matches!(item.status, GamerDependencyInstallActionStatus::Skipped))
        .count();
    let failed_count = actions
        .iter()
        .filter(|item| matches!(item.status, GamerDependencyInstallActionStatus::Failed))
        .count();
    let blocked_count = actions
        .iter()
        .filter(|item| matches!(item.status, GamerDependencyInstallActionStatus::Blocked))
        .count();
    let dry_run_count = actions
        .iter()
        .filter(|item| matches!(item.status, GamerDependencyInstallActionStatus::DryRun))
        .count();
    let final_report = if dry_run {
        verification
    } else {
        verify_installers_blocking(
            app,
            GamerDependencyVerifyRequest {
                packages: request.packages,
                package_ids: None,
            },
        )?
    };

    let message = if dry_run {
        format!(
            "{} | {} instalador(es) validado(s) para execucao futura.",
            safe_mode::mode_prefix(dry_run),
            dry_run_count
        )
    } else {
        format!(
            "{} instalado(s), {} pulado(s), {} bloqueado(s), {} falha(s).",
            installed_count, skipped_count, blocked_count, failed_count
        )
    };

    Ok(GamerDependencyInstallResult {
        generated_at: now_timestamp(),
        engine_version: DEPENDENCY_INSTALL_ENGINE_VERSION.to_string(),
        dry_run,
        installed_count,
        skipped_count,
        failed_count,
        blocked_count,
        actions,
        message,
        report: final_report,
    })
}

fn install_package_from_cache(
    package: &GamerDependencyVerifyPackage,
    verification: &GamerDependencyVerificationReport,
    dry_run: bool,
) -> GamerDependencyInstallActionResult {
    let installer_file_name = sanitize_installer_file_name(&package.installer_file_name)
        .unwrap_or_else(|_| package.installer_file_name.clone());
    let install_args = install_args_for_package(package);
    let command_preview = format!("{installer_file_name} {}", install_args.join(" "));

    if !is_allowed_gamer_dependency_id(&package.id) {
        return install_action(
            package,
            installer_file_name,
            GamerDependencyInstallActionStatus::Blocked,
            "Pacote fora da allowlist de dependencias gamer (somente VC++ Redistributable e DirectX End-User Runtime).".to_string(),
            command_preview,
        );
    }

    let verification_item = verification
        .packages
        .iter()
        .find(|item| item.package_id == package.id);

    let Some(item) = verification_item else {
        return install_action(
            package,
            installer_file_name,
            GamerDependencyInstallActionStatus::Blocked,
            "Dependencia nao encontrada no relatorio de verificacao.".to_string(),
            command_preview,
        );
    };

    if !matches!(item.status, GamerDependencyVerificationStatus::Verified) {
        return install_action(
            package,
            installer_file_name,
            GamerDependencyInstallActionStatus::Blocked,
            item.blocked_reasons
                .first()
                .cloned()
                .unwrap_or_else(|| "Instalador ainda nao esta verificado.".to_string()),
            command_preview,
        );
    }

    if dependency_already_installed(package).unwrap_or(false) {
        return install_action(
            package,
            installer_file_name,
            GamerDependencyInstallActionStatus::Skipped,
            "Dependencia ja parece instalada neste Windows; instalador nao foi executado."
                .to_string(),
            command_preview,
        );
    }

    let installer_path = PathBuf::from(&item.cached_path);
    if !installer_path.is_file() {
        return install_action(
            package,
            installer_file_name,
            GamerDependencyInstallActionStatus::Blocked,
            "Instalador verificado nao foi encontrado no cache.".to_string(),
            command_preview,
        );
    }

    if dry_run {
        return install_action(
            package,
            installer_file_name,
            GamerDependencyInstallActionStatus::DryRun,
            "Modo teste: instalador verificado, comando nao executado.".to_string(),
            command_preview,
        );
    }

    match run_installer(&installer_path, &install_args) {
        Ok(InstallExit::Success(code)) => install_action(
            package,
            installer_file_name,
            GamerDependencyInstallActionStatus::Installed,
            if code == 3010 {
                "Instalado; reinicio recomendado pelo instalador.".to_string()
            } else {
                "Instalador executado com sucesso.".to_string()
            },
            command_preview,
        ),
        Ok(InstallExit::AlreadyInstalled(code)) => install_action(
            package,
            installer_file_name,
            GamerDependencyInstallActionStatus::Skipped,
            format!("Instalador informou que a dependencia ja existe. Codigo {code}."),
            command_preview,
        ),
        Err(error) => install_action(
            package,
            installer_file_name,
            GamerDependencyInstallActionStatus::Failed,
            error,
            command_preview,
        ),
    }
}

fn install_action(
    package: &GamerDependencyVerifyPackage,
    installer_file_name: String,
    status: GamerDependencyInstallActionStatus,
    message: String,
    command_preview: String,
) -> GamerDependencyInstallActionResult {
    GamerDependencyInstallActionResult {
        package_id: package.id.clone(),
        title: package.title.clone(),
        installer_file_name,
        status,
        message,
        command_preview,
    }
}

enum InstallExit {
    Success(i32),
    AlreadyInstalled(i32),
}

fn run_installer(installer_path: &Path, args: &[String]) -> Result<InstallExit, String> {
    let mut command = Command::new(installer_path);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Nao foi possivel iniciar instalador: {error}"))?;
    wait_for_process(&mut child, INSTALLER_TIMEOUT_SECONDS)?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Nao foi possivel ler saida do instalador: {error}"))?;
    let code = output.status.code().unwrap_or(-1);

    match code {
        0 | 3010 => Ok(InstallExit::Success(code)),
        1638 => Ok(InstallExit::AlreadyInstalled(code)),
        _ => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if stderr.is_empty() {
                Err(format!("Instalador retornou codigo {code}."))
            } else {
                Err(format!("Instalador retornou codigo {code}: {stderr}"))
            }
        }
    }
}

fn wait_for_process(child: &mut Child, timeout_seconds: u64) -> Result<(), String> {
    let timeout = Duration::from_secs(timeout_seconds);
    let started_at = Instant::now();

    loop {
        if child
            .try_wait()
            .map_err(|error| format!("Falha ao consultar instalador: {error}"))?
            .is_some()
        {
            return Ok(());
        }

        if started_at.elapsed() >= timeout {
            let _ = child.kill();
            return Err(format!(
                "Instalador excedeu o limite de {} segundos.",
                timeout_seconds
            ));
        }

        thread::sleep(Duration::from_millis(250));
    }
}

fn install_args_for_package(package: &GamerDependencyVerifyPackage) -> Vec<String> {
    if package.id == "directx-end-user-runtime" {
        return vec!["/Q".to_string()];
    }

    vec!["/quiet".to_string(), "/norestart".to_string()]
}

enum DownloadOutcome {
    Downloaded(String),
    Skipped(String),
}

fn download_package(
    cache_dir: &Path,
    package: &GamerDependencyVerifyPackage,
) -> Result<DownloadOutcome, String> {
    let installer_file_name = sanitize_installer_file_name(&package.installer_file_name)?;
    if dependency_already_installed(package).unwrap_or(false) {
        return Ok(DownloadOutcome::Skipped(format!(
            "{} ja esta instalada neste Windows; download dispensado.",
            package.title
        )));
    }
    let Some(official_url) = clean_optional(package.official_url.clone()) else {
        return Ok(DownloadOutcome::Skipped(format!(
            "{} pulado: URL direta oficial ainda nao foi aprovada no manifesto.",
            package.title
        )));
    };
    let Some(expected_sha256) = clean_optional(package.expected_sha256.clone()) else {
        return Ok(DownloadOutcome::Skipped(format!(
            "{} pulado: SHA256 esperado ainda nao foi aprovado no manifesto.",
            package.title
        )));
    };
    validate_official_download_url(&official_url)?;

    let cached_path = cache_dir.join(&installer_file_name);
    if cached_path.is_file() {
        return Ok(DownloadOutcome::Skipped(format!(
            "{} ja esta no cache local.",
            package.title
        )));
    }

    let temp_path = cache_dir.join(format!("{installer_file_name}.download"));
    if temp_path.exists() {
        fs::remove_file(&temp_path)
            .map_err(|error| format!("Nao foi possivel limpar download temporario: {error}"))?;
    }

    if let Err(error) = download_file_with_powershell(&official_url, &temp_path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    let metadata = fs::metadata(&temp_path)
        .map_err(|error| format!("Download nao gerou arquivo temporario valido: {error}"))?;
    if metadata.len() < 1024 {
        let _ = fs::remove_file(&temp_path);
        return Err(
            "Download retornou arquivo muito pequeno para ser um instalador valido.".into(),
        );
    }

    let probe = match probe_file_security(&temp_path) {
        Ok(probe) => probe,
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
    };

    let signature_ok = probe
        .signature_status
        .as_deref()
        .map(|status| status.eq_ignore_ascii_case("Valid"))
        .unwrap_or(false);
    if !signature_ok {
        let _ = fs::remove_file(&temp_path);
        return Err("Assinatura Authenticode do download nao esta valida.".to_string());
    }

    let publisher_matches = probe
        .signature_subject
        .as_ref()
        .map(|subject| subject_confirms_microsoft(subject))
        .unwrap_or(false);
    if !publisher_matches {
        let _ = fs::remove_file(&temp_path);
        return Err("Download assinado, mas publicador nao confirma Microsoft Corporation.".into());
    }

    let sha256_matches = probe
        .sha256
        .as_ref()
        .map(|actual| actual.eq_ignore_ascii_case(&expected_sha256))
        .unwrap_or(false);
    if !sha256_matches {
        let _ = fs::remove_file(&temp_path);
        return Err("Hash SHA256 do download nao confere com o manifesto.".to_string());
    }

    fs::rename(&temp_path, &cached_path)
        .map_err(|error| format!("Nao foi possivel mover instalador para o cache: {error}"))?;

    Ok(DownloadOutcome::Downloaded(format!(
        "{} baixado e assinado pela Microsoft.",
        package.title
    )))
}

fn audit_manifest_package(
    audit_dir: &Path,
    package: &GamerDependencyVerifyPackage,
) -> GamerDependencyManifestAuditItem {
    let installer_file_name = match sanitize_installer_file_name(&package.installer_file_name) {
        Ok(file_name) => file_name,
        Err(error) => {
            return manifest_audit_item(
                package,
                package.installer_file_name.clone(),
                None,
                audit_dir.join(&package.installer_file_name),
                GamerDependencyManifestAuditStatus::Blocked,
                error,
                None,
                None,
            );
        }
    };
    let official_url = match clean_optional(package.official_url.clone()) {
        Some(url) => url,
        None => {
            return manifest_audit_item(
                package,
                installer_file_name.clone(),
                None,
                audit_dir.join(&installer_file_name),
                GamerDependencyManifestAuditStatus::Blocked,
                "URL direta oficial ainda nao foi aprovada no manifesto.".to_string(),
                None,
                None,
            );
        }
    };
    if let Err(error) = validate_official_download_url(&official_url) {
        return manifest_audit_item(
            package,
            installer_file_name.clone(),
            Some(official_url),
            audit_dir.join(&installer_file_name),
            GamerDependencyManifestAuditStatus::Blocked,
            error,
            None,
            None,
        );
    }

    let audit_path = audit_dir.join(&installer_file_name);
    let mut status = GamerDependencyManifestAuditStatus::Cached;
    if !audit_path.is_file() {
        let temp_path = audit_dir.join(format!("{installer_file_name}.audit-download"));
        if temp_path.exists() {
            let _ = fs::remove_file(&temp_path);
        }
        if let Err(error) = download_file_with_powershell(&official_url, &temp_path) {
            let _ = fs::remove_file(&temp_path);
            return manifest_audit_item(
                package,
                installer_file_name,
                Some(official_url),
                audit_path,
                GamerDependencyManifestAuditStatus::Failed,
                error,
                None,
                None,
            );
        }
        match fs::metadata(&temp_path) {
            Ok(metadata) if metadata.len() >= 1024 => {}
            _ => {
                let _ = fs::remove_file(&temp_path);
                return manifest_audit_item(
                    package,
                    installer_file_name,
                    Some(official_url),
                    audit_path,
                    GamerDependencyManifestAuditStatus::Failed,
                    "Download retornou arquivo muito pequeno para ser um instalador valido."
                        .to_string(),
                    None,
                    None,
                );
            }
        }
        if let Err(error) = fs::rename(&temp_path, &audit_path) {
            let _ = fs::remove_file(&temp_path);
            return manifest_audit_item(
                package,
                installer_file_name,
                Some(official_url),
                audit_path,
                GamerDependencyManifestAuditStatus::Failed,
                format!("Nao foi possivel salvar auditoria do instalador: {error}"),
                None,
                None,
            );
        }
        status = GamerDependencyManifestAuditStatus::Audited;
    }

    let probe = match probe_file_security(&audit_path) {
        Ok(probe) => probe,
        Err(error) => {
            return manifest_audit_item(
                package,
                installer_file_name,
                Some(official_url),
                audit_path,
                GamerDependencyManifestAuditStatus::Failed,
                error,
                None,
                None,
            );
        }
    };
    let signature_ok = probe
        .signature_status
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("Valid"))
        .unwrap_or(false);
    let publisher_matches = probe
        .signature_subject
        .as_ref()
        .map(|subject| subject_confirms_microsoft(subject));
    let sha256 = probe.sha256.clone();
    let manifest_hint = sha256
        .as_ref()
        .filter(|_| signature_ok && publisher_matches == Some(true))
        .map(|value| format!("{} expectedSha256={value}", package.id));
    let final_status = if signature_ok && publisher_matches == Some(true) {
        status
    } else {
        GamerDependencyManifestAuditStatus::Failed
    };
    let message = if signature_ok && publisher_matches == Some(true) {
        "Instalador oficial auditado; copie o SHA256 para o manifesto antes de liberar instalacao."
            .to_string()
    } else if !signature_ok {
        "Assinatura Authenticode do instalador auditado nao esta valida.".to_string()
    } else {
        "Assinatura valida, mas publicador nao confirma Microsoft Corporation.".to_string()
    };

    manifest_audit_item(
        package,
        installer_file_name,
        Some(official_url),
        audit_path,
        final_status,
        message,
        Some(probe),
        manifest_hint,
    )
}

fn manifest_audit_item(
    package: &GamerDependencyVerifyPackage,
    installer_file_name: String,
    official_url: Option<String>,
    audit_path: PathBuf,
    status: GamerDependencyManifestAuditStatus,
    message: String,
    probe: Option<FileSecurityProbe>,
    manifest_hint: Option<String>,
) -> GamerDependencyManifestAuditItem {
    let publisher_matches = probe
        .as_ref()
        .and_then(|probe| probe.signature_subject.as_ref())
        .map(|subject| subject_confirms_microsoft(subject));

    GamerDependencyManifestAuditItem {
        package_id: package.id.clone(),
        title: package.title.clone(),
        installer_file_name,
        official_url,
        audit_path: audit_path.to_string_lossy().to_string(),
        status,
        message,
        sha256: probe.as_ref().and_then(|probe| probe.sha256.clone()),
        signature_status: probe
            .as_ref()
            .and_then(|probe| probe.signature_status.clone()),
        signature_subject: probe
            .as_ref()
            .and_then(|probe| probe.signature_subject.clone()),
        publisher_matches,
        manifest_hint,
    }
}

fn verify_package(
    cache_dir: &Path,
    package: &GamerDependencyVerifyPackage,
) -> GamerDependencyVerificationItem {
    let mut blocked_reasons = Vec::new();
    if !is_allowed_gamer_dependency_id(&package.id) {
        blocked_reasons.push(
            "Pacote fora da allowlist de dependencias gamer (somente VC++ Redistributable e DirectX End-User Runtime)."
                .to_string(),
        );
    }

    let installer_file_name = match sanitize_installer_file_name(&package.installer_file_name) {
        Ok(file_name) => file_name,
        Err(error) => {
            return failed_item(cache_dir, package, error);
        }
    };

    let cached_path = cache_dir.join(&installer_file_name);
    let expected_sha256 = clean_optional(package.expected_sha256.clone());
    let official_url = clean_optional(package.official_url.clone());
    let file_exists = cached_path.is_file();
    let installed_locally = dependency_already_installed(package).unwrap_or(false);

    if official_url.is_none() && !installed_locally {
        blocked_reasons.push("URL direta oficial ainda nao foi aprovada no manifesto.".to_string());
    }

    if !file_exists {
        if !installed_locally {
            blocked_reasons.push("Instalador ainda nao esta no cache local do NEX.".to_string());
        }
        return GamerDependencyVerificationItem {
            package_id: package.id.clone(),
            title: package.title.clone(),
            installer_file_name,
            official_source_page: package.official_source_page.clone(),
            official_url,
            cached_path: cached_path.to_string_lossy().to_string(),
            file_exists,
            installed_locally,
            status: if installed_locally {
                GamerDependencyVerificationStatus::Verified
            } else {
                GamerDependencyVerificationStatus::Missing
            },
            sha256: None,
            expected_sha256,
            sha256_matches: None,
            signature_status: None,
            signature_subject: None,
            publisher_matches: None,
            blocked_reasons,
        };
    }

    if installed_locally {
        return GamerDependencyVerificationItem {
            package_id: package.id.clone(),
            title: package.title.clone(),
            installer_file_name,
            official_source_page: package.official_source_page.clone(),
            official_url,
            cached_path: cached_path.to_string_lossy().to_string(),
            file_exists,
            installed_locally,
            status: GamerDependencyVerificationStatus::Verified,
            sha256: None,
            expected_sha256,
            sha256_matches: None,
            signature_status: None,
            signature_subject: None,
            publisher_matches: None,
            blocked_reasons,
        };
    }

    if expected_sha256.is_none() {
        blocked_reasons.push("SHA256 esperado ainda nao foi aprovado no manifesto.".to_string());
    }

    let probe = match probe_file_security(&cached_path) {
        Ok(probe) => probe,
        Err(error) => {
            blocked_reasons.push(error);
            return build_probe_item(
                package,
                installer_file_name,
                official_url,
                cached_path,
                true,
                installed_locally,
                expected_sha256,
                None,
                blocked_reasons,
                GamerDependencyVerificationStatus::Failed,
            );
        }
    };

    let sha256_matches = expected_sha256.as_ref().and_then(|expected| {
        probe
            .sha256
            .as_ref()
            .map(|actual| actual.eq_ignore_ascii_case(expected))
    });
    if expected_sha256.is_some() && sha256_matches != Some(true) {
        blocked_reasons.push("Hash SHA256 ainda nao confere com o valor esperado.".to_string());
    }

    let signature_ok = probe
        .signature_status
        .as_deref()
        .map(|status| status.eq_ignore_ascii_case("Valid"))
        .unwrap_or(false);
    if !signature_ok {
        blocked_reasons.push("Assinatura Authenticode ainda nao esta valida.".to_string());
    }

    let publisher_matches = probe
        .signature_subject
        .as_ref()
        .map(|subject| subject_confirms_microsoft(subject));
    if publisher_matches != Some(true) {
        blocked_reasons.push("Assinatura nao confirma Microsoft Corporation.".to_string());
    }

    let status = if blocked_reasons.is_empty() {
        GamerDependencyVerificationStatus::Verified
    } else {
        GamerDependencyVerificationStatus::Blocked
    };

    build_probe_item(
        package,
        installer_file_name,
        official_url,
        cached_path,
        true,
        installed_locally,
        expected_sha256,
        Some((probe, sha256_matches, publisher_matches)),
        blocked_reasons,
        status,
    )
}

#[allow(clippy::too_many_arguments)]
fn build_probe_item(
    package: &GamerDependencyVerifyPackage,
    installer_file_name: String,
    official_url: Option<String>,
    cached_path: PathBuf,
    file_exists: bool,
    installed_locally: bool,
    expected_sha256: Option<String>,
    probe: Option<(FileSecurityProbe, Option<bool>, Option<bool>)>,
    blocked_reasons: Vec<String>,
    status: GamerDependencyVerificationStatus,
) -> GamerDependencyVerificationItem {
    let (sha256, signature_status, signature_subject, sha256_matches, publisher_matches) =
        if let Some((probe, sha256_matches, publisher_matches)) = probe {
            (
                probe.sha256,
                probe.signature_status,
                probe.signature_subject,
                sha256_matches,
                publisher_matches,
            )
        } else {
            (None, None, None, None, None)
        };

    GamerDependencyVerificationItem {
        package_id: package.id.clone(),
        title: package.title.clone(),
        installer_file_name,
        official_source_page: package.official_source_page.clone(),
        official_url,
        cached_path: cached_path.to_string_lossy().to_string(),
        file_exists,
        installed_locally,
        status,
        sha256,
        expected_sha256,
        sha256_matches,
        signature_status,
        signature_subject,
        publisher_matches,
        blocked_reasons,
    }
}

fn failed_item(
    cache_dir: &Path,
    package: &GamerDependencyVerifyPackage,
    error: String,
) -> GamerDependencyVerificationItem {
    let cached_path = cache_dir.join(&package.installer_file_name);
    GamerDependencyVerificationItem {
        package_id: package.id.clone(),
        title: package.title.clone(),
        installer_file_name: package.installer_file_name.clone(),
        official_source_page: package.official_source_page.clone(),
        official_url: clean_optional(package.official_url.clone()),
        cached_path: cached_path.to_string_lossy().to_string(),
        file_exists: false,
        installed_locally: false,
        status: GamerDependencyVerificationStatus::Failed,
        sha256: None,
        expected_sha256: clean_optional(package.expected_sha256.clone()),
        sha256_matches: None,
        signature_status: None,
        signature_subject: None,
        publisher_matches: None,
        blocked_reasons: vec![error],
    }
}

fn probe_file_security(path: &Path) -> Result<FileSecurityProbe, String> {
    if !cfg!(target_os = "windows") {
        return Err("Windows necessario para validar Authenticode.".to_string());
    }

    let script = r#"
$ErrorActionPreference = 'Stop'
$path = $args[0]
$hash = Get-FileHash -Algorithm SHA256 -Path $path
$signature = Get-AuthenticodeSignature -FilePath $path
$subject = $null
if ($signature.SignerCertificate) {
  $subject = $signature.SignerCertificate.Subject
}
[pscustomobject]@{
  sha256 = $hash.Hash
  signatureStatus = [string]$signature.Status
  signatureSubject = $subject
} | ConvertTo-Json -Compress
"#;

    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .arg(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let output = command
        .spawn()
        .map_err(|error| format!("Nao foi possivel iniciar verificador Authenticode: {error}"))?
        .wait_with_output()
        .map_err(|error| format!("Falha ao ler verificador Authenticode: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "PowerShell retornou erro ao validar hash/assinatura.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    serde_json::from_str::<FileSecurityProbe>(&stdout)
        .map_err(|error| format!("Verificacao de instalador retornou JSON invalido: {error}"))
}

fn download_file_with_powershell(url: &str, output_path: &Path) -> Result<(), String> {
    let script = r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$url = $args[0]
$outputPath = $args[1]
$parent = Split-Path -Parent $outputPath
if ($parent) {
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
}
if (Test-Path -LiteralPath $outputPath) {
  Remove-Item -LiteralPath $outputPath -Force
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile $outputPath -UseBasicParsing
"#;

    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .arg(url)
        .arg(output_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let output = command
        .spawn()
        .map_err(|error| format!("Nao foi possivel iniciar downloader oficial: {error}"))?
        .wait_with_output()
        .map_err(|error| format!("Falha ao baixar instalador oficial: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "PowerShell retornou erro ao baixar instalador oficial.".to_string()
        } else {
            stderr
        });
    }

    Ok(())
}

fn dependency_already_installed(package: &GamerDependencyVerifyPackage) -> Result<bool, String> {
    if !cfg!(target_os = "windows") {
        return Ok(false);
    }

    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$packageId = $args[0]
$title = $args[1]

if ($packageId -eq 'directx-end-user-runtime') {
  $system32 = Join-Path $env:WINDIR 'System32\d3dx9_43.dll'
  $syswow64 = Join-Path $env:WINDIR 'SysWOW64\d3dx9_43.dll'
  if ((Test-Path -LiteralPath $system32) -or (Test-Path -LiteralPath $syswow64)) { 'true' } else { 'false' }
  exit 0
}

$arch = if ($packageId -match '-x64$') { 'x64' } else { 'x86' }
$year = $null
if ($packageId -match 'vc-redist-(.+)-(x86|x64)$') { $year = $matches[1] }
$keys = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$names = @(Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue |
  Where-Object { [string]$_.DisplayName -match 'Visual C\+\+.*Redistributable' } |
  Select-Object -ExpandProperty DisplayName)
$archPattern = if ($arch -eq 'x64') { '(x64|64-bit)' } else { '(x86|32-bit)' }
if ($year -eq '2015-2022') {
  $found = @($names | Where-Object { $_ -match $archPattern -and $_ -match '(2015|2017|2019|2022|2015-2022)' }).Count -gt 0
} else {
  $found = @($names | Where-Object { $_ -match $archPattern -and $_ -match [regex]::Escape($year) }).Count -gt 0
}
if ($found) { 'true' } else { 'false' }
"#;

    run_powershell_args(script, &[package.id.clone(), package.title.clone()])
        .map(|output| output.trim().eq_ignore_ascii_case("true"))
}

fn is_process_elevated() -> bool {
    if !cfg!(target_os = "windows") {
        return false;
    }

    let script = r#"$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { 'true' } else { 'false' }"#;
    run_powershell_args(script, &[])
        .map(|output| output.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn run_powershell_args(script: &str, args: &[String]) -> Result<String, String> {
    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let output = command
        .spawn()
        .map_err(|error| format!("Nao foi possivel iniciar PowerShell: {error}"))?
        .wait_with_output()
        .map_err(|error| format!("Falha ao ler PowerShell: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "PowerShell retornou erro.".to_string()
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn dependency_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel localizar AppData: {error}"))?;
    dir.push("installer-cache");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Nao foi possivel criar cache de instaladores: {error}"))?;
    Ok(dir)
}

fn dependency_audit_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Nao foi possivel localizar AppData: {error}"))?;
    dir.push("installer-audit");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Nao foi possivel criar pasta de auditoria: {error}"))?;
    Ok(dir)
}

fn open_directory(path: &Path) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("Cache de instaladores disponivel apenas no Windows.".to_string());
    }

    let path_string = path.to_string_lossy().to_string();
    let mut command = Command::new("cmd");
    command
        .args(["/C", "start", "", &path_string])
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
        .map_err(|error| format!("Nao foi possivel abrir cache de instaladores: {error}"))?;
    Ok(())
}

/// Security-critical publisher check for gamer-dependency installers (VC++ Redistributable,
/// DirectX runtime), which only ever come from Microsoft. This deliberately ignores
/// `package.required_publisher` (caller/frontend-supplied - never trust it for the actual
/// gate) and parses the certificate subject's `O=` (Organization) field for an exact,
/// case-insensitive match, instead of a raw substring search across the whole subject string
/// (which a subject like "O=Not Microsoft Corporation Reseller LLC" would have passed).
fn subject_confirms_microsoft(subject: &str) -> bool {
    subject.split(',').any(|part| {
        part.trim()
            .strip_prefix("O=")
            .map(|organization| organization.trim().eq_ignore_ascii_case("Microsoft Corporation"))
            .unwrap_or(false)
    })
}

/// Structural allowlist for what this engine is allowed to install, independent of whatever
/// package list the frontend sends. Per project policy, "gamer dependencies" means only the
/// VC++ Redistributables and the DirectX End-User Runtime - never Visual Studio Build Tools,
/// the VS Installer, Windows SDK, or Windows App Runtime, even though Microsoft signs those
/// too (so the URL+hash+signature checks alone would not stop them).
fn is_allowed_gamer_dependency_id(id: &str) -> bool {
    id.starts_with("vc-redist-") || id == "directx-end-user-runtime"
}

fn validate_official_download_url(url: &str) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    let allowed = [
        "https://aka.ms/",
        "https://download.microsoft.com/",
        "https://www.microsoft.com/",
    ];

    if allowed.iter().any(|prefix| lower.starts_with(prefix)) {
        return Ok(());
    }

    Err("URL direta precisa ser HTTPS e pertencer a Microsoft/aka.ms.".to_string())
}

fn sanitize_installer_file_name(file_name: &str) -> Result<String, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err("Nome do instalador esta vazio.".to_string());
    }

    let path = Path::new(trimmed);
    if path.components().count() != 1 || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Nome do instalador deve ser apenas arquivo, sem caminho.".to_string());
    }

    if !trimmed.to_ascii_lowercase().ends_with(".exe") {
        return Err("Instalador gamer precisa ser um .exe.".to_string());
    }

    Ok(trimmed.to_string())
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn now_timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    millis.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_package(expected_sha256: Option<&str>) -> GamerDependencyVerifyPackage {
        GamerDependencyVerifyPackage {
            id: "vc-redist-2015-2022-x64".to_string(),
            title: "Microsoft Visual C++ 2015-2022 Redistributable x64".to_string(),
            installer_file_name: "vc_redist.x64.exe".to_string(),
            official_source_page:
                "https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist"
                    .to_string(),
            official_url: Some("https://aka.ms/vs/17/release/vc_redist.x64.exe".to_string()),
            expected_sha256: expected_sha256.map(ToString::to_string),
            required_publisher: "Microsoft Corporation".to_string(),
        }
    }

    #[test]
    fn dependency_download_skips_without_expected_sha256_before_network() {
        let cache_dir =
            std::env::temp_dir().join(format!("hermes-dependency-test-{}", now_timestamp()));
        fs::create_dir_all(&cache_dir).expect("temp cache dir");

        let result = download_package(&cache_dir, &test_package(None));

        let _ = fs::remove_dir_all(&cache_dir);
        match result {
            Ok(DownloadOutcome::Skipped(message)) => {
                assert!(message.contains("SHA256 esperado ainda nao foi aprovado"));
            }
            Ok(DownloadOutcome::Downloaded(_)) => {
                panic!("download sem SHA256 esperado deveria ser pulado")
            }
            Err(error) => panic!("download sem SHA256 nao deveria virar falha: {error}"),
        }
    }

    #[test]
    fn dependency_installer_name_must_be_plain_exe_file() {
        assert!(sanitize_installer_file_name("vc_redist.x64.exe").is_ok());
        assert!(sanitize_installer_file_name("..\\vc_redist.x64.exe").is_err());
        assert!(sanitize_installer_file_name("vc_redist.x64.msi").is_err());
    }
}
