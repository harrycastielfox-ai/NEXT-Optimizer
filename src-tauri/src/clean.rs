use crate::{
    restore::{
        self, RestoreCreateSnapshotRequest, RestorePlannedAction, RestorePreviousState,
        RestorePreviousStateCategory, RestoreRiskLevel, RestoreRollbackAction,
        RestoreRollbackActionStatus, RestoreRollbackActionType,
    },
    safe_mode,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const POWERSHELL_TIMEOUT_SECONDS: u64 = 24;
const MAX_CLEAN_EVENTS: usize = 100;
const MAX_CLEAN_CANDIDATES_PER_PATH: usize = 500;
const MIN_ENTRY_AGE_SECONDS: u64 = 600;
const MIN_OLD_LOG_AGE_SECONDS: u64 = 24 * 60 * 60;
const MIN_WINDOWS_UPDATE_CACHE_AGE_SECONDS: u64 = 24 * 60 * 60;
const MIN_STEAM_DOWNLOAD_CACHE_AGE_SECONDS: u64 = 60 * 60;
const QUARANTINE_RETENTION_SECONDS: u64 = 14 * 24 * 60 * 60;
const MAX_QUARANTINE_PURGE_ENTRIES: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanScanReport {
    pub generated_at: String,
    pub engine_version: String,
    pub read_only: bool,
    pub will_delete_files: bool,
    pub total_bytes: u64,
    pub total_gb: f32,
    pub items: Vec<CleanScanItem>,
    pub protected_locations: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanScanItem {
    pub id: String,
    pub label: String,
    pub description: String,
    pub estimated_bytes: u64,
    pub estimated_gb: f32,
    pub paths: Vec<String>,
    pub selected_by_default: bool,
    pub safe_to_clean_later: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanApplyRequest {
    pub confirmed: bool,
    pub dry_run: Option<bool>,
    pub item_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanQuarantinePurgeRequest {
    pub confirmed: bool,
    pub dry_run: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanApplyResult {
    pub generated_at: String,
    pub engine_version: String,
    pub dry_run: bool,
    pub snapshot_id: String,
    pub rollback_available: bool,
    pub selected_items: usize,
    pub planned_entries: usize,
    pub quarantined_entries: usize,
    pub skipped_entries: usize,
    pub failed_entries: usize,
    pub quarantined_bytes: u64,
    pub quarantined_gb: f32,
    pub purged_quarantine_entries: usize,
    pub purged_quarantine_bytes: u64,
    pub quarantine_retention_days: u64,
    pub message: String,
    pub actions: Vec<CleanApplyActionResult>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanQuarantinePurgeResult {
    pub generated_at: String,
    pub engine_version: String,
    pub dry_run: bool,
    pub confirmed: bool,
    pub retention_days: u64,
    pub scanned_entries: usize,
    pub purged_entries: usize,
    pub skipped_entries: usize,
    pub failed_entries: usize,
    pub purged_bytes: u64,
    pub purged_gb: f32,
    pub message: String,
    pub actions: Vec<CleanQuarantinePurgeActionResult>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanApplyActionResult {
    pub item_id: String,
    pub original_path: String,
    pub backup_path: Option<String>,
    pub bytes: u64,
    pub status: CleanApplyActionStatus,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanQuarantinePurgeActionResult {
    pub path: String,
    pub bytes: u64,
    pub status: CleanQuarantinePurgeStatus,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CleanApplyActionStatus {
    DryRun,
    Quarantined,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CleanQuarantinePurgeStatus {
    DryRun,
    Purged,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CleanEvent {
    id: String,
    timestamp: String,
    snapshot_id: Option<String>,
    level: CleanEventLevel,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum CleanEventLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CleanEventHistory {
    events: Vec<CleanEvent>,
}

#[derive(Debug, Clone)]
struct CleanMovePlan {
    item_id: String,
    item_label: String,
    original_path: PathBuf,
    backup_path: PathBuf,
    bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCleanScanReport {
    items: Option<Vec<RawCleanScanItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCleanScanItem {
    id: Option<String>,
    label: Option<String>,
    description: Option<String>,
    estimated_bytes: Option<f64>,
    paths: Option<Vec<String>>,
}

#[tauri::command]
pub async fn clean_engine_scan() -> CleanScanReport {
    tauri::async_runtime::spawn_blocking(collect_clean_scan)
        .await
        .unwrap_or_else(|err| {
            let mut report = fallback_report();
            report
                .warnings
                .push(format!("Falha ao escanear limpeza em segundo plano: {err}"));
            report
        })
}

#[tauri::command]
pub async fn clean_engine_apply(
    app: AppHandle,
    request: Option<CleanApplyRequest>,
) -> Result<CleanApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || clean_engine_apply_blocking(app, request, true))
        .await
        .map_err(|err| format!("Falha ao executar Clean Engine em segundo plano: {err}"))?
}

#[tauri::command]
pub async fn clean_engine_apply_optimize_now(
    app: AppHandle,
    request: Option<CleanApplyRequest>,
) -> Result<CleanApplyResult, String> {
    // enforce_safe_test_mode must stay `true` here: this is the "Otimizar Agora" one-click
    // path and it must never be able to bypass the global HERMES_SAFE_TEST_MODE build flag.
    tauri::async_runtime::spawn_blocking(move || clean_engine_apply_blocking(app, request, true))
        .await
        .map_err(|err| format!("Falha ao executar limpeza do Otimizar Agora: {err}"))?
}

#[tauri::command]
pub async fn clean_quarantine_purge_expired(
    app: AppHandle,
    request: Option<CleanQuarantinePurgeRequest>,
) -> Result<CleanQuarantinePurgeResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let request = request.unwrap_or_default();
        let dry_run = safe_mode::force_dry_run(request.dry_run.unwrap_or(!request.confirmed));
        purge_expired_quarantine(&app, dry_run, request.confirmed)
    })
    .await
    .map_err(|err| format!("Falha ao limpar quarentena em segundo plano: {err}"))?
}

pub(crate) fn clean_engine_apply_blocking(
    app: AppHandle,
    request: Option<CleanApplyRequest>,
    enforce_safe_test_mode: bool,
) -> Result<CleanApplyResult, String> {
    let request = request.unwrap_or_default();
    let requested_dry_run = request.dry_run.unwrap_or(!request.confirmed);
    let dry_run = if enforce_safe_test_mode {
        safe_mode::force_dry_run(requested_dry_run)
    } else {
        requested_dry_run
    };
    if !dry_run && !request.confirmed {
        return Err("Confirmacao obrigatoria antes de aplicar limpeza real.".to_string());
    }
    crate::licensing::require_real_license(dry_run)?;

    let mut warnings = Vec::new();
    let scan = collect_clean_scan();
    if has_fallback_warning(&scan.warnings) {
        return Err(
            "Clean Engine nao aplicou limpeza: scan real indisponivel, fallback ignorado."
                .to_string(),
        );
    }

    let selected_items = selected_clean_items(&scan, request.item_ids.as_deref(), &mut warnings);
    if selected_items.is_empty() {
        return Err("Nenhum item seguro de limpeza foi selecionado.".to_string());
    }

    let snapshot_seed = format!("clean-{}-{}", now_timestamp(), now_nanos());
    let plans = build_move_plans(&app, &snapshot_seed, &selected_items, &mut warnings)?;
    if plans.is_empty() {
        return Err("Nenhum arquivo elegivel para quarentena segura foi encontrado.".to_string());
    }

    let snapshot = restore::create_snapshot(
        app.clone(),
        Some(build_clean_snapshot_request(&plans, dry_run)),
    )?;
    append_clean_event(
        &app,
        CleanEventLevel::Info,
        Some(snapshot.id.clone()),
        if dry_run {
            "DRY-RUN | Clean Engine iniciou dry-run com snapshot obrigatorio."
        } else {
            "Clean Engine iniciou quarentena reversivel apos confirmacao."
        },
    )?;

    let actions = if dry_run {
        plans
            .iter()
            .map(|plan| CleanApplyActionResult {
                item_id: plan.item_id.clone(),
                original_path: path_text(&plan.original_path),
                backup_path: Some(path_text(&plan.backup_path)),
                bytes: plan.bytes,
                status: CleanApplyActionStatus::DryRun,
                message: format!(
                    "{} — nenhum arquivo foi movido.",
                    safe_mode::mode_prefix(dry_run)
                ),
            })
            .collect::<Vec<_>>()
    } else {
        apply_quarantine(&plans)
    };

    let moved_plans = plans
        .iter()
        .zip(actions.iter())
        .filter_map(|(plan, action)| {
            if action.status == CleanApplyActionStatus::Quarantined {
                Some(plan.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    let quarantined_bytes = actions
        .iter()
        .filter(|action| action.status == CleanApplyActionStatus::Quarantined)
        .map(|action| action.bytes)
        .sum::<u64>();
    let quarantined_entries = actions
        .iter()
        .filter(|action| action.status == CleanApplyActionStatus::Quarantined)
        .count();
    let skipped_entries = actions
        .iter()
        .filter(|action| action.status == CleanApplyActionStatus::Skipped)
        .count();
    let failed_entries = actions
        .iter()
        .filter(|action| action.status == CleanApplyActionStatus::Failed)
        .count();

    if !dry_run {
        restore::restore_replace_snapshot_manifest(
            app.clone(),
            &snapshot.id,
            moved_plans
                .iter()
                .enumerate()
                .map(|(index, plan)| plan_to_rollback(index, plan))
                .collect(),
            moved_plans.iter().map(plan_to_previous_state).collect(),
            "Clean Engine registrou rollback dos itens movidos para quarentena.",
        )?;
    }

    let level = if failed_entries > 0 {
        CleanEventLevel::Warning
    } else {
        CleanEventLevel::Info
    };
    let message = clean_apply_message(
        dry_run,
        quarantined_entries,
        skipped_entries,
        failed_entries,
    );
    append_clean_event(&app, level, Some(snapshot.id.clone()), &message)?;
    let purge_result = purge_expired_quarantine(&app, dry_run, request.confirmed)?;
    if purge_result.purged_entries > 0 || purge_result.failed_entries > 0 {
        append_clean_event(
            &app,
            if purge_result.failed_entries > 0 {
                CleanEventLevel::Warning
            } else {
                CleanEventLevel::Info
            },
            Some(snapshot.id.clone()),
            &purge_result.message,
        )?;
    }
    warnings.extend(purge_result.warnings.iter().cloned());

    Ok(CleanApplyResult {
        generated_at: now_timestamp(),
        engine_version: "clean-engine-quarantine-v2".to_string(),
        dry_run,
        snapshot_id: snapshot.id,
        rollback_available: true,
        selected_items: selected_items.len(),
        planned_entries: plans.len(),
        quarantined_entries,
        skipped_entries,
        failed_entries,
        quarantined_bytes,
        quarantined_gb: round1(bytes_to_gb(quarantined_bytes as f64)),
        purged_quarantine_entries: purge_result.purged_entries,
        purged_quarantine_bytes: purge_result.purged_bytes,
        quarantine_retention_days: quarantine_retention_days(),
        message,
        actions,
        warnings,
    })
}

pub fn collect_clean_scan() -> CleanScanReport {
    match collect_windows_clean_scan() {
        Ok(raw) => build_report(raw, Vec::new()),
        Err(error) => {
            let mut report = fallback_report();
            report.warnings.push(error);
            report
        }
    }
}

fn collect_windows_clean_scan() -> Result<RawCleanScanReport, String> {
    if !cfg!(target_os = "windows") {
        return Err("Clean Engine Scan usa leitura local do Windows.".to_string());
    }

    let stdout = run_powershell(POWERSHELL_CLEAN_SCAN_SCRIPT)?;
    serde_json::from_str::<RawCleanScanReport>(&stdout)
        .map_err(|err| format!("Nao foi possivel interpretar scan de limpeza: {err}"))
}

fn build_report(raw: RawCleanScanReport, warnings: Vec<String>) -> CleanScanReport {
    let items = raw
        .items
        .unwrap_or_default()
        .into_iter()
        .map(build_item)
        .collect::<Vec<_>>();
    let total_bytes = items.iter().map(|item| item.estimated_bytes).sum::<u64>();

    CleanScanReport {
        generated_at: now_timestamp(),
        engine_version: "clean-engine-scan-readonly-v1".to_string(),
        read_only: true,
        will_delete_files: false,
        total_bytes,
        total_gb: round1(bytes_to_gb(total_bytes as f64)),
        items,
        protected_locations: vec![
            "Downloads".to_string(),
            "Documentos".to_string(),
            "Desktop".to_string(),
            "Imagens".to_string(),
            "Videos".to_string(),
        ],
        warnings,
    }
}

fn build_item(raw: RawCleanScanItem) -> CleanScanItem {
    let id = value_or(raw.id, "unknown");
    let scan_only = matches!(id.as_str(), "log-rotation" | "storage-summary");
    let estimated_bytes = raw.estimated_bytes.unwrap_or_default().max(0.0) as u64;
    CleanScanItem {
        id,
        label: value_or(raw.label, "Item de limpeza"),
        description: value_or(raw.description, "Somente leitura"),
        estimated_bytes,
        estimated_gb: round1(bytes_to_gb(estimated_bytes as f64)),
        paths: raw.paths.unwrap_or_default(),
        selected_by_default: !scan_only,
        safe_to_clean_later: !scan_only,
    }
}

fn fallback_report() -> CleanScanReport {
    build_report(
        RawCleanScanReport {
            items: Some(Vec::new()),
        },
        vec!["Fallback indisponivel usado porque o scan real nao respondeu. Nenhum tamanho demonstrativo foi retornado.".to_string()],
    )
}

fn selected_clean_items(
    report: &CleanScanReport,
    requested_ids: Option<&[String]>,
    warnings: &mut Vec<String>,
) -> Vec<CleanScanItem> {
    let requested = requested_ids.unwrap_or_default();
    report
        .items
        .iter()
        .filter(|item| {
            if requested.is_empty() {
                item.selected_by_default
            } else {
                requested.iter().any(|id| id == &item.id)
            }
        })
        .filter_map(|item| {
            if is_supported_clean_item(&item.id) {
                Some(item.clone())
            } else {
                warnings.push(format!(
                    "{} ainda nao entra na aplicacao real desta etapa. Ficou somente no scan.",
                    item.label
                ));
                None
            }
        })
        .collect()
}

fn is_supported_clean_item(id: &str) -> bool {
    matches!(
        id,
        "temp"
            | "cache"
            | "logs"
            | "thumbnails"
            | "windows-update-cache"
            | "store-cache"
            | "nvidia-shader-cache"
            | "amd-shader-cache"
            | "steam-download-cache"
            | "epic-launcher-cache"
            | "battle-net-cache"
            | "discord-cache"
            | "obs-cache"
    )
}

fn build_move_plans(
    app: &AppHandle,
    snapshot_seed: &str,
    items: &[CleanScanItem],
    warnings: &mut Vec<String>,
) -> Result<Vec<CleanMovePlan>, String> {
    let mut plans = Vec::new();
    let mut planned_targets = HashSet::new();
    let quarantine_root = clean_quarantine_dir(app, snapshot_seed)?;

    for item in items {
        for root in &item.paths {
            if root.contains('*') {
                warnings.push(format!(
                    "{} ignorado nesta etapa porque usa padrao wildcard: {}",
                    item.label, root
                ));
                continue;
            }

            let root_path = PathBuf::from(root);
            if !is_safe_clean_target(&root_path) {
                warnings.push(format!(
                    "{} ignorado por estar fora da allowlist de limpeza: {}",
                    item.label, root
                ));
                continue;
            }

            let candidates = collect_candidates_for_item(item, &root_path, warnings);
            for candidate in candidates {
                if plans.len() >= MAX_CLEAN_CANDIDATES_PER_PATH * items.len().max(1) {
                    warnings.push(
                        "Limite de candidatos da Clean Engine atingido nesta execucao.".to_string(),
                    );
                    return Ok(plans);
                }

                if !is_safe_clean_target(&candidate) {
                    warnings.push(format!(
                        "Candidato ignorado por seguranca: {}",
                        path_text(&candidate)
                    ));
                    continue;
                }
                if is_symlink(&candidate) {
                    warnings.push(format!(
                        "Candidato ignorado por ser link simbolico/reparse: {}",
                        path_text(&candidate)
                    ));
                    continue;
                }
                let normalized_candidate = normalize_path_text(&candidate);
                if !planned_targets.insert(normalized_candidate) {
                    continue;
                }
                if !is_old_enough_for_item(&item.id, &candidate) {
                    continue;
                }

                let bytes = entry_size(&candidate);
                if bytes == 0 {
                    continue;
                }

                let backup_path =
                    backup_path_for(&quarantine_root, &item.id, plans.len(), &candidate)?;
                plans.push(CleanMovePlan {
                    item_id: item.id.clone(),
                    item_label: item.label.clone(),
                    original_path: candidate,
                    backup_path,
                    bytes,
                });
            }
        }
    }

    Ok(plans)
}

fn collect_candidates_for_item(
    item: &CleanScanItem,
    root: &Path,
    warnings: &mut Vec<String>,
) -> Vec<PathBuf> {
    if item.id == "logs" {
        return collect_log_candidates(root, warnings);
    }

    let Ok(read_dir) = fs::read_dir(root) else {
        warnings.push(format!(
            "Nao foi possivel acessar {} para limpeza.",
            path_text(root)
        ));
        return Vec::new();
    };

    read_dir
        .filter_map(Result::ok)
        .take(MAX_CLEAN_CANDIDATES_PER_PATH)
        .map(|entry| entry.path())
        .filter(|path| {
            if item.id == "thumbnails" {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| {
                        let lower = name.to_ascii_lowercase();
                        lower.starts_with("thumbcache_") && lower.ends_with(".db")
                    })
                    .unwrap_or(false)
            } else if item.id == "windows-update-cache" {
                true
            } else {
                true
            }
        })
        .collect()
}

fn collect_log_candidates(root: &Path, warnings: &mut Vec<String>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(current) = stack.pop() {
        if candidates.len() >= MAX_CLEAN_CANDIDATES_PER_PATH {
            warnings.push(format!(
                "Limite de arquivos de log atingido em {}.",
                path_text(root)
            ));
            break;
        }

        let Ok(read_dir) = fs::read_dir(&current) else {
            warnings.push(format!(
                "Nao foi possivel acessar {} para logs antigos.",
                path_text(&current)
            ));
            continue;
        };

        for entry in read_dir.filter_map(Result::ok) {
            let path = entry.path();
            if is_symlink(&path) {
                continue;
            }
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if path.is_file() && is_allowed_log_file(&path) {
                candidates.push(path);
                if candidates.len() >= MAX_CLEAN_CANDIDATES_PER_PATH {
                    break;
                }
            }
        }
    }

    candidates
}

fn build_clean_snapshot_request(
    plans: &[CleanMovePlan],
    dry_run: bool,
) -> RestoreCreateSnapshotRequest {
    let mode = if dry_run {
        "dry-run"
    } else {
        "quarentena real"
    };
    RestoreCreateSnapshotRequest {
        name: Some("Clean Engine - Snapshot de limpeza".to_string()),
        description: Some(format!(
            "Snapshot obrigatorio antes da {mode} de itens temporarios seguros."
        )),
        planned_actions: Some(
            plans
                .iter()
                .enumerate()
                .map(|(index, plan)| RestorePlannedAction {
                    id: format!("clean-plan-{}-{}", plan.item_id, index + 1),
                    engine: "clean-engine".to_string(),
                    title: format!("Quarentenar {}", plan.item_label),
                    description: format!(
                        "Mover {} para quarentena reversivel NEX.",
                        path_text(&plan.original_path)
                    ),
                    risk: RestoreRiskLevel::Low,
                    will_modify_system: true,
                    requires_admin: false,
                })
                .collect(),
        ),
        rollback_manifest: Some(
            plans
                .iter()
                .enumerate()
                .map(|(index, plan)| plan_to_rollback(index, plan))
                .collect(),
        ),
        previous_state: Some(plans.iter().map(plan_to_previous_state).collect()),
    }
}

fn apply_quarantine(plans: &[CleanMovePlan]) -> Vec<CleanApplyActionResult> {
    plans
        .iter()
        .map(|plan| {
            if plan.backup_path.exists() {
                return CleanApplyActionResult {
                    item_id: plan.item_id.clone(),
                    original_path: path_text(&plan.original_path),
                    backup_path: Some(path_text(&plan.backup_path)),
                    bytes: plan.bytes,
                    status: CleanApplyActionStatus::Skipped,
                    message: "Backup ja existe na quarentena. Item pulado.".to_string(),
                };
            }

            if let Some(parent) = plan.backup_path.parent() {
                if let Err(error) = fs::create_dir_all(parent) {
                    return CleanApplyActionResult {
                        item_id: plan.item_id.clone(),
                        original_path: path_text(&plan.original_path),
                        backup_path: Some(path_text(&plan.backup_path)),
                        bytes: plan.bytes,
                        status: CleanApplyActionStatus::Failed,
                        message: format!("Falha ao preparar quarentena: {error}"),
                    };
                }
            }

            match fs::rename(&plan.original_path, &plan.backup_path) {
                Ok(_) => CleanApplyActionResult {
                    item_id: plan.item_id.clone(),
                    original_path: path_text(&plan.original_path),
                    backup_path: Some(path_text(&plan.backup_path)),
                    bytes: plan.bytes,
                    status: CleanApplyActionStatus::Quarantined,
                    message: "Item movido para quarentena reversivel.".to_string(),
                },
                Err(error) => CleanApplyActionResult {
                    item_id: plan.item_id.clone(),
                    original_path: path_text(&plan.original_path),
                    backup_path: Some(path_text(&plan.backup_path)),
                    bytes: plan.bytes,
                    status: if should_skip_move_error(error.kind()) {
                        CleanApplyActionStatus::Skipped
                    } else {
                        CleanApplyActionStatus::Failed
                    },
                    message: if should_skip_move_error(error.kind()) {
                        format!("Item em uso, indisponivel ou sem permissao. Pulado: {error}")
                    } else {
                        format!("Nao foi possivel mover para quarentena: {error}")
                    },
                },
            }
        })
        .collect()
}

fn plan_to_rollback(index: usize, plan: &CleanMovePlan) -> RestoreRollbackAction {
    RestoreRollbackAction {
        id: format!("rollback-clean-{}-{}", plan.item_id, index + 1),
        action_type: RestoreRollbackActionType::RestoreFileBackup,
        target: path_text(&plan.original_path),
        description: format!(
            "Restaurar {} da quarentena NEX para o local original.",
            plan.item_label
        ),
        previous_value: None,
        backup_path: Some(path_text(&plan.backup_path)),
        command_preview: Some("Move-Item from NEX quarantine".to_string()),
        status: RestoreRollbackActionStatus::Pending,
    }
}

fn plan_to_previous_state(plan: &CleanMovePlan) -> RestorePreviousState {
    RestorePreviousState {
        key: format!(
            "clean-{}-{}",
            plan.item_id,
            sanitize_id(&path_text(&plan.original_path))
        ),
        category: RestorePreviousStateCategory::File,
        value: format!("{} bytes em {}", plan.bytes, path_text(&plan.original_path)),
        source: "Clean Engine quarantine".to_string(),
        captured: true,
    }
}

fn clean_apply_message(
    dry_run: bool,
    quarantined_entries: usize,
    skipped_entries: usize,
    failed_entries: usize,
) -> String {
    if dry_run {
        format!(
            "{} — Clean Engine validada. Nenhum arquivo foi movido. {}",
            safe_mode::mode_prefix(dry_run),
            if safe_mode::is_enabled() {
                safe_mode::notice()
            } else {
                ""
            }
        )
    } else if failed_entries > 0 {
        format!(
            "Clean Engine moveu {} item(ns) para quarentena, pulou {} e falhou em {}.",
            quarantined_entries, skipped_entries, failed_entries
        )
    } else {
        format!(
            "Clean Engine moveu {} item(ns) para quarentena reversivel.",
            quarantined_entries
        )
    }
}

fn clean_quarantine_dir(app: &AppHandle, snapshot_seed: &str) -> Result<PathBuf, String> {
    let mut dir = clean_quarantine_root(app)?;
    dir.push(snapshot_seed);
    Ok(dir)
}

fn clean_quarantine_root(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Nao foi possivel localizar AppData: {err}"))?;
    dir.push("history");
    dir.push("clean_quarantine");
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Nao foi possivel preparar quarentena: {err}"))?;
    Ok(dir)
}

fn purge_expired_quarantine(
    app: &AppHandle,
    dry_run: bool,
    confirmed: bool,
) -> Result<CleanQuarantinePurgeResult, String> {
    if !dry_run && !confirmed {
        return Err("Confirmacao obrigatoria antes de limpar quarentena expirada.".to_string());
    }
    crate::licensing::require_real_license(dry_run)?;

    let root = clean_quarantine_root(app)?;
    let mut warnings = Vec::new();
    let protected_backups = match active_restore_backup_paths(app) {
        Ok(paths) => paths,
        Err(error) => {
            warnings.push(format!(
                "Limpeza da quarentena bloqueada para preservar rollback: {error}"
            ));
            return Ok(clean_quarantine_purge_result(
                dry_run,
                confirmed,
                0,
                Vec::new(),
                warnings,
            ));
        }
    };
    let mut actions = Vec::new();

    let Ok(read_dir) = fs::read_dir(&root) else {
        return Ok(clean_quarantine_purge_result(
            dry_run,
            confirmed,
            0,
            actions,
            vec!["Quarentena ainda nao possui entradas para expirar.".to_string()],
        ));
    };

    for entry in read_dir.filter_map(Result::ok) {
        if actions.len() >= MAX_QUARANTINE_PURGE_ENTRIES {
            warnings.push("Limite de limpeza da quarentena atingido nesta execucao.".to_string());
            break;
        }

        let path = entry.path();
        if !is_inside_clean_quarantine(&root, &path) || is_symlink(&path) {
            actions.push(CleanQuarantinePurgeActionResult {
                path: path_text(&path),
                bytes: 0,
                status: CleanQuarantinePurgeStatus::Skipped,
                message: "Entrada fora do padrao seguro da quarentena. Pulada.".to_string(),
            });
            continue;
        }

        if !is_quarantine_entry_expired(&path) {
            actions.push(CleanQuarantinePurgeActionResult {
                path: path_text(&path),
                bytes: 0,
                status: CleanQuarantinePurgeStatus::Skipped,
                message: "Quarentena ainda dentro do periodo de retencao.".to_string(),
            });
            continue;
        }

        if is_referenced_by_restore_snapshot(&path, &protected_backups) {
            actions.push(CleanQuarantinePurgeActionResult {
                path: path_text(&path),
                bytes: 0,
                status: CleanQuarantinePurgeStatus::Skipped,
                message: "Entrada ainda referenciada por snapshot ativo de restore.".to_string(),
            });
            continue;
        }

        let bytes = entry_size(&path);
        if dry_run {
            actions.push(CleanQuarantinePurgeActionResult {
                path: path_text(&path),
                bytes,
                status: CleanQuarantinePurgeStatus::DryRun,
                message: "Quarentena expirada validada para limpeza futura.".to_string(),
            });
            continue;
        }

        let result = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };

        match result {
            Ok(_) => actions.push(CleanQuarantinePurgeActionResult {
                path: path_text(&path),
                bytes,
                status: CleanQuarantinePurgeStatus::Purged,
                message: "Quarentena expirada removida definitivamente.".to_string(),
            }),
            Err(error) => actions.push(CleanQuarantinePurgeActionResult {
                path: path_text(&path),
                bytes,
                status: if should_skip_move_error(error.kind()) {
                    CleanQuarantinePurgeStatus::Skipped
                } else {
                    CleanQuarantinePurgeStatus::Failed
                },
                message: if should_skip_move_error(error.kind()) {
                    format!("Quarentena em uso ou sem permissao. Pulada: {error}")
                } else {
                    format!("Falha ao remover quarentena expirada: {error}")
                },
            }),
        }
    }

    let result =
        clean_quarantine_purge_result(dry_run, confirmed, actions.len(), actions, warnings);
    append_clean_event(
        app,
        if result.failed_entries > 0 {
            CleanEventLevel::Warning
        } else {
            CleanEventLevel::Info
        },
        None,
        &result.message,
    )?;
    Ok(result)
}

fn clean_quarantine_purge_result(
    dry_run: bool,
    confirmed: bool,
    scanned_entries: usize,
    actions: Vec<CleanQuarantinePurgeActionResult>,
    warnings: Vec<String>,
) -> CleanQuarantinePurgeResult {
    let purged_entries = actions
        .iter()
        .filter(|action| action.status == CleanQuarantinePurgeStatus::Purged)
        .count();
    let skipped_entries = actions
        .iter()
        .filter(|action| action.status == CleanQuarantinePurgeStatus::Skipped)
        .count();
    let failed_entries = actions
        .iter()
        .filter(|action| action.status == CleanQuarantinePurgeStatus::Failed)
        .count();
    let purged_bytes = actions
        .iter()
        .filter(|action| action.status == CleanQuarantinePurgeStatus::Purged)
        .map(|action| action.bytes)
        .sum::<u64>();
    let dry_run_entries = actions
        .iter()
        .filter(|action| action.status == CleanQuarantinePurgeStatus::DryRun)
        .count();
    let message = if dry_run {
        format!(
            "Quarentena validada em dry-run: {} entrada(s) expirada(s) poderiam ser removidas.",
            dry_run_entries
        )
    } else if failed_entries > 0 {
        format!(
            "Quarentena expirada: {} removida(s), {} pulada(s), {} falha(s).",
            purged_entries, skipped_entries, failed_entries
        )
    } else {
        format!(
            "Quarentena expirada: {} entrada(s) removida(s) definitivamente.",
            purged_entries
        )
    };

    CleanQuarantinePurgeResult {
        generated_at: now_timestamp(),
        engine_version: "clean-quarantine-retention-v1".to_string(),
        dry_run,
        confirmed,
        retention_days: quarantine_retention_days(),
        scanned_entries,
        purged_entries,
        skipped_entries,
        failed_entries,
        purged_bytes,
        purged_gb: round1(bytes_to_gb(purged_bytes as f64)),
        message,
        actions,
        warnings,
    }
}

fn backup_path_for(
    quarantine_root: &Path,
    item_id: &str,
    index: usize,
    original_path: &Path,
) -> Result<PathBuf, String> {
    let file_name = original_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(sanitize_id)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "item".to_string());
    let mut path = quarantine_root.to_path_buf();
    path.push(sanitize_id(item_id));
    path.push(format!("{index:05}-{file_name}"));
    Ok(path)
}

fn active_restore_backup_paths(app: &AppHandle) -> Result<HashSet<String>, String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Nao foi possivel localizar AppData: {err}"))?;
    path.push("history");
    path.push("restore_snapshots.json");

    if !path.exists() {
        return Ok(HashSet::new());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|err| format!("Nao foi possivel ler snapshots ativos: {err}"))?;
    let json = serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|err| format!("Nao foi possivel interpretar snapshots ativos: {err}"))?;
    let mut paths = HashSet::new();

    if let Some(snapshots) = json.get("snapshots").and_then(|value| value.as_array()) {
        for snapshot in snapshots {
            let Some(actions) = snapshot
                .get("rollbackManifest")
                .and_then(|value| value.as_array())
            else {
                continue;
            };

            for action in actions {
                if let Some(backup_path) = action.get("backupPath").and_then(|value| value.as_str())
                {
                    paths.insert(normalize_path_text(backup_path));
                }
            }
        }
    }

    Ok(paths)
}

fn is_inside_clean_quarantine(root: &Path, path: &Path) -> bool {
    let root = normalize_path_text(root);
    let path = normalize_path_text(path);
    !root.is_empty() && path.starts_with(&(root + "\\"))
}

fn is_quarantine_entry_expired(path: &Path) -> bool {
    if let Some(age) = quarantine_age_from_name(path) {
        return age.as_secs() >= QUARANTINE_RETENTION_SECONDS;
    }

    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    let Ok(modified) = metadata.modified() else {
        return false;
    };
    modified
        .elapsed()
        .map(|age| age.as_secs() >= QUARANTINE_RETENTION_SECONDS)
        .unwrap_or(false)
}

fn quarantine_age_from_name(path: &Path) -> Option<Duration> {
    let name = path.file_name()?.to_str()?;
    let mut parts = name.split('-');
    if parts.next()? != "clean" {
        return None;
    }
    let timestamp = parts.next()?.parse::<u64>().ok()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(Duration::from_secs(now.saturating_sub(timestamp)))
}

fn is_referenced_by_restore_snapshot(path: &Path, backup_paths: &HashSet<String>) -> bool {
    let normalized = normalize_path_text(path);
    backup_paths
        .iter()
        .any(|backup| backup == &normalized || backup.starts_with(&(normalized.clone() + "\\")))
}

fn quarantine_retention_days() -> u64 {
    QUARANTINE_RETENTION_SECONDS / 60 / 60 / 24
}

fn append_clean_event(
    app: &AppHandle,
    level: CleanEventLevel,
    snapshot_id: Option<String>,
    message: &str,
) -> Result<(), String> {
    let path = clean_events_path(app)?;
    let mut history = read_clean_event_history(&path);
    history.events.insert(
        0,
        CleanEvent {
            id: format!("clean-event-{}-{}", now_timestamp(), now_nanos()),
            timestamp: now_timestamp(),
            snapshot_id,
            level,
            message: message.to_string(),
        },
    );
    history.events.truncate(MAX_CLEAN_EVENTS);
    write_clean_event_history(&path, &history)
}

fn clean_events_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Nao foi possivel localizar AppData: {err}"))?;
    dir.push("history");
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Nao foi possivel criar historico de limpeza: {err}"))?;
    dir.push("clean_events.json");
    Ok(dir)
}

fn read_clean_event_history(path: &Path) -> CleanEventHistory {
    let Ok(contents) = fs::read_to_string(path) else {
        return CleanEventHistory::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_clean_event_history(path: &Path, history: &CleanEventHistory) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(history)
        .map_err(|err| format!("Nao foi possivel serializar logs de limpeza: {err}"))?;
    fs::write(path, contents)
        .map_err(|err| format!("Nao foi possivel gravar logs de limpeza: {err}"))
}

fn has_fallback_warning(warnings: &[String]) -> bool {
    warnings.iter().any(|warning| {
        let lower = warning.to_ascii_lowercase();
        lower.contains("fallback") || lower.contains("demo")
    })
}

fn is_safe_clean_target(path: &Path) -> bool {
    let normalized = normalize_path_text(path);
    if normalized.is_empty() || normalized.contains('*') || has_protected_user_location(&normalized)
    {
        return false;
    }

    allowed_clean_roots()
        .into_iter()
        .any(|root| normalized == root || normalized.starts_with(&(root + "\\")))
}

fn allowed_clean_roots() -> Vec<String> {
    let mut roots = Vec::new();
    if let Ok(temp) = std::env::var("TEMP") {
        roots.push(normalize_path_text(temp));
    }
    if let Ok(windir) = std::env::var("WINDIR") {
        let windows = Path::new(&windir);
        roots.push(normalize_path_text(windows.join("Temp")));
        roots.push(normalize_path_text(windows.join("Logs")));
        roots.push(normalize_path_text(
            windows.join("SoftwareDistribution\\Download"),
        ));
    }
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let local = Path::new(&local_app_data);
        roots.push(normalize_path_text(
            local.join("Microsoft\\Edge\\User Data\\Default\\Cache"),
        ));
        roots.push(normalize_path_text(
            local.join("Microsoft\\Edge\\User Data\\Default\\Code Cache"),
        ));
        roots.push(normalize_path_text(
            local.join("Google\\Chrome\\User Data\\Default\\Cache"),
        ));
        roots.push(normalize_path_text(
            local.join("Google\\Chrome\\User Data\\Default\\Code Cache"),
        ));
        roots.push(normalize_path_text(local.join("D3DSCache")));
        roots.push(normalize_path_text(
            local.join("Microsoft\\Windows\\Explorer"),
        ));
        roots.push(normalize_path_text(local.join(
            "Packages\\Microsoft.WindowsStore_8wekyb3d8bbwe\\LocalCache",
        )));
        roots.push(normalize_path_text(
            local.join("Packages\\Microsoft.WindowsStore_8wekyb3d8bbwe\\AC\\Temp"),
        ));
        roots.push(normalize_path_text(local.join("NVIDIA\\DXCache")));
        roots.push(normalize_path_text(local.join("NVIDIA\\GLCache")));
        roots.push(normalize_path_text(local.join("AMD\\DxCache")));
        roots.push(normalize_path_text(local.join("AMD\\GLCache")));
        roots.push(normalize_path_text(local.join("AMD\\VkCache")));
        roots.push(normalize_path_text(
            local.join("EpicGamesLauncher\\Saved\\webcache"),
        ));
        roots.push(normalize_path_text(
            local.join("EpicGamesLauncher\\Saved\\webcache_4147"),
        ));
        roots.push(normalize_path_text(
            local.join("EpicGamesLauncher\\Saved\\webcache_4430"),
        ));
        roots.push(normalize_path_text(local.join("Battle.net\\Cache")));
        roots.push(normalize_path_text(local.join("Discord\\Cache")));
        roots.push(normalize_path_text(local.join("Discord\\Code Cache")));
        roots.push(normalize_path_text(local.join("Discord\\GPUCache")));
    }
    if let Ok(app_data) = std::env::var("APPDATA") {
        let roaming = Path::new(&app_data);
        roots.push(normalize_path_text(roaming.join("obs-studio\\cache")));
    }
    for key in ["PROGRAMFILES(X86)", "PROGRAMFILES"] {
        if let Ok(program_files) = std::env::var(key) {
            let steam = Path::new(&program_files).join("Steam");
            roots.push(normalize_path_text(steam.join("steamapps\\downloading")));
            roots.push(normalize_path_text(steam.join("steamapps\\temp")));
            roots.push(normalize_path_text(steam.join("appcache\\httpcache")));
            roots.push(normalize_path_text(steam.join("depotcache")));
        }
    }
    roots
        .into_iter()
        .filter(|root| !root.is_empty() && !has_protected_user_location(root))
        .collect()
}

fn has_protected_user_location(path: &str) -> bool {
    path.contains("\\downloads\\")
        || path.ends_with("\\downloads")
        || path.contains("\\documents\\")
        || path.ends_with("\\documents")
        || path.contains("\\desktop\\")
        || path.ends_with("\\desktop")
        || path.contains("\\pictures\\")
        || path.ends_with("\\pictures")
        || path.contains("\\images\\")
        || path.ends_with("\\images")
        || path.contains("\\videos\\")
        || path.ends_with("\\videos")
}

fn is_old_enough_for_item(item_id: &str, path: &Path) -> bool {
    let min_age = match item_id {
        "logs" => MIN_OLD_LOG_AGE_SECONDS,
        "windows-update-cache" => MIN_WINDOWS_UPDATE_CACHE_AGE_SECONDS,
        "steam-download-cache" => MIN_STEAM_DOWNLOAD_CACHE_AGE_SECONDS,
        _ => MIN_ENTRY_AGE_SECONDS,
    };

    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    let Ok(modified) = metadata.modified() else {
        return false;
    };
    modified
        .elapsed()
        .map(|age| age.as_secs() >= min_age)
        .unwrap_or(false)
}

fn is_allowed_log_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "log" | "etl" | "old" | "bak" | "tmp" | "txt"
            )
        })
        .unwrap_or(false)
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(true)
}

fn should_skip_move_error(kind: ErrorKind) -> bool {
    matches!(
        kind,
        ErrorKind::PermissionDenied
            | ErrorKind::NotFound
            | ErrorKind::WouldBlock
            | ErrorKind::Interrupted
    )
}

fn entry_size(path: &Path) -> u64 {
    let Ok(metadata) = fs::metadata(path) else {
        return 0;
    };
    if metadata.is_file() {
        return metadata.len();
    }
    if !metadata.is_dir() {
        return 0;
    }

    let Ok(read_dir) = fs::read_dir(path) else {
        return 0;
    };
    read_dir
        .filter_map(Result::ok)
        .map(|entry| entry_size(&entry.path()))
        .sum()
}

fn path_text(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().to_string()
}

fn normalize_path_text(path: impl AsRef<Path>) -> String {
    path.as_ref()
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn sanitize_id(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
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
        .map_err(|err| format!("Nao foi possivel iniciar PowerShell para limpeza: {err}"))?;
    let started_at = SystemTime::now();

    loop {
        if child
            .try_wait()
            .map_err(|err| format!("Falha ao aguardar PowerShell: {err}"))?
            .is_some()
        {
            break;
        }

        let elapsed = SystemTime::now()
            .duration_since(started_at)
            .unwrap_or_default()
            .as_secs();
        if elapsed >= POWERSHELL_TIMEOUT_SECONDS {
            let _ = child.kill();
            return Err("Tempo limite atingido ao escanear limpeza.".to_string());
        }

        thread::sleep(Duration::from_millis(80));
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("Nao foi possivel ler saida do PowerShell: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "PowerShell retornou erro no scan de limpeza: {stderr}"
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        Err("PowerShell nao retornou dados do scan de limpeza.".to_string())
    } else {
        Ok(stdout)
    }
}

fn bytes_to_gb(value: f64) -> f32 {
    (value / 1024.0 / 1024.0 / 1024.0) as f32
}

fn round1(value: f32) -> f32 {
    (value * 10.0).round() / 10.0
}

fn value_or(value: Option<String>, fallback: &str) -> String {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn now_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    seconds.to_string()
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_engine_supports_gamer_cache_items() {
        for id in [
            "store-cache",
            "nvidia-shader-cache",
            "amd-shader-cache",
            "steam-download-cache",
            "epic-launcher-cache",
            "battle-net-cache",
            "discord-cache",
            "obs-cache",
        ] {
            assert!(is_supported_clean_item(id), "{id} should be supported");
        }
    }

    #[test]
    fn clean_engine_keeps_user_locations_protected() {
        assert!(has_protected_user_location(
            "c:\\users\\player\\downloads\\setup.exe"
        ));
        assert!(has_protected_user_location(
            "c:\\users\\player\\desktop\\clip.mp4"
        ));
        assert!(!has_protected_user_location(
            "c:\\users\\player\\appdata\\local\\discord\\cache"
        ));
    }

    #[test]
    fn clean_engine_marks_summary_items_as_scan_only() {
        let item = build_item(RawCleanScanItem {
            id: Some("storage-summary".to_string()),
            label: Some("Storage summary".to_string()),
            description: Some("Resumo somente leitura".to_string()),
            estimated_bytes: Some(0.0),
            paths: Some(Vec::new()),
        });

        assert!(!item.selected_by_default);
        assert!(!item.safe_to_clean_later);
    }
}

const POWERSHELL_CLEAN_SCAN_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-HermesFolderSizeBytes($paths) {
  $total = 0
  foreach ($path in @($paths)) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { continue }
    try {
      $size = (Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
      if ($null -ne $size) { $total += [double]$size }
    } catch {}
  }
  return [double]$total
}

function Get-HermesLogSizeBytes($paths) {
  $total = 0
  foreach ($path in @($paths)) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { continue }
    try {
      $size = (
        Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue |
        Where-Object {
          $_.LastWriteTime -lt (Get-Date).AddDays(-1) -and
          $_.Extension -in @('.log', '.etl', '.old', '.bak', '.tmp', '.txt')
        } |
        Measure-Object -Property Length -Sum
      ).Sum
      if ($null -ne $size) { $total += [double]$size }
    } catch {}
  }
  return [double]$total
}

$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$roamingAppData = [Environment]::GetFolderPath('ApplicationData')
$windowsDir = $env:WINDIR

$tempPaths = @($env:TEMP, (Join-Path $windowsDir 'Temp')) | Where-Object { $_ } | Sort-Object -Unique
$cachePaths = @(
  (Join-Path $localAppData 'Microsoft\Edge\User Data\Default\Cache'),
  (Join-Path $localAppData 'Microsoft\Edge\User Data\Default\Code Cache'),
  (Join-Path $localAppData 'Google\Chrome\User Data\Default\Cache'),
  (Join-Path $localAppData 'Google\Chrome\User Data\Default\Code Cache'),
  (Join-Path $localAppData 'D3DSCache')
) | Where-Object { $_ } | Sort-Object -Unique
$logPaths = @(
  (Join-Path $windowsDir 'Logs'),
  (Join-Path $windowsDir 'Temp')
) | Where-Object { $_ } | Sort-Object -Unique
$thumbnailPaths = @((Join-Path $localAppData 'Microsoft\Windows\Explorer')) | Where-Object { $_ } | Sort-Object -Unique
$windowsUpdatePaths = @((Join-Path $windowsDir 'SoftwareDistribution\Download')) | Where-Object { $_ } | Sort-Object -Unique
$storeCachePaths = @(
  (Join-Path $localAppData 'Packages\Microsoft.WindowsStore_8wekyb3d8bbwe\LocalCache'),
  (Join-Path $localAppData 'Packages\Microsoft.WindowsStore_8wekyb3d8bbwe\AC\Temp')
) | Where-Object { $_ } | Sort-Object -Unique
$nvidiaShaderCachePaths = @(
  (Join-Path $localAppData 'NVIDIA\DXCache'),
  (Join-Path $localAppData 'NVIDIA\GLCache')
) | Where-Object { $_ } | Sort-Object -Unique
$amdShaderCachePaths = @(
  (Join-Path $localAppData 'AMD\DxCache'),
  (Join-Path $localAppData 'AMD\GLCache'),
  (Join-Path $localAppData 'AMD\VkCache')
) | Where-Object { $_ } | Sort-Object -Unique
$epicLauncherCachePaths = @(
  (Join-Path $localAppData 'EpicGamesLauncher\Saved\webcache'),
  (Join-Path $localAppData 'EpicGamesLauncher\Saved\webcache_4147'),
  (Join-Path $localAppData 'EpicGamesLauncher\Saved\webcache_4430')
) | Where-Object { $_ } | Sort-Object -Unique
$battleNetCachePaths = @((Join-Path $localAppData 'Battle.net\Cache')) | Where-Object { $_ } | Sort-Object -Unique
$discordCachePaths = @(
  (Join-Path $localAppData 'Discord\Cache'),
  (Join-Path $localAppData 'Discord\Code Cache'),
  (Join-Path $localAppData 'Discord\GPUCache')
) | Where-Object { $_ } | Sort-Object -Unique
$obsCachePaths = @((Join-Path $roamingAppData 'obs-studio\cache')) | Where-Object { $_ } | Sort-Object -Unique
$steamRoots = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Steam'),
  (Join-Path $env:ProgramFiles 'Steam')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Sort-Object -Unique
$steamDownloadCachePaths = @()
foreach ($steamRoot in @($steamRoots)) {
  $steamDownloadCachePaths += @(
    (Join-Path $steamRoot 'steamapps\downloading'),
    (Join-Path $steamRoot 'steamapps\temp'),
    (Join-Path $steamRoot 'appcache\httpcache'),
    (Join-Path $steamRoot 'depotcache')
  )
}
$steamDownloadCachePaths = @($steamDownloadCachePaths) | Where-Object { $_ } | Sort-Object -Unique

$thumbnailBytes = 0
foreach ($path in @($thumbnailPaths)) {
  if (Test-Path -LiteralPath $path) {
    try {
      $size = (Get-ChildItem -LiteralPath $path -Force -File -Filter 'thumbcache_*.db' -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
      if ($null -ne $size) { $thumbnailBytes += [double]$size }
    } catch {}
  }
}

[pscustomobject]@{
  items = @(
    [pscustomobject]@{
      id = 'temp'
      label = 'TEMP'
      description = 'Arquivos temporarios do usuario e Windows'
      estimatedBytes = (Get-HermesFolderSizeBytes $tempPaths)
      paths = @($tempPaths)
    }
    [pscustomobject]@{
      id = 'cache'
      label = 'Cache'
      description = 'Caches seguros de apps e navegadores'
      estimatedBytes = (Get-HermesFolderSizeBytes $cachePaths)
      paths = @($cachePaths)
    }
    [pscustomobject]@{
      id = 'logs'
      label = 'Logs'
      description = 'Logs antigos do sistema'
      estimatedBytes = (Get-HermesLogSizeBytes $logPaths)
      paths = @($logPaths)
    }
    [pscustomobject]@{
      id = 'thumbnails'
      label = 'Miniaturas'
      description = 'Cache de miniaturas do Explorer'
      estimatedBytes = $thumbnailBytes
      paths = @($thumbnailPaths)
    }
    [pscustomobject]@{
      id = 'windows-update-cache'
      label = 'Windows Update Cache'
      description = 'Pacotes baixados pelo Windows Update'
      estimatedBytes = (Get-HermesFolderSizeBytes $windowsUpdatePaths)
      paths = @($windowsUpdatePaths)
    }
    [pscustomobject]@{
      id = 'store-cache'
      label = 'Store cache'
      description = 'Cache seguro da Microsoft Store'
      estimatedBytes = (Get-HermesFolderSizeBytes $storeCachePaths)
      paths = @($storeCachePaths)
    }
    [pscustomobject]@{
      id = 'nvidia-shader-cache'
      label = 'NVIDIA shader cache'
      description = 'Cache de shaders NVIDIA que pode ser recriado pelo driver'
      estimatedBytes = (Get-HermesFolderSizeBytes $nvidiaShaderCachePaths)
      paths = @($nvidiaShaderCachePaths)
    }
    [pscustomobject]@{
      id = 'amd-shader-cache'
      label = 'AMD shader cache'
      description = 'Cache de shaders AMD que pode ser recriado pelo driver'
      estimatedBytes = (Get-HermesFolderSizeBytes $amdShaderCachePaths)
      paths = @($amdShaderCachePaths)
    }
    [pscustomobject]@{
      id = 'steam-download-cache'
      label = 'Steam download cache'
      description = 'Downloads temporarios, temp, depotcache e httpcache da Steam; nao toca jogos instalados'
      estimatedBytes = (Get-HermesFolderSizeBytes $steamDownloadCachePaths)
      paths = @($steamDownloadCachePaths)
    }
    [pscustomobject]@{
      id = 'epic-launcher-cache'
      label = 'Epic launcher cache'
      description = 'Cache web seguro do Epic Games Launcher'
      estimatedBytes = (Get-HermesFolderSizeBytes $epicLauncherCachePaths)
      paths = @($epicLauncherCachePaths)
    }
    [pscustomobject]@{
      id = 'battle-net-cache'
      label = 'Battle.net cache'
      description = 'Cache seguro do Battle.net'
      estimatedBytes = (Get-HermesFolderSizeBytes $battleNetCachePaths)
      paths = @($battleNetCachePaths)
    }
    [pscustomobject]@{
      id = 'discord-cache'
      label = 'Discord cache'
      description = 'Cache, code cache e GPU cache do Discord'
      estimatedBytes = (Get-HermesFolderSizeBytes $discordCachePaths)
      paths = @($discordCachePaths)
    }
    [pscustomobject]@{
      id = 'obs-cache'
      label = 'OBS cache'
      description = 'Cache local do OBS Studio'
      estimatedBytes = (Get-HermesFolderSizeBytes $obsCachePaths)
      paths = @($obsCachePaths)
    }
    [pscustomobject]@{
      id = 'log-rotation'
      label = 'Log rotation'
      description = 'Rotacao interna dos historicos do NEX; mantem apenas eventos recentes'
      estimatedBytes = 0
      paths = @()
    }
    [pscustomobject]@{
      id = 'storage-summary'
      label = 'Storage summary'
      description = 'Resumo local somente leitura para recomendacoes de armazenamento'
      estimatedBytes = 0
      paths = @()
    }
  )
} | ConvertTo-Json -Depth 5 -Compress
"#;
