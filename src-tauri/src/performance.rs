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
    fs,
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const POWERSHELL_TIMEOUT_SECONDS: u64 = 10;
const MAX_PERFORMANCE_EVENTS: usize = 100;
const MISSING_REGISTRY_VALUE: &str = "__HERMES_MISSING__";
const BALANCED_POWER_PLAN_GUID: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";
const POWER_SAVER_POWER_PLAN_GUID: &str = "a1841308-3541-4fab-bc81-f71556f20b4a";
const HIGH_PERFORMANCE_POWER_PLAN_GUID: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
const PERSONALIZE_REGISTRY_PATH: &str =
    "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
const EXPLORER_ADVANCED_REGISTRY_PATH: &str =
    "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";
const WINDOW_METRICS_REGISTRY_PATH: &str = "HKCU:\\Control Panel\\Desktop\\WindowMetrics";
const VISUAL_EFFECTS_REGISTRY_PATH: &str =
    "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceReport {
    pub generated_at: String,
    pub engine_version: String,
    pub read_only: bool,
    pub will_modify_system: bool,
    pub power_plan: PerformancePowerPlan,
    pub game_mode: PerformanceGameMode,
    pub visual_effects: PerformanceVisualEffects,
    pub background_apps: PerformanceBackgroundApps,
    pub settings: Vec<PerformanceSetting>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformancePowerPlan {
    pub active_scheme_name: String,
    pub active_scheme_guid: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceGameMode {
    pub available: bool,
    pub enabled: Option<bool>,
    pub status: String,
    pub game_bar_allowed: Option<bool>,
    pub game_dvr_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceVisualEffects {
    pub profile: String,
    pub transparency_enabled: Option<bool>,
    pub animations_enabled: Option<bool>,
    pub shadows_enabled: Option<bool>,
    pub full_window_drag_enabled: Option<bool>,
    pub raw_visual_fx_setting: Option<i64>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceBackgroundApps {
    pub enabled: Option<bool>,
    pub status: String,
    pub power_throttling_disabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSetting {
    pub id: String,
    pub label: String,
    pub value: String,
    pub status: PerformanceSettingStatus,
    pub source: String,
    pub can_optimize_later: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PerformanceSettingStatus {
    Enabled,
    Disabled,
    Optimized,
    Balanced,
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceApplyRequest {
    pub confirmed: bool,
    pub dry_run: Option<bool>,
    pub action_ids: Option<Vec<String>>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceApplyResult {
    pub generated_at: String,
    pub engine_version: String,
    pub read_only: bool,
    pub dry_run: bool,
    pub snapshot_id: String,
    pub rollback_available: bool,
    pub applied_actions: Vec<PerformanceApplyActionResult>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceApplyActionResult {
    pub id: String,
    pub title: String,
    pub status: PerformanceApplyActionStatus,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PerformanceApplyActionStatus {
    DryRun,
    Applied,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PerformanceEvent {
    id: String,
    timestamp: String,
    level: PerformanceEventLevel,
    snapshot_id: Option<String>,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum PerformanceEventLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PerformanceEventHistory {
    events: Vec<PerformanceEvent>,
}

#[derive(Debug, Clone)]
struct PerformanceControlledAction {
    id: String,
    title: String,
    description: String,
    risk: RestoreRiskLevel,
    requires_admin: bool,
    operations: Vec<PerformanceOperation>,
}

#[derive(Debug, Clone)]
enum PerformanceOperation {
    RegistryDword {
        path: String,
        name: String,
        value: i64,
        previous_value: Option<String>,
    },
    RegistryString {
        path: String,
        name: String,
        value: String,
        previous_value: Option<String>,
    },
    PowerPlan {
        guid: String,
        previous_guid: Option<String>,
        previous_name: Option<String>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPerformanceReport {
    power_plan_name: Option<String>,
    power_plan_guid: Option<String>,
    auto_game_mode_enabled: Option<bool>,
    allow_auto_game_mode: Option<bool>,
    game_dvr_enabled: Option<bool>,
    enable_transparency: Option<i64>,
    visual_fx_setting: Option<i64>,
    min_animate: Option<String>,
    taskbar_animations: Option<i64>,
    listview_shadow: Option<i64>,
    listview_alpha_select: Option<i64>,
    drag_full_windows: Option<String>,
    background_apps_global_disabled: Option<i64>,
    power_throttling_off: Option<i64>,
}

#[tauri::command]
pub async fn performance_engine_read() -> PerformanceReport {
    tauri::async_runtime::spawn_blocking(collect_performance_report)
        .await
        .unwrap_or_else(|err| {
            let mut report = fallback_report();
            report
                .warnings
                .push(format!("Falha ao ler performance em segundo plano: {err}"));
            report
        })
}

#[tauri::command]
pub fn performance_apply_controlled(
    app: AppHandle,
    request: Option<PerformanceApplyRequest>,
) -> Result<PerformanceApplyResult, String> {
    let request = request.unwrap_or_default();
    let dry_run = safe_mode::force_dry_run(request.dry_run.unwrap_or(!request.confirmed));
    if !dry_run && !request.confirmed {
        return Err("Confirmacao obrigatoria antes de aplicar otimizacoes reais.".to_string());
    }
    crate::licensing::require_real_license(dry_run)?;

    let raw = collect_windows_performance()?;
    let selected_ids = selected_action_ids(request.action_ids.as_deref());
    let actions = controlled_actions_from_raw(&raw, &selected_ids);
    if actions.is_empty() {
        return Err("Nenhuma acao segura de performance foi selecionada.".to_string());
    }
    ensure_rollback_ready(&actions)?;

    let snapshot_request = build_performance_snapshot_request(&request, &actions, dry_run);
    let snapshot = restore::create_snapshot(app.clone(), Some(snapshot_request))?;
    append_performance_event(
        &app,
        PerformanceEventLevel::Info,
        Some(snapshot.id.clone()),
        if dry_run {
            "DRY-RUN | Performance Engine 6.2 criou snapshot obrigatorio em dry-run."
        } else {
            "Performance Engine 6.2 criou snapshot obrigatorio antes da aplicacao."
        },
    )?;

    if dry_run {
        let applied_actions = actions
            .iter()
            .map(|action| PerformanceApplyActionResult {
                id: action.id.clone(),
                title: action.title.clone(),
                status: PerformanceApplyActionStatus::DryRun,
                message: format!(
                    "{} — nenhuma alteracao de performance foi aplicada.",
                    safe_mode::mode_prefix(dry_run)
                ),
            })
            .collect::<Vec<_>>();

        return Ok(PerformanceApplyResult {
            generated_at: now_timestamp(),
            engine_version: "performance-engine-apply-v1".to_string(),
            read_only: false,
            dry_run,
            snapshot_id: snapshot.id,
            rollback_available: true,
            applied_actions,
            message: format!(
                "{} — aplicacao controlada validada com snapshot e rollback preparados. {}",
                safe_mode::mode_prefix(dry_run),
                if safe_mode::is_enabled() {
                    safe_mode::notice()
                } else {
                    ""
                }
            ),
        });
    }

    append_performance_event(
        &app,
        PerformanceEventLevel::Info,
        Some(snapshot.id.clone()),
        "Aplicacao controlada iniciada apos confirmacao do usuario.",
    )?;

    let mut applied_actions = Vec::new();
    let mut failed = false;
    for action in &actions {
        let result = apply_controlled_action(action);
        let event_level = if matches!(result.status, PerformanceApplyActionStatus::Failed) {
            PerformanceEventLevel::Error
        } else {
            PerformanceEventLevel::Info
        };
        append_performance_event(
            &app,
            event_level,
            Some(snapshot.id.clone()),
            &format!("{}: {}", action.title, result.message),
        )?;

        failed = failed || matches!(result.status, PerformanceApplyActionStatus::Failed);
        applied_actions.push(result);
        if failed {
            break;
        }
    }

    let message = if failed {
        append_performance_event(
            &app,
            PerformanceEventLevel::Warning,
            Some(snapshot.id.clone()),
            "Falha detectada. Rollback automatico acionado pelo manifesto do snapshot.",
        )?;
        match restore::restore_apply_snapshot(app.clone(), snapshot.id.clone(), Some(false)) {
            Ok(result) if result.applied => {
                append_performance_event(
                    &app,
                    PerformanceEventLevel::Info,
                    Some(snapshot.id.clone()),
                    "Rollback automatico concluido com sucesso.",
                )?;
                "Falha durante a aplicacao. Rollback automatico concluido.".to_string()
            }
            Ok(result) => {
                append_performance_event(
                    &app,
                    PerformanceEventLevel::Error,
                    Some(snapshot.id.clone()),
                    &format!(
                        "Rollback automatico nao concluiu todas as acoes: {}",
                        result.message
                    ),
                )?;
                "Falha durante a aplicacao. Rollback automatico nao concluiu todas as acoes."
                    .to_string()
            }
            Err(error) => {
                append_performance_event(
                    &app,
                    PerformanceEventLevel::Error,
                    Some(snapshot.id.clone()),
                    &format!("Rollback automatico falhou: {error}"),
                )?;
                "Falha durante a aplicacao e rollback automatico falhou. Verifique os logs."
                    .to_string()
            }
        }
    } else {
        append_performance_event(
            &app,
            PerformanceEventLevel::Info,
            Some(snapshot.id.clone()),
            "Aplicacao controlada concluida. Rollback permanece disponivel no snapshot.",
        )?;
        "Aplicacao controlada concluida com snapshot, logs e rollback disponiveis.".to_string()
    };

    Ok(PerformanceApplyResult {
        generated_at: now_timestamp(),
        engine_version: "performance-engine-apply-v1".to_string(),
        read_only: false,
        dry_run,
        snapshot_id: snapshot.id,
        rollback_available: true,
        applied_actions,
        message,
    })
}

pub fn collect_performance_report() -> PerformanceReport {
    match collect_windows_performance() {
        Ok(raw) => build_report(raw, Vec::new()),
        Err(error) => {
            let mut report = fallback_report();
            report.warnings.push(error);
            report
        }
    }
}

fn collect_windows_performance() -> Result<RawPerformanceReport, String> {
    if !cfg!(target_os = "windows") {
        return Err("Performance Engine usa leitura local do Windows.".to_string());
    }

    let stdout = run_powershell(POWERSHELL_PERFORMANCE_SCRIPT)?;
    serde_json::from_str::<RawPerformanceReport>(&stdout)
        .map_err(|err| format!("Nao foi possivel interpretar Performance Engine: {err}"))
}

fn build_report(raw: RawPerformanceReport, warnings: Vec<String>) -> PerformanceReport {
    let power_plan_name = value_or(raw.power_plan_name, "Desconhecido");
    let power_plan = PerformancePowerPlan {
        status: power_plan_status(&power_plan_name).to_string(),
        active_scheme_name: power_plan_name,
        active_scheme_guid: value_or(raw.power_plan_guid, "Nao identificado"),
    };

    let game_mode_enabled = raw.auto_game_mode_enabled.or(raw.allow_auto_game_mode);
    let game_mode = PerformanceGameMode {
        available: game_mode_enabled.is_some()
            || raw.allow_auto_game_mode.is_some()
            || raw.game_dvr_enabled.is_some(),
        enabled: game_mode_enabled,
        status: optional_bool_status(game_mode_enabled),
        game_bar_allowed: raw.allow_auto_game_mode,
        game_dvr_enabled: raw.game_dvr_enabled,
    };

    let transparency_enabled = raw.enable_transparency.map(|value| value != 0);
    let taskbar_animations = raw.taskbar_animations.map(|value| value != 0);
    let min_animate = raw.min_animate.as_deref().map(|value| value == "1");
    let alpha_select = raw.listview_alpha_select.map(|value| value != 0);
    let animations_enabled = combine_any_enabled(&[taskbar_animations, min_animate, alpha_select]);
    let shadows_enabled = raw.listview_shadow.map(|value| value != 0);
    let full_window_drag_enabled = raw.drag_full_windows.as_deref().map(|value| value == "1");
    let visual_profile = visual_profile(raw.visual_fx_setting);
    let visual_effects = PerformanceVisualEffects {
        profile: visual_profile.to_string(),
        transparency_enabled,
        animations_enabled,
        shadows_enabled,
        full_window_drag_enabled,
        raw_visual_fx_setting: raw.visual_fx_setting,
        status: visual_status(visual_profile, animations_enabled, shadows_enabled),
    };

    let background_apps_enabled = raw.background_apps_global_disabled.map(|value| value == 0);
    let background_apps = PerformanceBackgroundApps {
        enabled: background_apps_enabled,
        status: optional_bool_status(background_apps_enabled),
        power_throttling_disabled: raw.power_throttling_off.map(|value| value != 0),
    };

    let settings = settings_from_report(&power_plan, &game_mode, &visual_effects, &background_apps);

    PerformanceReport {
        generated_at: now_timestamp(),
        engine_version: "performance-engine-readonly-v1".to_string(),
        read_only: true,
        will_modify_system: false,
        power_plan,
        game_mode,
        visual_effects,
        background_apps,
        settings,
        warnings,
    }
}

fn settings_from_report(
    power_plan: &PerformancePowerPlan,
    game_mode: &PerformanceGameMode,
    visual_effects: &PerformanceVisualEffects,
    background_apps: &PerformanceBackgroundApps,
) -> Vec<PerformanceSetting> {
    vec![
        setting(
            "power-plan",
            "Plano de energia",
            power_plan.active_scheme_name.clone(),
            if power_plan.status == "Desempenho" {
                PerformanceSettingStatus::Optimized
            } else if power_plan.status == "Equilibrado" {
                PerformanceSettingStatus::Balanced
            } else {
                PerformanceSettingStatus::Unknown
            },
            "powercfg /GETACTIVESCHEME",
            true,
        ),
        setting(
            "game-mode",
            "Game Mode",
            game_mode.status.clone(),
            status_from_option(game_mode.enabled),
            "HKCU GameBar/GameConfigStore",
            true,
        ),
        setting(
            "transparency",
            "Transparencias",
            optional_bool_status(visual_effects.transparency_enabled),
            status_from_option(visual_effects.transparency_enabled),
            "HKCU Themes\\Personalize",
            true,
        ),
        setting(
            "animations",
            "Animacoes",
            optional_bool_status(visual_effects.animations_enabled),
            status_from_option(visual_effects.animations_enabled),
            "HKCU Desktop/Explorer",
            true,
        ),
        setting(
            "shadows",
            "Sombras",
            optional_bool_status(visual_effects.shadows_enabled),
            status_from_option(visual_effects.shadows_enabled),
            "HKCU Explorer\\Advanced",
            true,
        ),
        setting(
            "background-apps",
            "Apps em segundo plano",
            background_apps.status.clone(),
            status_from_option(background_apps.enabled),
            "HKCU BackgroundAccessApplications",
            true,
        ),
    ]
}

fn selected_action_ids(action_ids: Option<&[String]>) -> Vec<String> {
    let ids = action_ids
        .filter(|items| !items.is_empty())
        .map(|items| items.iter().map(|item| item.trim().to_string()).collect())
        .unwrap_or_else(Vec::new);

    ids.into_iter()
        .filter(|id| is_known_controlled_action_id(id))
        .collect()
}

fn is_known_controlled_action_id(id: &str) -> bool {
    matches!(
        id,
        "disable-transparency"
            | "disable-window-animations"
            | "disable-visual-shadows"
            | "set-balanced-power-plan"
            | "set-power-saver-power-plan"
            | "set-high-performance-power-plan"
    )
}

fn controlled_actions_from_raw(
    raw: &RawPerformanceReport,
    selected_ids: &[String],
) -> Vec<PerformanceControlledAction> {
    let mut actions = Vec::new();

    for id in selected_ids {
        match id.as_str() {
            "disable-transparency" => actions.push(PerformanceControlledAction {
                id: id.clone(),
                title: "Desativar transparencias".to_string(),
                description:
                    "Desativa transparencias visuais do Windows para reduzir custo grafico leve."
                        .to_string(),
                risk: RestoreRiskLevel::Low,
                requires_admin: false,
                operations: vec![PerformanceOperation::RegistryDword {
                    path: PERSONALIZE_REGISTRY_PATH.to_string(),
                    name: "EnableTransparency".to_string(),
                    value: 0,
                    previous_value: previous_dword(raw.enable_transparency),
                }],
            }),
            "disable-window-animations" => actions.push(PerformanceControlledAction {
                id: id.clone(),
                title: "Reduzir animacoes visuais".to_string(),
                description:
                    "Desativa animacoes de janela, barra de tarefas e selecao suave do Explorer."
                        .to_string(),
                risk: RestoreRiskLevel::Low,
                requires_admin: false,
                operations: vec![
                    visual_fx_custom_operation(raw),
                    PerformanceOperation::RegistryString {
                        path: WINDOW_METRICS_REGISTRY_PATH.to_string(),
                        name: "MinAnimate".to_string(),
                        value: "0".to_string(),
                        previous_value: previous_string(raw.min_animate.as_deref()),
                    },
                    PerformanceOperation::RegistryDword {
                        path: EXPLORER_ADVANCED_REGISTRY_PATH.to_string(),
                        name: "TaskbarAnimations".to_string(),
                        value: 0,
                        previous_value: previous_dword(raw.taskbar_animations),
                    },
                    PerformanceOperation::RegistryDword {
                        path: EXPLORER_ADVANCED_REGISTRY_PATH.to_string(),
                        name: "ListviewAlphaSelect".to_string(),
                        value: 0,
                        previous_value: previous_dword(raw.listview_alpha_select),
                    },
                ],
            }),
            "disable-visual-shadows" => actions.push(PerformanceControlledAction {
                id: id.clone(),
                title: "Reduzir sombras do Explorer".to_string(),
                description:
                    "Desativa sombras de lista do Explorer mantendo a alteracao reversivel."
                        .to_string(),
                risk: RestoreRiskLevel::Low,
                requires_admin: false,
                operations: vec![
                    visual_fx_custom_operation(raw),
                    PerformanceOperation::RegistryDword {
                        path: EXPLORER_ADVANCED_REGISTRY_PATH.to_string(),
                        name: "ListviewShadow".to_string(),
                        value: 0,
                        previous_value: previous_dword(raw.listview_shadow),
                    },
                ],
            }),
            "set-balanced-power-plan" => actions.push(PerformanceControlledAction {
                id: id.clone(),
                title: "Ativar plano Equilibrado".to_string(),
                description: "Troca o plano de energia para Equilibrado usando powercfg."
                    .to_string(),
                risk: RestoreRiskLevel::Low,
                requires_admin: false,
                operations: vec![PerformanceOperation::PowerPlan {
                    guid: BALANCED_POWER_PLAN_GUID.to_string(),
                    previous_guid: raw.power_plan_guid.clone(),
                    previous_name: raw.power_plan_name.clone(),
                }],
            }),
            "set-power-saver-power-plan" => actions.push(PerformanceControlledAction {
                id: id.clone(),
                title: "Ativar Economia de Energia".to_string(),
                description: "Troca o plano de energia para Economia de Energia usando powercfg."
                    .to_string(),
                risk: RestoreRiskLevel::Low,
                requires_admin: false,
                operations: vec![PerformanceOperation::PowerPlan {
                    guid: POWER_SAVER_POWER_PLAN_GUID.to_string(),
                    previous_guid: raw.power_plan_guid.clone(),
                    previous_name: raw.power_plan_name.clone(),
                }],
            }),
            "set-high-performance-power-plan" => actions.push(PerformanceControlledAction {
                id: id.clone(),
                title: "Ativar Alto Desempenho".to_string(),
                description: "Troca o plano de energia para Alto Desempenho usando powercfg."
                    .to_string(),
                risk: RestoreRiskLevel::Medium,
                requires_admin: false,
                operations: vec![PerformanceOperation::PowerPlan {
                    guid: HIGH_PERFORMANCE_POWER_PLAN_GUID.to_string(),
                    previous_guid: raw.power_plan_guid.clone(),
                    previous_name: raw.power_plan_name.clone(),
                }],
            }),
            _ => {}
        }
    }

    actions
}

fn visual_fx_custom_operation(raw: &RawPerformanceReport) -> PerformanceOperation {
    PerformanceOperation::RegistryDword {
        path: VISUAL_EFFECTS_REGISTRY_PATH.to_string(),
        name: "VisualFXSetting".to_string(),
        value: 3,
        previous_value: previous_dword(raw.visual_fx_setting),
    }
}

fn ensure_rollback_ready(actions: &[PerformanceControlledAction]) -> Result<(), String> {
    for action in actions {
        for operation in &action.operations {
            if let PerformanceOperation::PowerPlan { previous_guid, .. } = operation {
                let Some(guid) = previous_guid else {
                    return Err(format!(
                        "Rollback obrigatorio indisponivel para '{}': plano de energia anterior nao foi capturado.",
                        action.title
                    ));
                };
                if !is_guid_like(guid) {
                    return Err(format!(
                        "Rollback obrigatorio indisponivel para '{}': GUID anterior invalido.",
                        action.title
                    ));
                }
            }
        }
    }

    Ok(())
}

fn build_performance_snapshot_request(
    request: &PerformanceApplyRequest,
    actions: &[PerformanceControlledAction],
    dry_run: bool,
) -> RestoreCreateSnapshotRequest {
    let mode = if dry_run { "dry-run" } else { "aplicacao real" };
    let reason = request
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Performance Engine 6.2");

    RestoreCreateSnapshotRequest {
        name: Some("Performance Engine - Snapshot de seguranca".to_string()),
        description: Some(format!(
            "Snapshot obrigatorio antes da {mode} de ajustes controlados. Motivo: {reason}."
        )),
        planned_actions: Some(actions.iter().map(action_to_planned_action).collect()),
        rollback_manifest: Some(
            actions
                .iter()
                .flat_map(action_to_rollback_actions)
                .collect::<Vec<_>>(),
        ),
        previous_state: Some(
            actions
                .iter()
                .flat_map(action_to_previous_state)
                .collect::<Vec<_>>(),
        ),
    }
}

fn action_to_planned_action(action: &PerformanceControlledAction) -> RestorePlannedAction {
    RestorePlannedAction {
        id: action.id.clone(),
        engine: "Performance Engine".to_string(),
        title: action.title.clone(),
        description: action.description.clone(),
        risk: action.risk.clone(),
        will_modify_system: true,
        requires_admin: action.requires_admin,
    }
}

fn action_to_rollback_actions(action: &PerformanceControlledAction) -> Vec<RestoreRollbackAction> {
    action
        .operations
        .iter()
        .enumerate()
        .filter_map(|(index, operation)| operation_to_rollback_action(action, index, operation))
        .collect()
}

fn operation_to_rollback_action(
    action: &PerformanceControlledAction,
    index: usize,
    operation: &PerformanceOperation,
) -> Option<RestoreRollbackAction> {
    let id = format!("rollback-{}-{}", action.id, index + 1);
    match operation {
        PerformanceOperation::RegistryDword {
            path,
            name,
            previous_value,
            ..
        } => Some(RestoreRollbackAction {
            id,
            action_type: rollback_type_for_registry_value(path),
            target: registry_target(path, name, "DWord"),
            description: format!("Restaurar {name} no Registro para o estado anterior."),
            previous_value: previous_value.clone(),
            backup_path: None,
            command_preview: Some("PowerShell New-ItemProperty -PropertyType DWord".to_string()),
            status: RestoreRollbackActionStatus::Pending,
        }),
        PerformanceOperation::RegistryString {
            path,
            name,
            previous_value,
            ..
        } => Some(RestoreRollbackAction {
            id,
            action_type: rollback_type_for_registry_value(path),
            target: registry_target(path, name, "String"),
            description: format!("Restaurar {name} no Registro para o estado anterior."),
            previous_value: previous_value.clone(),
            backup_path: None,
            command_preview: Some("PowerShell New-ItemProperty -PropertyType String".to_string()),
            status: RestoreRollbackActionStatus::Pending,
        }),
        PerformanceOperation::PowerPlan {
            previous_guid,
            previous_name,
            ..
        } => previous_guid.as_ref().map(|guid| RestoreRollbackAction {
            id,
            action_type: RestoreRollbackActionType::RestorePowerPlan,
            target: guid.clone(),
            description: "Restaurar plano de energia anterior.".to_string(),
            previous_value: previous_name.clone(),
            backup_path: None,
            command_preview: Some(format!("powercfg /S {guid}")),
            status: RestoreRollbackActionStatus::Pending,
        }),
    }
}

fn action_to_previous_state(action: &PerformanceControlledAction) -> Vec<RestorePreviousState> {
    action
        .operations
        .iter()
        .enumerate()
        .map(|(index, operation)| operation_to_previous_state(action, index, operation))
        .collect()
}

fn operation_to_previous_state(
    action: &PerformanceControlledAction,
    index: usize,
    operation: &PerformanceOperation,
) -> RestorePreviousState {
    match operation {
        PerformanceOperation::RegistryDword {
            path,
            name,
            previous_value,
            ..
        }
        | PerformanceOperation::RegistryString {
            path,
            name,
            previous_value,
            ..
        } => RestorePreviousState {
            key: format!("{}:{}:{}", action.id, path, name),
            category: previous_state_category_for_registry_value(path),
            value: previous_value
                .clone()
                .unwrap_or_else(|| MISSING_REGISTRY_VALUE.to_string()),
            source: "Performance Engine 6.2".to_string(),
            captured: true,
        },
        PerformanceOperation::PowerPlan {
            previous_guid,
            previous_name,
            ..
        } => RestorePreviousState {
            key: format!("{}:power-plan:{}", action.id, index + 1),
            category: RestorePreviousStateCategory::PowerPlan,
            value: format!(
                "{} ({})",
                previous_name
                    .clone()
                    .unwrap_or_else(|| "Plano anterior sem nome".to_string()),
                previous_guid
                    .clone()
                    .unwrap_or_else(|| "GUID nao capturado".to_string())
            ),
            source: "powercfg /GETACTIVESCHEME".to_string(),
            captured: previous_guid.is_some(),
        },
    }
}

fn apply_controlled_action(action: &PerformanceControlledAction) -> PerformanceApplyActionResult {
    if action.operations.is_empty() {
        return PerformanceApplyActionResult {
            id: action.id.clone(),
            title: action.title.clone(),
            status: PerformanceApplyActionStatus::Skipped,
            message: "Acao sem operacoes aplicaveis.".to_string(),
        };
    }

    for operation in &action.operations {
        if let Err(error) = apply_operation(operation) {
            return PerformanceApplyActionResult {
                id: action.id.clone(),
                title: action.title.clone(),
                status: PerformanceApplyActionStatus::Failed,
                message: error,
            };
        }
    }

    PerformanceApplyActionResult {
        id: action.id.clone(),
        title: action.title.clone(),
        status: PerformanceApplyActionStatus::Applied,
        message: "Acao aplicada com sucesso e rollback registrado.".to_string(),
    }
}

fn apply_operation(operation: &PerformanceOperation) -> Result<(), String> {
    match operation {
        PerformanceOperation::RegistryDword {
            path, name, value, ..
        } => set_registry_dword(path, name, *value),
        PerformanceOperation::RegistryString {
            path, name, value, ..
        } => set_registry_string(path, name, value),
        PerformanceOperation::PowerPlan { guid, .. } => set_power_plan(guid),
    }
}

fn rollback_type_for_registry_value(path: &str) -> RestoreRollbackActionType {
    if is_visual_effects_registry_path(path) {
        RestoreRollbackActionType::RestoreVisualEffects
    } else {
        RestoreRollbackActionType::RestoreRegistryValue
    }
}

fn previous_state_category_for_registry_value(path: &str) -> RestorePreviousStateCategory {
    if is_visual_effects_registry_path(path) {
        RestorePreviousStateCategory::VisualEffects
    } else {
        RestorePreviousStateCategory::Registry
    }
}

fn is_visual_effects_registry_path(path: &str) -> bool {
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

fn set_registry_dword(path: &str, name: &str, value: i64) -> Result<(), String> {
    let path_arg = ps_escape(path);
    let name_arg = ps_escape(name);
    let script = format!(
        "$ErrorActionPreference = 'Stop'; New-Item -Path '{path_arg}' -Force | Out-Null; New-ItemProperty -Path '{path_arg}' -Name '{name_arg}' -Value {value} -PropertyType DWord -Force | Out-Null; 'ok'"
    );
    run_powershell(&script).map(|_| ())
}

fn set_registry_string(path: &str, name: &str, value: &str) -> Result<(), String> {
    let path_arg = ps_escape(path);
    let name_arg = ps_escape(name);
    let value_arg = ps_escape(value);
    let script = format!(
        "$ErrorActionPreference = 'Stop'; New-Item -Path '{path_arg}' -Force | Out-Null; New-ItemProperty -Path '{path_arg}' -Name '{name_arg}' -Value '{value_arg}' -PropertyType String -Force | Out-Null; 'ok'"
    );
    run_powershell(&script).map(|_| ())
}

fn set_power_plan(guid: &str) -> Result<(), String> {
    if !is_guid_like(guid) {
        return Err("Plano de energia alvo possui GUID invalido.".to_string());
    }

    let guid_arg = ps_escape(guid);
    let script = format!(
        "$ErrorActionPreference = 'Stop'; & powercfg /S '{guid_arg}'; if ($LASTEXITCODE -ne 0) {{ throw \"powercfg retornou $LASTEXITCODE\" }}; 'ok'"
    );
    run_powershell(&script).map(|_| ())
}

fn registry_target(path: &str, name: &str, value_kind: &str) -> String {
    format!("{path}|{name}|{value_kind}")
}

fn previous_dword(value: Option<i64>) -> Option<String> {
    Some(
        value
            .map(|item| item.to_string())
            .unwrap_or_else(|| MISSING_REGISTRY_VALUE.to_string()),
    )
}

fn previous_string(value: Option<&str>) -> Option<String> {
    Some(
        value
            .map(ToString::to_string)
            .unwrap_or_else(|| MISSING_REGISTRY_VALUE.to_string()),
    )
}

fn setting(
    id: impl Into<String>,
    label: impl Into<String>,
    value: impl Into<String>,
    status: PerformanceSettingStatus,
    source: impl Into<String>,
    can_optimize_later: bool,
) -> PerformanceSetting {
    PerformanceSetting {
        id: id.into(),
        label: label.into(),
        value: value.into(),
        status,
        source: source.into(),
        can_optimize_later,
    }
}

fn fallback_report() -> PerformanceReport {
    build_report(
        RawPerformanceReport {
            power_plan_name: Some("Indisponivel".to_string()),
            power_plan_guid: Some("Indisponivel".to_string()),
            auto_game_mode_enabled: None,
            allow_auto_game_mode: None,
            game_dvr_enabled: None,
            enable_transparency: None,
            visual_fx_setting: None,
            min_animate: None,
            taskbar_animations: None,
            listview_shadow: None,
            listview_alpha_select: None,
            drag_full_windows: None,
            background_apps_global_disabled: None,
            power_throttling_off: None,
        },
        vec!["Fallback indisponivel usado porque a leitura real nao respondeu. Nenhum estado demonstrativo foi retornado.".to_string()],
    )
}

fn power_plan_status(plan_name: &str) -> &'static str {
    let normalized = plan_name.to_lowercase();
    if normalized.contains("alto") || normalized.contains("high") || normalized.contains("ultimate")
    {
        "Desempenho"
    } else if normalized.contains("econom") || normalized.contains("power saver") {
        "Economia"
    } else if normalized.contains("equilibr") || normalized.contains("balanced") {
        "Equilibrado"
    } else {
        "Desconhecido"
    }
}

fn visual_profile(value: Option<i64>) -> &'static str {
    match value {
        Some(1) => "Melhor aparencia",
        Some(2) => "Melhor desempenho",
        Some(3) => "Personalizado",
        Some(0) => "Windows decide",
        _ => "Desconhecido",
    }
}

fn visual_status(profile: &str, animations: Option<bool>, shadows: Option<bool>) -> String {
    if profile == "Melhor desempenho" {
        "Otimizado".to_string()
    } else if animations == Some(false) && shadows == Some(false) {
        "Leve".to_string()
    } else if profile == "Desconhecido" {
        "Desconhecido".to_string()
    } else {
        "Visual ativo".to_string()
    }
}

fn optional_bool_status(value: Option<bool>) -> String {
    match value {
        Some(true) => "Ativo".to_string(),
        Some(false) => "Desativado".to_string(),
        None => "Desconhecido".to_string(),
    }
}

fn status_from_option(value: Option<bool>) -> PerformanceSettingStatus {
    match value {
        Some(true) => PerformanceSettingStatus::Enabled,
        Some(false) => PerformanceSettingStatus::Disabled,
        None => PerformanceSettingStatus::Unknown,
    }
}

fn combine_any_enabled(values: &[Option<bool>]) -> Option<bool> {
    let mut saw_value = false;
    for value in values {
        if let Some(enabled) = value {
            saw_value = true;
            if *enabled {
                return Some(true);
            }
        }
    }

    if saw_value {
        Some(false)
    } else {
        None
    }
}

fn append_performance_event(
    app: &AppHandle,
    level: PerformanceEventLevel,
    snapshot_id: Option<String>,
    message: &str,
) -> Result<(), String> {
    let path = performance_events_path(app)?;
    let mut history = read_performance_event_history(&path);
    history.events.insert(
        0,
        PerformanceEvent {
            id: format!("performance-event-{}-{}", now_timestamp(), now_nanos()),
            timestamp: now_timestamp(),
            level,
            snapshot_id,
            message: message.to_string(),
        },
    );
    history.events.truncate(MAX_PERFORMANCE_EVENTS);
    write_performance_event_history(&path, &history)
}

fn performance_events_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Nao foi possivel localizar AppData: {err}"))?;
    dir.push("history");
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Nao foi possivel criar historico de performance: {err}"))?;
    dir.push("performance_events.json");
    Ok(dir)
}

fn read_performance_event_history(path: &PathBuf) -> PerformanceEventHistory {
    let Ok(contents) = fs::read_to_string(path) else {
        return PerformanceEventHistory::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_performance_event_history(
    path: &PathBuf,
    history: &PerformanceEventHistory,
) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(history)
        .map_err(|err| format!("Nao foi possivel serializar logs de performance: {err}"))?;
    fs::write(path, contents)
        .map_err(|err| format!("Nao foi possivel gravar logs de performance: {err}"))
}

fn is_guid_like(value: &str) -> bool {
    value.len() == 36
        && value
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
}

fn ps_escape(value: &str) -> String {
    value.replace('\'', "''")
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
        .map_err(|err| format!("Nao foi possivel iniciar PowerShell de performance: {err}"))?;
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
            return Err("Tempo limite atingido ao ler configuracoes de performance.".to_string());
        }

        thread::sleep(Duration::from_millis(80));
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("Nao foi possivel ler saida do PowerShell: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "PowerShell retornou erro na Performance Engine: {stderr}"
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        Err("PowerShell nao retornou dados de performance.".to_string())
    } else {
        Ok(stdout)
    }
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

const POWERSHELL_PERFORMANCE_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-Dword($path, $name) {
  try {
    $item = Get-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue
    if ($null -eq $item) { return $null }
    return [int64]$item.$name
  } catch { return $null }
}

function Get-StringValue($path, $name) {
  try {
    $item = Get-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue
    if ($null -eq $item) { return $null }
    return [string]$item.$name
  } catch { return $null }
}

function DwordToBool($value) {
  if ($null -eq $value) { return $null }
  return ([int64]$value -ne 0)
}

$powerPlanRaw = [string](powercfg /GETACTIVESCHEME)
$powerPlanGuid = $null
$powerPlanName = $null
if ($powerPlanRaw -match '([a-fA-F0-9-]{36})') {
  $powerPlanGuid = $Matches[1]
}
if ($powerPlanRaw -match '\((.*?)\)') {
  $powerPlanName = $Matches[1]
} elseif ($powerPlanRaw) {
  $powerPlanName = $powerPlanRaw.Trim()
}

$gameBarPath = 'HKCU:\Software\Microsoft\GameBar'
$gameConfigPath = 'HKCU:\System\GameConfigStore'
$personalizePath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
$visualFxPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects'
$advancedPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
$desktopPath = 'HKCU:\Control Panel\Desktop'
$windowMetricsPath = 'HKCU:\Control Panel\Desktop\WindowMetrics'
$backgroundAppsPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications'
$powerThrottlePath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\PowerThrottling'

$autoGameModeEnabled = DwordToBool (Get-Dword $gameBarPath 'AutoGameModeEnabled')
$allowAutoGameMode = DwordToBool (Get-Dword $gameBarPath 'AllowAutoGameMode')
$gameDvrEnabled = DwordToBool (Get-Dword $gameConfigPath 'GameDVR_Enabled')

[pscustomobject]@{
  powerPlanName = $powerPlanName
  powerPlanGuid = $powerPlanGuid
  autoGameModeEnabled = $autoGameModeEnabled
  allowAutoGameMode = $allowAutoGameMode
  gameDvrEnabled = $gameDvrEnabled
  enableTransparency = Get-Dword $personalizePath 'EnableTransparency'
  visualFxSetting = Get-Dword $visualFxPath 'VisualFXSetting'
  minAnimate = Get-StringValue $windowMetricsPath 'MinAnimate'
  taskbarAnimations = Get-Dword $advancedPath 'TaskbarAnimations'
  listviewShadow = Get-Dword $advancedPath 'ListviewShadow'
  listviewAlphaSelect = Get-Dword $advancedPath 'ListviewAlphaSelect'
  dragFullWindows = Get-StringValue $desktopPath 'DragFullWindows'
  backgroundAppsGlobalDisabled = Get-Dword $backgroundAppsPath 'GlobalUserDisabled'
  powerThrottlingOff = Get-Dword $powerThrottlePath 'PowerThrottlingOff'
} | ConvertTo-Json -Depth 5 -Compress
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn raw_report() -> RawPerformanceReport {
        RawPerformanceReport {
            power_plan_name: Some("Equilibrado".to_string()),
            power_plan_guid: Some(BALANCED_POWER_PLAN_GUID.to_string()),
            auto_game_mode_enabled: Some(false),
            allow_auto_game_mode: Some(false),
            game_dvr_enabled: Some(true),
            enable_transparency: Some(1),
            visual_fx_setting: Some(1),
            min_animate: Some("1".to_string()),
            taskbar_animations: Some(1),
            listview_shadow: Some(1),
            listview_alpha_select: Some(1),
            drag_full_windows: Some("1".to_string()),
            background_apps_global_disabled: Some(0),
            power_throttling_off: Some(0),
        }
    }

    fn snapshot_for_profile(
        profile_name: &str,
        action_ids: Vec<&str>,
    ) -> RestoreCreateSnapshotRequest {
        let request = PerformanceApplyRequest {
            action_ids: Some(action_ids.into_iter().map(str::to_string).collect()),
            confirmed: true,
            dry_run: Some(true),
            reason: Some(format!("Perfil NEX: {profile_name}")),
        };
        let selected_ids = selected_action_ids(request.action_ids.as_deref());
        let actions = controlled_actions_from_raw(&raw_report(), &selected_ids);

        build_performance_snapshot_request(&request, &actions, true)
    }

    fn assert_visual_fx_setting_snapshot(snapshot: RestoreCreateSnapshotRequest) {
        let rollback_manifest = snapshot
            .rollback_manifest
            .expect("snapshot must include rollback manifest");
        let visual_fx_rollback = rollback_manifest
            .iter()
            .find(|action| {
                action
                    .target
                    .contains("Explorer\\VisualEffects|VisualFXSetting|DWord")
            })
            .expect("VisualFXSetting rollback must be registered");

        assert!(matches!(
            visual_fx_rollback.action_type,
            RestoreRollbackActionType::RestoreVisualEffects
        ));
        assert_eq!(visual_fx_rollback.previous_value.as_deref(), Some("1"));

        let previous_state = snapshot
            .previous_state
            .expect("snapshot must include previous state");
        let visual_fx_state = previous_state
            .iter()
            .find(|state| {
                state
                    .key
                    .contains("Explorer\\VisualEffects:VisualFXSetting")
            })
            .expect("VisualFXSetting previous state must be captured");

        assert!(matches!(
            visual_fx_state.category,
            RestorePreviousStateCategory::VisualEffects
        ));
        assert_eq!(visual_fx_state.value, "1");
        assert!(visual_fx_state.captured);
    }

    #[test]
    fn gamer_profile_snapshot_captures_visual_fx_setting() {
        assert_visual_fx_setting_snapshot(snapshot_for_profile(
            "Gamer",
            vec![
                "disable-transparency",
                "disable-window-animations",
                "disable-visual-shadows",
                "set-high-performance-power-plan",
            ],
        ));
    }

    #[test]
    fn economia_profile_snapshot_captures_visual_fx_setting() {
        assert_visual_fx_setting_snapshot(snapshot_for_profile(
            "Economia",
            vec![
                "disable-transparency",
                "disable-window-animations",
                "set-power-saver-power-plan",
            ],
        ));
    }

    #[test]
    fn extremo_profile_snapshot_captures_visual_fx_setting() {
        assert_visual_fx_setting_snapshot(snapshot_for_profile(
            "Extremo",
            vec![
                "disable-transparency",
                "disable-window-animations",
                "disable-visual-shadows",
                "set-high-performance-power-plan",
            ],
        ));
    }
}
