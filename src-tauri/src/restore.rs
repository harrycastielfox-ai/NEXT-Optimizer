use crate::safe_mode;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MAX_RESTORE_SNAPSHOTS: usize = 10;
const MAX_RESTORE_EVENTS: usize = 100;
const RESTORE_COMMAND_TIMEOUT_SECONDS: u64 = 10;
const USB_SETTINGS_SUBGROUP_GUID: &str = "2a737441-1930-4402-8d77-b2bebba308a3";
const USB_SELECTIVE_SUSPEND_SETTING_GUID: &str = "48e6b7a6-50f5-4782-a5d4-53bb8f07e226";
const PCI_EXPRESS_SUBGROUP_GUID: &str = "501a4d13-42af-4429-9fd1-a8218c268e20";
const PCIE_LINK_STATE_POWER_MANAGEMENT_SETTING_GUID: &str = "ee12f906-d277-404b-b6da-e5fa1a576df5";
const DISPLAY_SETTINGS_SUBGROUP_GUID: &str = "7516b95f-f776-4464-8c53-06167f40cc99";
const DISPLAY_IDLE_TIMEOUT_SETTING_GUID: &str = "3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSnapshot {
    pub id: String,
    pub timestamp: String,
    pub name: String,
    pub description: String,
    pub planned_actions: Vec<RestorePlannedAction>,
    pub reversal_plan: RestoreReversalPlan,
    pub rollback_manifest: Vec<RestoreRollbackAction>,
    pub previous_state: Vec<RestorePreviousState>,
    pub logs_before: Vec<RestoreLogEntry>,
    pub logs_after: Vec<RestoreLogEntry>,
    pub status: RestoreSnapshotStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePlannedAction {
    pub id: String,
    pub engine: String,
    pub title: String,
    pub description: String,
    pub risk: RestoreRiskLevel,
    pub will_modify_system: bool,
    pub requires_admin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReversalPlan {
    pub summary: String,
    pub dry_run_supported: bool,
    pub destructive_operations: bool,
    pub action_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreRollbackAction {
    pub id: String,
    pub action_type: RestoreRollbackActionType,
    pub target: String,
    pub description: String,
    pub previous_value: Option<String>,
    pub backup_path: Option<String>,
    pub command_preview: Option<String>,
    pub status: RestoreRollbackActionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreviousState {
    pub key: String,
    pub category: RestorePreviousStateCategory,
    pub value: String,
    pub source: String,
    pub captured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreLogEntry {
    pub timestamp: String,
    pub level: RestoreLogLevel,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSnapshotList {
    pub generated_at: String,
    pub engine_version: String,
    pub max_snapshots: usize,
    pub total_snapshots: usize,
    pub snapshots: Vec<RestoreSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreEventList {
    pub generated_at: String,
    pub engine_version: String,
    pub max_events: usize,
    pub total_events: usize,
    pub events: Vec<RestoreEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreEngineStatus {
    pub generated_at: String,
    pub engine_version: String,
    pub max_snapshots: usize,
    pub max_events: usize,
    pub total_snapshots: usize,
    pub total_events: usize,
    pub latest_snapshot_id: Option<String>,
    pub snapshots_with_rollback: usize,
    pub snapshots_without_rollback: usize,
    pub unsupported_rollback_actions: usize,
    pub failed_snapshots: usize,
    pub retention_policy: String,
    pub storage: String,
    pub ready_for_real_actions: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreValidationResult {
    pub snapshot_id: String,
    pub timestamp: String,
    pub valid: bool,
    pub fully_reversible: bool,
    pub dry_run_supported: bool,
    pub rollback_action_count: usize,
    pub supported_action_count: usize,
    pub unsupported_action_count: usize,
    pub failed_action_count: usize,
    pub message: String,
    pub warnings: Vec<String>,
    pub action_results: Vec<RestoreActionResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreApplyResult {
    pub snapshot_id: String,
    pub timestamp: String,
    pub dry_run: bool,
    pub applied: bool,
    pub status: RestoreSnapshotStatus,
    pub message: String,
    pub action_results: Vec<RestoreActionResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreActionResult {
    pub action_id: String,
    pub status: RestoreActionResultStatus,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreCreateSnapshotRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub planned_actions: Option<Vec<RestorePlannedAction>>,
    pub rollback_manifest: Option<Vec<RestoreRollbackAction>>,
    pub previous_state: Option<Vec<RestorePreviousState>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreRiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreRollbackActionType {
    Noop,
    RestoreRegistryValue,
    RestorePowerPlan,
    RestorePowerSetting,
    RestoreStartupEntry,
    RestoreVisualEffects,
    RestoreGameMode,
    RemoveDefenderExclusion,
    RestoreFileBackup,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreRollbackActionStatus {
    Pending,
    Applied,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestorePreviousStateCategory {
    Registry,
    PowerPlan,
    Startup,
    VisualEffects,
    GameMode,
    File,
    Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreLogLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreSnapshotStatus {
    Created,
    DryRun,
    Validated,
    Applied,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreActionResultStatus {
    DryRun,
    Applied,
    Skipped,
    Unsupported,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RestoreSnapshotHistory {
    snapshots: Vec<RestoreSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreEvent {
    id: String,
    timestamp: String,
    snapshot_id: Option<String>,
    level: RestoreLogLevel,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RestoreEventHistory {
    events: Vec<RestoreEvent>,
}

#[tauri::command]
pub fn restore_create_snapshot(
    app: AppHandle,
    request: Option<RestoreCreateSnapshotRequest>,
) -> Result<RestoreSnapshot, String> {
    let request = request.unwrap_or_default();
    validate_renderer_snapshot(&request)?;
    create_snapshot(app, Some(request))
}

fn validate_renderer_snapshot(request: &RestoreCreateSnapshotRequest) -> Result<(), String> {
    if request.rollback_manifest.as_ref().is_some_and(|manifest| !manifest.is_empty()) {
        return Err("Manifestos de restauracao executaveis so podem ser capturados pelos motores nativos. A interface pode salvar apenas registros informativos.".into());
    }
    Ok(())
}

// Engines capture the real previous state themselves. Keeping this separate
// from IPC prevents an unlicensed renderer forging a rollback as a new write.
pub(crate) fn create_snapshot(
    app: AppHandle,
    request: Option<RestoreCreateSnapshotRequest>,
) -> Result<RestoreSnapshot, String> {
    let request = request.unwrap_or_default();
    let paths = restore_paths(&app)?;
    let mut history = read_snapshot_history(&paths.snapshots);
    let timestamp = now_timestamp();
    let planned_actions = request.planned_actions.unwrap_or_default();
    let rollback_manifest = request.rollback_manifest.unwrap_or_default();
    let previous_state = request.previous_state.unwrap_or_default();
    let snapshot_id = format!("restore-{}-{}", timestamp, now_nanos());

    let snapshot = RestoreSnapshot {
        id: snapshot_id.clone(),
        timestamp: timestamp.clone(),
        name: text_or(request.name, "Snapshot de seguranca NEX".to_string()),
        description: text_or(
            request.description,
            "Snapshot estrutural local criado antes de otimizacoes reais.".to_string(),
        ),
        reversal_plan: RestoreReversalPlan {
            summary: reversal_summary(&rollback_manifest),
            dry_run_supported: true,
            destructive_operations: false,
            action_count: rollback_manifest.len(),
        },
        planned_actions,
        rollback_manifest,
        previous_state,
        logs_before: vec![log_entry(
            RestoreLogLevel::Info,
            "Snapshot criado localmente. Nenhuma alteracao no Windows foi executada.",
        )],
        logs_after: Vec::new(),
        status: RestoreSnapshotStatus::Created,
    };

    history.snapshots.insert(0, snapshot.clone());
    history.snapshots.truncate(MAX_RESTORE_SNAPSHOTS);
    write_snapshot_history(&paths.snapshots, &history)?;
    append_event(
        &paths.events,
        RestoreLogLevel::Info,
        Some(snapshot_id),
        "Snapshot criado e salvo no historico local.",
    )?;

    Ok(snapshot)
}

#[tauri::command]
pub fn restore_list_snapshots(app: AppHandle) -> Result<RestoreSnapshotList, String> {
    let paths = restore_paths(&app)?;
    let history = read_snapshot_history(&paths.snapshots);

    Ok(RestoreSnapshotList {
        generated_at: now_timestamp(),
        engine_version: "restore-engine-basic-v1".to_string(),
        max_snapshots: MAX_RESTORE_SNAPSHOTS,
        total_snapshots: history.snapshots.len(),
        snapshots: history.snapshots,
    })
}

#[tauri::command]
pub fn restore_engine_status(app: AppHandle) -> Result<RestoreEngineStatus, String> {
    let paths = restore_paths(&app)?;
    let snapshot_history = read_snapshot_history(&paths.snapshots);
    let event_history = read_event_history(&paths.events);

    let unsupported_rollback_actions = snapshot_history
        .snapshots
        .iter()
        .flat_map(|snapshot| snapshot.rollback_manifest.iter())
        .filter(|action| !is_rollback_action_supported(action))
        .count();
    let snapshots_with_rollback = snapshot_history
        .snapshots
        .iter()
        .filter(|snapshot| !snapshot.rollback_manifest.is_empty())
        .count();
    let failed_snapshots = snapshot_history
        .snapshots
        .iter()
        .filter(|snapshot| matches!(snapshot.status, RestoreSnapshotStatus::Failed))
        .count();
    let mut warnings = Vec::new();

    if snapshot_history.snapshots.is_empty() {
        warnings.push("Nenhum snapshot local encontrado ainda.".to_string());
    }
    if unsupported_rollback_actions > 0 {
        warnings.push(format!(
            "{} acao(oes) de rollback ainda nao possuem executor seguro.",
            unsupported_rollback_actions
        ));
    }
    if failed_snapshots > 0 {
        warnings.push(format!(
            "{} snapshot(s) possuem status de falha e exigem revisao.",
            failed_snapshots
        ));
    }

    Ok(RestoreEngineStatus {
        generated_at: now_timestamp(),
        engine_version: "restore-engine-status-v1".to_string(),
        max_snapshots: MAX_RESTORE_SNAPSHOTS,
        max_events: MAX_RESTORE_EVENTS,
        total_snapshots: snapshot_history.snapshots.len(),
        total_events: event_history.events.len(),
        latest_snapshot_id: snapshot_history
            .snapshots
            .first()
            .map(|snapshot| snapshot.id.clone()),
        snapshots_with_rollback,
        snapshots_without_rollback: snapshot_history
            .snapshots
            .len()
            .saturating_sub(snapshots_with_rollback),
        unsupported_rollback_actions,
        failed_snapshots,
        retention_policy: format!(
            "Mantem ate {} snapshots e {} eventos locais.",
            MAX_RESTORE_SNAPSHOTS, MAX_RESTORE_EVENTS
        ),
        storage: "AppData local do NEX, pasta history.".to_string(),
        ready_for_real_actions: unsupported_rollback_actions == 0 && failed_snapshots == 0,
        warnings,
    })
}

#[tauri::command]
pub fn restore_list_events(app: AppHandle) -> Result<RestoreEventList, String> {
    let paths = restore_paths(&app)?;
    let history = read_event_history(&paths.events);

    Ok(RestoreEventList {
        generated_at: now_timestamp(),
        engine_version: "restore-engine-events-v1".to_string(),
        max_events: MAX_RESTORE_EVENTS,
        total_events: history.events.len(),
        events: history.events,
    })
}

#[tauri::command]
pub fn restore_validate_snapshot(
    app: AppHandle,
    snapshot_id: String,
) -> Result<RestoreValidationResult, String> {
    let paths = restore_paths(&app)?;
    let history = read_snapshot_history(&paths.snapshots);
    let Some(snapshot) = history
        .snapshots
        .iter()
        .find(|snapshot| snapshot.id == snapshot_id)
    else {
        append_event(
            &paths.events,
            RestoreLogLevel::Error,
            Some(snapshot_id.clone()),
            "Falha de validacao: snapshot nao encontrado.",
        )?;
        return Err(format!("Snapshot nao encontrado: {snapshot_id}"));
    };

    let action_results = validate_rollback_manifest(&snapshot.rollback_manifest);
    let unsupported_action_count = action_results
        .iter()
        .filter(|result| matches!(result.status, RestoreActionResultStatus::Unsupported))
        .count();
    let failed_action_count = action_results
        .iter()
        .filter(|result| matches!(result.status, RestoreActionResultStatus::Failed))
        .count();
    let supported_action_count = action_results
        .iter()
        .filter(|result| matches!(result.status, RestoreActionResultStatus::DryRun))
        .count();
    let fully_reversible = !snapshot.rollback_manifest.is_empty()
        && unsupported_action_count == 0
        && failed_action_count == 0;
    let valid = failed_action_count == 0;
    let mut warnings = Vec::new();

    if snapshot.rollback_manifest.is_empty() {
        warnings.push("Snapshot nao possui acoes reversiveis registradas.".to_string());
    }
    if unsupported_action_count > 0 {
        warnings.push(format!(
            "{} acao(oes) ainda nao possuem executor seguro de rollback.",
            unsupported_action_count
        ));
    }
    if failed_action_count > 0 {
        warnings.push(format!(
            "{} acao(oes) falharam na validacao estrutural.",
            failed_action_count
        ));
    }

    append_event(
        &paths.events,
        RestoreLogLevel::Info,
        Some(snapshot_id.clone()),
        "Snapshot validado estruturalmente em modo seguro. Nenhum rollback real foi executado.",
    )?;

    Ok(RestoreValidationResult {
        snapshot_id,
        timestamp: now_timestamp(),
        valid,
        fully_reversible,
        dry_run_supported: true,
        rollback_action_count: snapshot.rollback_manifest.len(),
        supported_action_count,
        unsupported_action_count,
        failed_action_count,
        message: validation_message(
            snapshot.rollback_manifest.len(),
            supported_action_count,
            unsupported_action_count,
            failed_action_count,
        ),
        warnings,
        action_results,
    })
}

pub fn restore_replace_snapshot_manifest(
    app: AppHandle,
    snapshot_id: &str,
    rollback_manifest: Vec<RestoreRollbackAction>,
    previous_state: Vec<RestorePreviousState>,
    message: &str,
) -> Result<(), String> {
    let paths = restore_paths(&app)?;
    let mut history = read_snapshot_history(&paths.snapshots);
    let Some(index) = history
        .snapshots
        .iter()
        .position(|snapshot| snapshot.id == snapshot_id)
    else {
        return Err(format!(
            "Snapshot nao encontrado para atualizar: {snapshot_id}"
        ));
    };

    history.snapshots[index].rollback_manifest = rollback_manifest;
    history.snapshots[index].previous_state = previous_state;
    history.snapshots[index].reversal_plan.summary =
        reversal_summary(&history.snapshots[index].rollback_manifest);
    history.snapshots[index].reversal_plan.action_count =
        history.snapshots[index].rollback_manifest.len();
    history.snapshots[index]
        .logs_after
        .push(log_entry(RestoreLogLevel::Info, message));

    write_snapshot_history(&paths.snapshots, &history)?;
    append_event(
        &paths.events,
        RestoreLogLevel::Info,
        Some(snapshot_id.to_string()),
        message,
    )
}

#[tauri::command]
pub fn restore_apply_snapshot(
    app: AppHandle,
    snapshot_id: String,
    dry_run: Option<bool>,
) -> Result<RestoreApplyResult, String> {
    let dry_run = safe_mode::force_dry_run(dry_run.unwrap_or(true));
    let paths = restore_paths(&app)?;
    let mut history = read_snapshot_history(&paths.snapshots);
    let Some(index) = history
        .snapshots
        .iter()
        .position(|snapshot| snapshot.id == snapshot_id)
    else {
        append_event(
            &paths.events,
            RestoreLogLevel::Error,
            Some(snapshot_id.clone()),
            "Falha de restauracao: snapshot nao encontrado.",
        )?;
        return Err(format!("Snapshot nao encontrado: {snapshot_id}"));
    };

    let mut snapshot = history.snapshots[index].clone();
    snapshot.logs_after.push(log_entry(
        RestoreLogLevel::Info,
        if dry_run {
            "DRY-RUN | Restore dry-run iniciado. Nenhuma alteracao sera executada."
        } else {
            "Restore iniciado. Acoes seguras do manifesto serao revertidas quando suportadas."
        },
    ));

    let action_results = build_action_results(&snapshot.rollback_manifest, dry_run);
    let unsupported_count = action_results
        .iter()
        .filter(|result| matches!(result.status, RestoreActionResultStatus::Unsupported))
        .count();
    let applied_count = action_results
        .iter()
        .filter(|result| matches!(result.status, RestoreActionResultStatus::Applied))
        .count();
    let failed_count = action_results
        .iter()
        .filter(|result| matches!(result.status, RestoreActionResultStatus::Failed))
        .count();

    let status = if dry_run {
        RestoreSnapshotStatus::DryRun
    } else if failed_count > 0 {
        RestoreSnapshotStatus::Failed
    } else if unsupported_count > 0 {
        RestoreSnapshotStatus::Validated
    } else {
        RestoreSnapshotStatus::Applied
    };
    let message = restore_message(dry_run, applied_count, unsupported_count, failed_count);

    snapshot.status = status.clone();
    snapshot
        .logs_after
        .push(log_entry(RestoreLogLevel::Info, message.clone()));

    history.snapshots[index] = snapshot;
    write_snapshot_history(&paths.snapshots, &history)?;
    append_event(
        &paths.events,
        RestoreLogLevel::Info,
        Some(snapshot_id.clone()),
        if dry_run {
            "DRY-RUN | Snapshot validado em dry-run."
        } else {
            "Snapshot aplicado com rollback seguro."
        },
    )?;

    Ok(RestoreApplyResult {
        snapshot_id,
        timestamp: now_timestamp(),
        dry_run,
        applied: !dry_run && unsupported_count == 0 && failed_count == 0,
        status,
        message,
        action_results,
    })
}

impl Default for RestoreCreateSnapshotRequest {
    fn default() -> Self {
        Self {
            name: None,
            description: None,
            planned_actions: None,
            rollback_manifest: None,
            previous_state: None,
        }
    }
}

fn build_action_results(
    rollback_manifest: &[RestoreRollbackAction],
    dry_run: bool,
) -> Vec<RestoreActionResult> {
    if rollback_manifest.is_empty() {
        return vec![RestoreActionResult {
            action_id: "no-actions".to_string(),
            status: if dry_run {
                RestoreActionResultStatus::DryRun
            } else {
                RestoreActionResultStatus::Applied
            },
            message: "Nenhuma acao reversivel registrada. Nada foi alterado.".to_string(),
        }];
    }

    rollback_manifest
        .iter()
        .map(|action| {
            if dry_run {
                return validate_rollback_action(action);
            }

            match &action.action_type {
                RestoreRollbackActionType::Noop => RestoreActionResult {
                    action_id: action.id.clone(),
                    status: RestoreActionResultStatus::Applied,
                    message: "Acao no-op concluida sem alterar o sistema.".to_string(),
                },
                RestoreRollbackActionType::RestorePowerPlan => restore_power_plan_action(action),
                RestoreRollbackActionType::RestorePowerSetting => {
                    restore_power_setting_action(action)
                }
                RestoreRollbackActionType::RestoreRegistryValue => {
                    restore_registry_value_action(action)
                }
                RestoreRollbackActionType::RestoreStartupEntry => {
                    restore_startup_entry_action(action)
                }
                RestoreRollbackActionType::RestoreVisualEffects => {
                    restore_visual_effects_action(action)
                }
                RestoreRollbackActionType::RestoreGameMode => restore_game_mode_action(action),
                RestoreRollbackActionType::RemoveDefenderExclusion => {
                    restore_defender_exclusion_action(action)
                }
                RestoreRollbackActionType::RestoreFileBackup => restore_file_backup_action(action),
                RestoreRollbackActionType::Custom => restore_custom_action(action),
            }
        })
        .collect()
}

fn validate_rollback_manifest(
    rollback_manifest: &[RestoreRollbackAction],
) -> Vec<RestoreActionResult> {
    if rollback_manifest.is_empty() {
        return vec![RestoreActionResult {
            action_id: "no-actions".to_string(),
            status: RestoreActionResultStatus::DryRun,
            message: "Snapshot estrutural valido, mas sem acoes reversiveis registradas."
                .to_string(),
        }];
    }

    rollback_manifest
        .iter()
        .map(validate_rollback_action)
        .collect()
}

fn validate_rollback_action(action: &RestoreRollbackAction) -> RestoreActionResult {
    match &action.action_type {
        RestoreRollbackActionType::Noop => RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::DryRun,
            message: "No-op validado. Nenhuma acao real sera necessaria no rollback.".to_string(),
        },
        RestoreRollbackActionType::RestorePowerPlan => {
            if is_guid_like(&action.target) {
                RestoreActionResult {
                    action_id: action.id.clone(),
                    status: RestoreActionResultStatus::DryRun,
                    message: "Plano de energia possui GUID valido para rollback.".to_string(),
                }
            } else {
                RestoreActionResult {
                    action_id: action.id.clone(),
                    status: RestoreActionResultStatus::Failed,
                    message: "GUID do plano de energia invalido.".to_string(),
                }
            }
        }
        RestoreRollbackActionType::RestorePowerSetting => validate_power_setting_action(action),
        RestoreRollbackActionType::RestoreRegistryValue => validate_scoped_registry_value_action(
            action,
            "Registro",
            is_allowed_registry_path,
            &["dword", "string"],
        ),
        RestoreRollbackActionType::RestoreStartupEntry => validate_scoped_registry_value_action(
            action,
            "Inicializacao",
            is_allowed_startup_registry_path,
            &["string"],
        ),
        RestoreRollbackActionType::RestoreVisualEffects => validate_scoped_registry_value_action(
            action,
            "Efeitos visuais",
            is_allowed_visual_effects_registry_path,
            &["dword", "string"],
        ),
        RestoreRollbackActionType::RestoreGameMode => validate_scoped_registry_value_action(
            action,
            "Game Mode",
            is_allowed_game_mode_registry_path,
            &["dword", "string"],
        ),
        RestoreRollbackActionType::RemoveDefenderExclusion => {
            validate_defender_exclusion_action(action)
        }
        RestoreRollbackActionType::RestoreFileBackup => validate_file_backup_action(action),
        RestoreRollbackActionType::Custom => {
            if action.command_preview.as_deref() != Some("Start-Process") {
                return RestoreActionResult {
                    action_id: action.id.clone(),
                    status: RestoreActionResultStatus::Unsupported,
                    message: "Rollback customizado nao reconhecido pelo NEX.".to_string(),
                };
            }

            if is_allowed_executable_path(&action.target) {
                RestoreActionResult {
                    action_id: action.id.clone(),
                    status: RestoreActionResultStatus::DryRun,
                    message: "Rollback customizado validado para reabrir app permitido."
                        .to_string(),
                }
            } else {
                RestoreActionResult {
                    action_id: action.id.clone(),
                    status: RestoreActionResultStatus::Failed,
                    message: "Executavel fora da allowlist de apps de usuario.".to_string(),
                }
            }
        }
    }
}

fn validate_scoped_registry_value_action(
    action: &RestoreRollbackAction,
    scope: &str,
    is_allowed_path: fn(&str) -> bool,
    allowed_value_kinds: &[&str],
) -> RestoreActionResult {
    let Some((path, name, value_kind)) = parse_registry_target(&action.target) else {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: format!("{scope}: alvo de Registro invalido."),
        };
    };

    if !is_allowed_path(&path) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: format!("{scope}: caminho de Registro fora da allowlist NEX."),
        };
    }

    if scope == "Efeitos visuais" && !is_allowed_visual_effects_registry_target(&path, &name) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: format!("{scope}: valor de Registro fora da allowlist NEX."),
        };
    }

    if !is_allowed_registry_value_kind(&value_kind, allowed_value_kinds) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Unsupported,
            message: format!("{scope}: tipo de Registro nao suportado pelo executor seguro."),
        };
    }

    let previous_value = action
        .previous_value
        .as_deref()
        .unwrap_or("__HERMES_MISSING__");
    if value_kind.eq_ignore_ascii_case("dword")
        && previous_value != "__HERMES_MISSING__"
        && previous_value.parse::<i64>().is_err()
    {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: format!("{scope}: valor DWORD anterior invalido."),
        };
    }

    RestoreActionResult {
        action_id: action.id.clone(),
        status: RestoreActionResultStatus::DryRun,
        message: format!("{scope}: rollback validado dentro da allowlist NEX."),
    }
}

fn is_rollback_action_supported(action: &RestoreRollbackAction) -> bool {
    matches!(
        validate_rollback_action(action).status,
        RestoreActionResultStatus::DryRun
    )
}

fn restore_power_plan_action(action: &RestoreRollbackAction) -> RestoreActionResult {
    if !is_guid_like(&action.target) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Rollback bloqueado: GUID do plano de energia invalido.".to_string(),
        };
    }

    match run_native_command("powercfg", &["/S", &action.target]) {
        Ok(_) => RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Applied,
            message: "Plano de energia anterior restaurado com powercfg.".to_string(),
        },
        Err(error) => RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: format!("Falha ao restaurar plano de energia: {error}"),
        },
    }
}

fn restore_power_setting_action(action: &RestoreRollbackAction) -> RestoreActionResult {
    let validation = validate_power_setting_action(action);
    if !matches!(validation.status, RestoreActionResultStatus::DryRun) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: validation.status,
            message: validation.message,
        };
    }

    let Some((subgroup_guid, setting_guid)) = parse_power_setting_target(&action.target) else {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Rollback bloqueado: alvo powercfg invalido.".to_string(),
        };
    };
    let Some((ac_value, dc_value)) =
        parse_power_setting_previous_value(action.previous_value.as_deref())
    else {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Rollback bloqueado: valores anteriores de energia invalidos.".to_string(),
        };
    };

    let ac_args = [
        "/SETACVALUEINDEX",
        "SCHEME_CURRENT",
        subgroup_guid.as_str(),
        setting_guid.as_str(),
        ac_value.as_str(),
    ];
    let dc_args = [
        "/SETDCVALUEINDEX",
        "SCHEME_CURRENT",
        subgroup_guid.as_str(),
        setting_guid.as_str(),
        dc_value.as_str(),
    ];

    let result = run_native_command("powercfg", &ac_args)
        .and_then(|_| run_native_command("powercfg", &dc_args))
        .and_then(|_| run_native_command("powercfg", &["/S", "SCHEME_CURRENT"]));

    match result {
        Ok(_) => RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Applied,
            message: "Configuracao anterior de energia restaurada com powercfg.".to_string(),
        },
        Err(error) => RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: format!("Falha ao restaurar configuracao de energia: {error}"),
        },
    }
}

fn validate_power_setting_action(action: &RestoreRollbackAction) -> RestoreActionResult {
    let Some((subgroup_guid, setting_guid)) = parse_power_setting_target(&action.target) else {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Powercfg: alvo de configuracao invalido.".to_string(),
        };
    };

    if !is_allowed_power_setting_target(&subgroup_guid, &setting_guid) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Powercfg: configuracao fora da allowlist NEX.".to_string(),
        };
    }

    if parse_power_setting_previous_value(action.previous_value.as_deref()).is_none() {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Powercfg: valores anteriores AC/DC invalidos.".to_string(),
        };
    }

    RestoreActionResult {
        action_id: action.id.clone(),
        status: RestoreActionResultStatus::DryRun,
        message: "Powercfg: rollback AC/DC validado dentro da allowlist NEX.".to_string(),
    }
}

fn restore_registry_value_action(action: &RestoreRollbackAction) -> RestoreActionResult {
    restore_scoped_registry_value_action(
        action,
        "Registro",
        is_allowed_registry_path,
        &["dword", "string"],
    )
}

fn restore_startup_entry_action(action: &RestoreRollbackAction) -> RestoreActionResult {
    restore_scoped_registry_value_action(
        action,
        "Inicializacao",
        is_allowed_startup_registry_path,
        &["string"],
    )
}

fn restore_visual_effects_action(action: &RestoreRollbackAction) -> RestoreActionResult {
    restore_scoped_registry_value_action(
        action,
        "Efeitos visuais",
        is_allowed_visual_effects_registry_path,
        &["dword", "string"],
    )
}

fn restore_game_mode_action(action: &RestoreRollbackAction) -> RestoreActionResult {
    restore_scoped_registry_value_action(
        action,
        "Game Mode",
        is_allowed_game_mode_registry_path,
        &["dword", "string"],
    )
}

fn restore_defender_exclusion_action(action: &RestoreRollbackAction) -> RestoreActionResult {
    let validation = validate_defender_exclusion_action(action);
    if !matches!(validation.status, RestoreActionResultStatus::DryRun) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: validation.status,
            message: validation.message,
        };
    }

    let target_arg = ps_escape(&action.target);
    let script = format!(
        "$ErrorActionPreference = 'Stop'; $path = '{target_arg}'; $prefs = Get-MpPreference; if (@($prefs.ExclusionPath) -contains $path) {{ Remove-MpPreference -ExclusionPath $path; 'removed' }} else {{ 'not-present' }}"
    );

    match run_powershell(&script) {
        Ok(_) => RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Applied,
            message: "Exclusao do NEX removida do Windows Defender.".to_string(),
        },
        Err(error) => RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: format!("Falha ao remover exclusao do Defender: {error}"),
        },
    }
}

fn validate_defender_exclusion_action(action: &RestoreRollbackAction) -> RestoreActionResult {
    if action.command_preview.as_deref() != Some("Remove-MpPreference -ExclusionPath") {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Unsupported,
            message: "Rollback do Defender nao reconhecido pelo NEX.".to_string(),
        };
    }

    if is_allowed_defender_exclusion_path(&action.target) {
        RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::DryRun,
            message: "Exclusão específica do NEX validada para rollback.".to_string(),
        }
    } else {
        RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Rollback bloqueado: exclusão do Defender fora do executável NEX.".to_string(),
        }
    }
}

fn restore_scoped_registry_value_action(
    action: &RestoreRollbackAction,
    scope: &str,
    is_allowed_path: fn(&str) -> bool,
    allowed_value_kinds: &[&str],
) -> RestoreActionResult {
    let Some((path, name, value_kind)) = parse_registry_target(&action.target) else {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Rollback bloqueado: alvo de Registro invalido.".to_string(),
        };
    };

    if !is_allowed_path(&path) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: format!(
                "Rollback bloqueado: caminho de Registro fora da allowlist NEX para {scope}."
            ),
        };
    }

    if scope == "Efeitos visuais" && !is_allowed_visual_effects_registry_target(&path, &name) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: format!(
                "Rollback bloqueado: valor de Registro fora da allowlist NEX para {scope}."
            ),
        };
    }

    if !is_allowed_registry_value_kind(&value_kind, allowed_value_kinds) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Unsupported,
            message: format!("Rollback bloqueado: tipo de Registro nao suportado para {scope}."),
        };
    }

    let previous_value = action
        .previous_value
        .as_deref()
        .unwrap_or("__HERMES_MISSING__");
    let path_arg = ps_escape(&path);
    let name_arg = ps_escape(&name);
    let script = if previous_value == "__HERMES_MISSING__" {
        format!(
            "$ErrorActionPreference = 'Stop'; if (Test-Path '{path_arg}') {{ Remove-ItemProperty -Path '{path_arg}' -Name '{name_arg}' -ErrorAction SilentlyContinue }}; 'ok'"
        )
    } else if value_kind.eq_ignore_ascii_case("dword") {
        let Ok(value) = previous_value.parse::<i64>() else {
            return RestoreActionResult {
                action_id: action.id.clone(),
                status: RestoreActionResultStatus::Failed,
                message: "Rollback bloqueado: valor DWORD anterior invalido.".to_string(),
            };
        };
        format!(
            "$ErrorActionPreference = 'Stop'; New-Item -Path '{path_arg}' -Force | Out-Null; New-ItemProperty -Path '{path_arg}' -Name '{name_arg}' -Value {value} -PropertyType DWord -Force | Out-Null; 'ok'"
        )
    } else if value_kind.eq_ignore_ascii_case("string") {
        let value_arg = ps_escape(previous_value);
        format!(
            "$ErrorActionPreference = 'Stop'; New-Item -Path '{path_arg}' -Force | Out-Null; New-ItemProperty -Path '{path_arg}' -Name '{name_arg}' -Value '{value_arg}' -PropertyType String -Force | Out-Null; 'ok'"
        )
    } else {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Rollback bloqueado: tipo de Registro nao suportado.".to_string(),
        };
    };

    match run_powershell(&script) {
        Ok(_) => RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Applied,
            message: scoped_registry_success_message(scope, previous_value),
        },
        Err(error) => RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: format!("Falha ao restaurar {scope}: {error}"),
        },
    }
}

fn restore_file_backup_action(action: &RestoreRollbackAction) -> RestoreActionResult {
    let Some(backup_path) = action.backup_path.as_deref() else {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Rollback de arquivo bloqueado: backup nao informado.".to_string(),
        };
    };

    let validation = validate_file_backup_action(action);
    if !matches!(validation.status, RestoreActionResultStatus::DryRun) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: validation.status,
            message: validation.message,
        };
    }

    let backup = PathBuf::from(backup_path);
    let target = PathBuf::from(&action.target);
    if !backup.exists() {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Backup de limpeza nao encontrado na quarentena.".to_string(),
        };
    }
    if target.exists() {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Skipped,
            message: "Destino original ja existe. Rollback pulado para evitar sobrescrita."
                .to_string(),
        };
    }

    if let Some(parent) = target.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return RestoreActionResult {
                action_id: action.id.clone(),
                status: RestoreActionResultStatus::Failed,
                message: format!("Falha ao preparar pasta original: {error}"),
            };
        }
    }

    match fs::rename(&backup, &target) {
        Ok(_) => RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Applied,
            message: "Item restaurado da quarentena para o local original.".to_string(),
        },
        Err(error) => RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: format!("Falha ao restaurar item da quarentena: {error}"),
        },
    }
}

fn restore_custom_action(action: &RestoreRollbackAction) -> RestoreActionResult {
    if action.command_preview.as_deref() != Some("Start-Process") {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Unsupported,
            message: "Rollback customizado nao reconhecido pelo NEX.".to_string(),
        };
    }

    if !is_allowed_executable_path(&action.target) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Rollback bloqueado: executavel fora da allowlist de apps de usuario."
                .to_string(),
        };
    }

    let file_arg = ps_escape(&action.target);
    let script = format!(
        "$ErrorActionPreference = 'Stop'; if (!(Test-Path '{file_arg}')) {{ throw 'Executavel nao encontrado' }}; Start-Process -FilePath '{file_arg}'; 'ok'"
    );

    match run_powershell(&script) {
        Ok(_) => RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Applied,
            message: "Aplicativo reaberto pelo plano de rollback.".to_string(),
        },
        Err(error) => RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: format!("Falha ao reabrir aplicativo: {error}"),
        },
    }
}

fn validate_file_backup_action(action: &RestoreRollbackAction) -> RestoreActionResult {
    let Some(backup_path) = action.backup_path.as_deref() else {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Backup de arquivo nao informado.".to_string(),
        };
    };

    if !is_allowed_clean_restore_target(&action.target) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Destino de arquivo fora da allowlist de limpeza segura.".to_string(),
        };
    }

    if !is_allowed_clean_backup_path(backup_path) {
        return RestoreActionResult {
            action_id: action.id.clone(),
            status: RestoreActionResultStatus::Failed,
            message: "Backup de arquivo fora da quarentena NEX.".to_string(),
        };
    }

    RestoreActionResult {
        action_id: action.id.clone(),
        status: RestoreActionResultStatus::DryRun,
        message: "Rollback de arquivo validado para quarentena NEX.".to_string(),
    }
}

fn is_allowed_defender_exclusion_path(path: &str) -> bool {
    let normalized = path.trim().replace('/', "\\").to_ascii_lowercase();
    let bytes = normalized.as_bytes();
    let allowed_suffix = normalized.ends_with("\\next optimizer.exe")
        || normalized.ends_with("\\next-optimizer.exe")
        || normalized.ends_with("\\nex optimizer.exe")
        || normalized.ends_with("\\nex-optimizer.exe")
        || normalized.ends_with("\\hermes-optimizer.exe");
    allowed_suffix && bytes.get(1) == Some(&b':') && bytes.get(2) == Some(&b'\\')
}

fn restore_message(
    dry_run: bool,
    applied_count: usize,
    unsupported_count: usize,
    failed_count: usize,
) -> String {
    if dry_run {
        "Restore dry-run concluido. Nenhuma alteracao foi executada.".to_string()
    } else if failed_count > 0 {
        format!("Restore encontrou {failed_count} falha(s). Consulte os resultados do manifesto.")
    } else if unsupported_count > 0 {
        format!("Restore validado com {unsupported_count} acao(oes) futuras ainda nao executaveis.")
    } else {
        format!("Restore estrutural concluido com {applied_count} acao(oes) segura(s).")
    }
}

fn validation_message(
    total_count: usize,
    supported_count: usize,
    unsupported_count: usize,
    failed_count: usize,
) -> String {
    if total_count == 0 {
        "Snapshot estrutural validado, mas ainda nao possui acoes reversiveis.".to_string()
    } else if failed_count > 0 {
        format!(
            "Validacao encontrou {} falha(s) estrutural(is). Nenhum rollback real foi executado.",
            failed_count
        )
    } else if unsupported_count > 0 {
        format!(
            "{} de {} acao(oes) ainda nao possuem executor seguro. Nenhum rollback real foi executado.",
            unsupported_count, total_count
        )
    } else {
        format!(
            "{} acao(oes) reversivel(is) validada(s) em dry-run estrutural.",
            supported_count
        )
    }
}

fn reversal_summary(rollback_manifest: &[RestoreRollbackAction]) -> String {
    if rollback_manifest.is_empty() {
        "Nenhuma acao reversivel registrada ainda. Snapshot pronto para receber rollback futuro."
            .to_string()
    } else {
        format!(
            "{} acao(oes) reversivel(is) registrada(s) no manifesto local.",
            rollback_manifest.len()
        )
    }
}

struct RestorePaths {
    snapshots: PathBuf,
    events: PathBuf,
}

fn restore_paths(app: &AppHandle) -> Result<RestorePaths, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Nao foi possivel localizar AppData: {err}"))?;
    dir.push("history");
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Nao foi possivel criar historico local: {err}"))?;

    let mut snapshots = dir.clone();
    snapshots.push("restore_snapshots.json");
    let mut events = dir;
    events.push("restore_events.json");

    Ok(RestorePaths { snapshots, events })
}

fn read_snapshot_history(path: &PathBuf) -> RestoreSnapshotHistory {
    let Ok(contents) = fs::read_to_string(path) else {
        return RestoreSnapshotHistory::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_snapshot_history(path: &PathBuf, history: &RestoreSnapshotHistory) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(history)
        .map_err(|err| format!("Nao foi possivel serializar snapshots: {err}"))?;
    fs::write(path, contents).map_err(|err| format!("Nao foi possivel gravar snapshots: {err}"))
}

fn append_event(
    path: &PathBuf,
    level: RestoreLogLevel,
    snapshot_id: Option<String>,
    message: &str,
) -> Result<(), String> {
    let mut history = read_event_history(path);
    history.events.insert(
        0,
        RestoreEvent {
            id: format!("restore-event-{}-{}", now_timestamp(), now_nanos()),
            timestamp: now_timestamp(),
            snapshot_id,
            level,
            message: message.to_string(),
        },
    );
    history.events.truncate(MAX_RESTORE_EVENTS);
    write_event_history(path, &history)
}

fn read_event_history(path: &PathBuf) -> RestoreEventHistory {
    let Ok(contents) = fs::read_to_string(path) else {
        return RestoreEventHistory::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_event_history(path: &PathBuf, history: &RestoreEventHistory) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(history)
        .map_err(|err| format!("Nao foi possivel serializar logs de restore: {err}"))?;
    fs::write(path, contents)
        .map_err(|err| format!("Nao foi possivel gravar logs de restore: {err}"))
}

fn parse_registry_target(target: &str) -> Option<(String, String, String)> {
    let mut parts = target.split('|');
    let path = parts.next()?.trim();
    let name = parts.next()?.trim();
    let value_kind = parts.next()?.trim();
    if parts.next().is_some() || path.is_empty() || name.is_empty() || value_kind.is_empty() {
        return None;
    }

    Some((path.to_string(), name.to_string(), value_kind.to_string()))
}

fn parse_power_setting_target(target: &str) -> Option<(String, String)> {
    let mut parts = target.split('|');
    let subgroup_guid = parts.next()?.trim();
    let setting_guid = parts.next()?.trim();
    if parts.next().is_some() || !is_guid_like(subgroup_guid) || !is_guid_like(setting_guid) {
        return None;
    }

    Some((subgroup_guid.to_string(), setting_guid.to_string()))
}

fn parse_power_setting_previous_value(value: Option<&str>) -> Option<(String, String)> {
    let mut parts = value?.split('|');
    let ac_value = parts.next()?.trim().strip_prefix("AC=")?.trim();
    let dc_value = parts.next()?.trim().strip_prefix("DC=")?.trim();
    if parts.next().is_some() {
        return None;
    }

    let ac_value = ac_value.parse::<u32>().ok()?;
    let dc_value = dc_value.parse::<u32>().ok()?;
    Some((ac_value.to_string(), dc_value.to_string()))
}

fn is_allowed_power_setting_target(subgroup_guid: &str, setting_guid: &str) -> bool {
    matches!(
        (
            subgroup_guid.to_ascii_lowercase().as_str(),
            setting_guid.to_ascii_lowercase().as_str()
        ),
        (
            USB_SETTINGS_SUBGROUP_GUID,
            USB_SELECTIVE_SUSPEND_SETTING_GUID
        ) | (
            PCI_EXPRESS_SUBGROUP_GUID,
            PCIE_LINK_STATE_POWER_MANAGEMENT_SETTING_GUID
        ) | (
            DISPLAY_SETTINGS_SUBGROUP_GUID,
            DISPLAY_IDLE_TIMEOUT_SETTING_GUID
        )
    )
}

fn is_allowed_registry_path(path: &str) -> bool {
    let normalized = path.replace('/', "\\").to_ascii_lowercase();
    normalized.starts_with("hkcu:\\software\\microsoft\\")
        || normalized.starts_with("hkcu:\\software\\policies\\microsoft\\")
        || normalized.starts_with("hkcu:\\system\\gameconfigstore\\")
        || normalized.starts_with("hkcu:\\control panel\\")
        || normalized.starts_with("hklm:\\system\\currentcontrolset\\control\\power\\")
        || normalized
            == "hklm:\\software\\microsoft\\windows nt\\currentversion\\multimedia\\systemprofile"
        || normalized
            == "hklm:\\software\\microsoft\\windows nt\\currentversion\\multimedia\\systemprofile\\tasks\\games"
        || normalized
            == "hklm:\\software\\microsoft\\windows nt\\currentversion\\image file execution options\\fatetrigger.exe\\perfoptions"
        || normalized
            == "hklm:\\software\\microsoft\\windows nt\\currentversion\\image file execution options\\fatetrigger-win64-shipping.exe\\perfoptions"
}

fn is_allowed_startup_registry_path(path: &str) -> bool {
    let normalized = path.replace('/', "\\").to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "hkcu:\\software\\microsoft\\windows\\currentversion\\run"
            | "hkcu:\\software\\microsoft\\windows\\currentversion\\runonce"
            | "hkcu:\\software\\wow6432node\\microsoft\\windows\\currentversion\\run"
            | "hkcu:\\software\\wow6432node\\microsoft\\windows\\currentversion\\runonce"
            | "hklm:\\software\\microsoft\\windows\\currentversion\\run"
            | "hklm:\\software\\microsoft\\windows\\currentversion\\runonce"
            | "hklm:\\software\\wow6432node\\microsoft\\windows\\currentversion\\run"
            | "hklm:\\software\\wow6432node\\microsoft\\windows\\currentversion\\runonce"
    )
}

fn is_allowed_visual_effects_registry_path(path: &str) -> bool {
    let normalized = path.replace('/', "\\").to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "hkcu:\\software\\microsoft\\windows\\currentversion\\themes\\personalize"
            | "hkcu:\\control panel\\desktop"
            | "hkcu:\\control panel\\desktop\\windowmetrics"
            | "hkcu:\\software\\microsoft\\windows\\currentversion\\explorer\\advanced"
            | "hkcu:\\software\\microsoft\\windows\\currentversion\\explorer\\visualeffects"
    )
}

fn is_allowed_visual_effects_registry_target(path: &str, name: &str) -> bool {
    let normalized = path.replace('/', "\\").to_ascii_lowercase();
    let normalized_name = name.to_ascii_lowercase();
    matches!(
        (normalized.as_str(), normalized_name.as_str()),
        (
            "hkcu:\\software\\microsoft\\windows\\currentversion\\themes\\personalize",
            "enabletransparency"
        ) | ("hkcu:\\control panel\\desktop", "dragfullwindows")
            | ("hkcu:\\control panel\\desktop\\windowmetrics", "minanimate")
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\explorer\\advanced",
                "taskbaranimations"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\explorer\\advanced",
                "listviewalphaselect"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\explorer\\advanced",
                "listviewshadow"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\explorer\\visualeffects",
                "visualfxsetting"
            )
    )
}

fn is_allowed_game_mode_registry_path(path: &str) -> bool {
    let normalized = path.replace('/', "\\").to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "hkcu:\\software\\microsoft\\gamebar"
            | "hkcu:\\system\\gameconfigstore"
            | "hkcu:\\software\\microsoft\\windows\\currentversion\\gamedvr"
    )
}

fn is_allowed_registry_value_kind(value_kind: &str, allowed_value_kinds: &[&str]) -> bool {
    allowed_value_kinds
        .iter()
        .any(|allowed| value_kind.eq_ignore_ascii_case(allowed))
}

fn scoped_registry_success_message(scope: &str, previous_value: &str) -> String {
    if previous_value == "__HERMES_MISSING__" {
        return match scope {
            "Inicializacao" => "Inicializacao restaurada: valor criado pelo NEX foi removido da chave permitida. Nenhum programa foi apagado.".to_string(),
            "Efeitos visuais" => "Efeitos visuais restaurados: valor ausente anteriormente foi removido da chave permitida.".to_string(),
            "Game Mode" => "Game Mode restaurado: valor ausente anteriormente foi removido da chave permitida.".to_string(),
            _ => "Valor de Registro ausente anteriormente foi removido da chave permitida.".to_string(),
        };
    }

    match scope {
        "Inicializacao" => {
            "Inicializacao restaurada com PowerShell. Nenhum programa foi removido.".to_string()
        }
        "Efeitos visuais" => "Efeitos visuais anteriores restaurados com PowerShell.".to_string(),
        "Game Mode" => "Configuracao anterior do Game Mode restaurada com PowerShell.".to_string(),
        _ => "Valor de Registro anterior restaurado com PowerShell.".to_string(),
    }
}

fn is_allowed_executable_path(path: &str) -> bool {
    let normalized = path.replace('/', "\\").to_ascii_lowercase();
    normalized.ends_with(".exe")
        && (normalized.starts_with("c:\\program files\\")
            || normalized.starts_with("c:\\program files (x86)\\")
            || (normalized.starts_with("c:\\users\\")
                && (normalized.contains("\\appdata\\local\\")
                    || normalized.contains("\\appdata\\roaming\\"))))
}

fn is_allowed_clean_backup_path(path: &str) -> bool {
    let normalized = normalize_path_text(path);
    normalized.contains("\\history\\clean_quarantine\\")
}

fn is_allowed_clean_restore_target(path: &str) -> bool {
    let normalized = normalize_path_text(path);
    if normalized.is_empty() || has_protected_user_location(&normalized) {
        return false;
    }

    allowed_clean_roots()
        .into_iter()
        .any(|root| normalized.starts_with(&root))
}

fn allowed_clean_roots() -> Vec<String> {
    let mut roots = Vec::new();

    if let Ok(temp) = std::env::var("TEMP") {
        roots.push(normalize_path_text(&temp));
    }
    if let Ok(windir) = std::env::var("WINDIR") {
        roots.push(normalize_path_text(Path::new(&windir).join("Temp")));
        roots.push(normalize_path_text(Path::new(&windir).join("Logs")));
        roots.push(normalize_path_text(
            Path::new(&windir).join("SoftwareDistribution\\Download"),
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
        // Keep this list identical to clean.rs's allowed_clean_roots(): anything the Clean
        // Engine can quarantine must also be restorable here, or "rollback disponivel" is
        // silently false for that category.
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

fn normalize_path_text(path: impl AsRef<Path>) -> String {
    path.as_ref()
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn is_guid_like(value: &str) -> bool {
    value.len() == 36
        && value
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
}

fn run_native_command(program: &str, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new(program);
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
        .map_err(|err| format!("Nao foi possivel iniciar {program}: {err}"))?;
    wait_for_process(&mut child)?;
    command_output(child, program)
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
        .map_err(|err| format!("Nao foi possivel iniciar PowerShell de restore: {err}"))?;
    wait_for_process(&mut child)?;
    command_output(child, "PowerShell")
}

fn wait_for_process(child: &mut std::process::Child) -> Result<(), String> {
    let started_at = SystemTime::now();

    loop {
        if child
            .try_wait()
            .map_err(|err| format!("Falha ao aguardar processo de restore: {err}"))?
            .is_some()
        {
            return Ok(());
        }

        let elapsed = SystemTime::now()
            .duration_since(started_at)
            .unwrap_or_default()
            .as_secs();
        if elapsed >= RESTORE_COMMAND_TIMEOUT_SECONDS {
            let _ = child.kill();
            return Err("Tempo limite atingido ao executar rollback.".to_string());
        }

        thread::sleep(Duration::from_millis(80));
    }
}

fn command_output(child: std::process::Child, label: &str) -> Result<String, String> {
    let output = child
        .wait_with_output()
        .map_err(|err| format!("Nao foi possivel ler saida de {label}: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("{label} retornou erro sem detalhes.")
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn ps_escape(value: &str) -> String {
    value.replace('\'', "''")
}

fn log_entry(level: RestoreLogLevel, message: impl Into<String>) -> RestoreLogEntry {
    RestoreLogEntry {
        timestamp: now_timestamp(),
        level,
        message: message.into(),
    }
}

fn text_or(value: Option<String>, fallback: String) -> String {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or(fallback)
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
    fn renderer_cannot_supply_executable_rollback_manifest() {
        let request = RestoreCreateSnapshotRequest {
            rollback_manifest: Some(vec![RestoreRollbackAction {
                id: "forged".into(),
                action_type: RestoreRollbackActionType::RestorePowerPlan,
                target: "power-plan".into(),
                description: "Forged renderer input".into(),
                previous_value: Some("scheme_min".into()),
                backup_path: None,
                command_preview: None,
                status: RestoreRollbackActionStatus::Pending,
            }]),
            ..RestoreCreateSnapshotRequest::default()
        };
        assert!(validate_renderer_snapshot(&request).is_err());
        assert!(validate_renderer_snapshot(&RestoreCreateSnapshotRequest::default()).is_ok());
    }

    #[test]
    fn restores_clean_quarantine_file_backup_in_real_mode() {
        let root = std::env::temp_dir().join(format!("hermes-restore-test-{}", now_nanos()));
        let quarantine_dir = root.join("history").join("clean_quarantine").join("temp");
        let backup = quarantine_dir.join("sample.tmp");
        let target = root.join("restore-target").join("sample.tmp");
        fs::create_dir_all(&quarantine_dir).expect("create quarantine test dir");
        fs::write(&backup, "hermes rollback payload").expect("write quarantine backup");

        let action = RestoreRollbackAction {
            id: "rollback-clean-file".to_string(),
            action_type: RestoreRollbackActionType::RestoreFileBackup,
            target: target.to_string_lossy().to_string(),
            description: "Restaurar arquivo da quarentena NEX.".to_string(),
            previous_value: None,
            backup_path: Some(backup.to_string_lossy().to_string()),
            command_preview: Some("Move quarentena NEX para origem permitida".to_string()),
            status: RestoreRollbackActionStatus::Pending,
        };

        let result = restore_file_backup_action(&action);

        assert!(matches!(result.status, RestoreActionResultStatus::Applied));
        assert_eq!(
            fs::read_to_string(&target).expect("restored file contents"),
            "hermes rollback payload"
        );
        assert!(!backup.exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validates_visual_fx_setting_rollback_in_isolation() {
        let action = RestoreRollbackAction {
            id: "rollback-visual-fx-setting".to_string(),
            action_type: RestoreRollbackActionType::RestoreVisualEffects,
            target: "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects|VisualFXSetting|DWord".to_string(),
            description: "Restaurar VisualFXSetting no Registro para o estado anterior.".to_string(),
            previous_value: Some("1".to_string()),
            backup_path: None,
            command_preview: Some("PowerShell New-ItemProperty -PropertyType DWord".to_string()),
            status: RestoreRollbackActionStatus::Pending,
        };

        let result = validate_rollback_action(&action);

        assert!(matches!(result.status, RestoreActionResultStatus::DryRun));
        assert!(result.message.contains("Efeitos visuais"));
    }

    #[test]
    fn blocks_windows_theme_values_in_visual_effects_rollback() {
        for value_name in ["AppsUseLightTheme", "SystemUsesLightTheme"] {
            let action = RestoreRollbackAction {
                id: format!("rollback-{value_name}"),
                action_type: RestoreRollbackActionType::RestoreVisualEffects,
                target: format!(
                    "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize|{value_name}|DWord"
                ),
                description: "Tema do Windows nao deve ser restaurado automaticamente.".to_string(),
                previous_value: Some("0".to_string()),
                backup_path: None,
                command_preview: Some("PowerShell New-ItemProperty -PropertyType DWord".to_string()),
                status: RestoreRollbackActionStatus::Pending,
            };

            let result = validate_rollback_action(&action);

            assert!(matches!(result.status, RestoreActionResultStatus::Failed));
            assert!(result.message.contains("fora da allowlist"));
        }
    }

    #[test]
    fn validates_display_timeout_power_setting_rollback() {
        let action = RestoreRollbackAction {
            id: "rollback-display-timeout".to_string(),
            action_type: RestoreRollbackActionType::RestorePowerSetting,
            target: format!("{DISPLAY_SETTINGS_SUBGROUP_GUID}|{DISPLAY_IDLE_TIMEOUT_SETTING_GUID}"),
            description: "Restaurar tempo anterior da tela.".to_string(),
            previous_value: Some("AC=600|DC=180".to_string()),
            backup_path: None,
            command_preview: Some("powercfg /SETACVALUEINDEX + /SETDCVALUEINDEX".to_string()),
            status: RestoreRollbackActionStatus::Pending,
        };

        let result = validate_rollback_action(&action);

        assert!(matches!(result.status, RestoreActionResultStatus::DryRun));
        assert!(result.message.contains("rollback AC/DC validado"));
    }

    #[test]
    fn blocks_unknown_power_setting_rollback() {
        let action = RestoreRollbackAction {
            id: "rollback-unknown-power-setting".to_string(),
            action_type: RestoreRollbackActionType::RestorePowerSetting,
            target: format!(
                "{DISPLAY_SETTINGS_SUBGROUP_GUID}|00000000-0000-0000-0000-000000000000"
            ),
            description: "Nao deve executar powercfg desconhecido.".to_string(),
            previous_value: Some("AC=600|DC=180".to_string()),
            backup_path: None,
            command_preview: Some("powercfg /SETACVALUEINDEX + /SETDCVALUEINDEX".to_string()),
            status: RestoreRollbackActionStatus::Pending,
        };

        let result = validate_rollback_action(&action);

        assert!(matches!(result.status, RestoreActionResultStatus::Failed));
        assert!(result.message.contains("fora da allowlist"));
    }
}
