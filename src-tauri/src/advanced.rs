use crate::{
    restore::{
        self, RestoreCreateSnapshotRequest, RestorePlannedAction, RestorePreviousState,
        RestorePreviousStateCategory, RestoreRiskLevel, RestoreRollbackAction,
        RestoreRollbackActionStatus, RestoreRollbackActionType,
    },
    safe_mode,
};
use serde::{Deserialize, Deserializer, Serialize};
use std::{
    fs,
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const ADVANCED_COMMAND_TIMEOUT_SECONDS: u64 = 15;
const MAX_ADVANCED_EVENTS: usize = 100;
const MISSING_REGISTRY_VALUE: &str = "__HERMES_MISSING__";
const BALANCED_POWER_PLAN_GUID: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";
const HIGH_PERFORMANCE_POWER_PLAN_GUID: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
const POWER_SAVER_POWER_PLAN_GUID: &str = "a1841308-3541-4fab-bc81-f71556f20b4a";
const ULTIMATE_PERFORMANCE_POWER_PLAN_GUID: &str = "e9a42b02-d5df-448d-aa00-03f14749eb61";
const USB_SETTINGS_SUBGROUP_GUID: &str = "2a737441-1930-4402-8d77-b2bebba308a3";
const USB_SELECTIVE_SUSPEND_SETTING_GUID: &str = "48e6b7a6-50f5-4782-a5d4-53bb8f07e226";
const PCI_EXPRESS_SUBGROUP_GUID: &str = "501a4d13-42af-4429-9fd1-a8218c268e20";
const PCIE_LINK_STATE_POWER_MANAGEMENT_SETTING_GUID: &str = "ee12f906-d277-404b-b6da-e5fa1a576df5";
const DISPLAY_SETTINGS_SUBGROUP_GUID: &str = "7516b95f-f776-4464-8c53-06167f40cc99";
const DISPLAY_IDLE_TIMEOUT_SETTING_GUID: &str = "3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedCatalog {
    pub generated_at: String,
    pub engine_version: String,
    pub read_only: bool,
    pub will_modify_system: bool,
    pub telemetry: bool,
    pub resident_process: bool,
    pub actions: Vec<AdvancedAction>,
    pub blocked_actions: Vec<AdvancedBlockedAction>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedAction {
    pub id: String,
    pub title: String,
    pub description: String,
    pub method: AdvancedMethod,
    pub risk: AdvancedRisk,
    pub requires_admin: bool,
    pub requires_extreme: bool,
    pub reversible: bool,
    pub persistent: bool,
    pub requires_restart: bool,
    pub current_value: String,
    pub planned_change: String,
    pub command_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedBlockedAction {
    pub id: String,
    pub title: String,
    pub reason: String,
    pub method: AdvancedMethod,
    pub risk: AdvancedRisk,
    pub requires_admin: bool,
    pub requires_extreme: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedMethod {
    Registry,
    Cmd,
    PowerShell,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedApplyRequest {
    pub confirmed: bool,
    pub dry_run: Option<bool>,
    pub action_ids: Option<Vec<String>>,
    pub extreme_mode: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedApplyResult {
    pub generated_at: String,
    pub engine_version: String,
    pub dry_run: bool,
    pub snapshot_id: String,
    pub rollback_available: bool,
    pub applied_actions: Vec<AdvancedActionResult>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedActionResult {
    pub id: String,
    pub title: String,
    pub status: AdvancedActionStatus,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedActionStatus {
    DryRun,
    Applied,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdvancedEvent {
    id: String,
    timestamp: String,
    snapshot_id: Option<String>,
    level: AdvancedEventLevel,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum AdvancedEventLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AdvancedEventHistory {
    events: Vec<AdvancedEvent>,
}

#[derive(Debug, Clone)]
struct AdvancedPlan {
    action: AdvancedAction,
    operations: Vec<AdvancedOperation>,
}

#[derive(Debug, Clone)]
enum AdvancedOperation {
    RegistryDword {
        path: String,
        name: String,
        value: i64,
        previous_value: Option<String>,
        rollback_type: RestoreRollbackActionType,
    },
    RegistryString {
        path: String,
        name: String,
        value: String,
        previous_value: Option<String>,
        rollback_type: RestoreRollbackActionType,
    },
    PowerPlan {
        guid: String,
        previous_guid: Option<String>,
        previous_name: Option<String>,
    },
    PowerSetting {
        id: String,
        subgroup_guid: String,
        setting_guid: String,
        ac_value: i64,
        dc_value: i64,
        previous_ac_value: Option<String>,
        previous_dc_value: Option<String>,
    },
    DnsProvider {
        provider_id: String,
        provider_label: String,
        servers: Vec<String>,
        previous_interfaces: Vec<DnsInterfaceState>,
    },
    DefenderPathExclusion {
        path: String,
        already_excluded: bool,
    },
    Cmd {
        program: String,
        args: Vec<String>,
        transient: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DnsInterfaceState {
    #[serde(default, deserialize_with = "deserialize_nullable_string")]
    interface_alias: String,
    #[serde(default, deserialize_with = "deserialize_nullable_string_vec")]
    server_addresses: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ServiceStartModeState {
    #[serde(default, deserialize_with = "deserialize_nullable_string")]
    name: String,
    start_mode: Option<String>,
}

fn deserialize_nullable_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

fn deserialize_nullable_string_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<Vec<Option<String>>>::deserialize(deserializer)?
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .collect())
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawAdvancedState {
    auto_game_mode_enabled: Option<i64>,
    allow_auto_game_mode: Option<i64>,
    game_bar_show_startup_panel: Option<i64>,
    game_bar_use_nexus_for_game_bar_enabled: Option<i64>,
    game_dvr_enabled: Option<i64>,
    game_dvr_fse_behavior_mode: Option<i64>,
    app_capture_enabled: Option<i64>,
    startup_delay_in_msec: Option<i64>,
    advertising_info_enabled: Option<i64>,
    tailored_experiences_enabled: Option<i64>,
    content_delivery_allowed: Option<i64>,
    oem_preinstalled_apps_enabled: Option<i64>,
    preinstalled_apps_enabled: Option<i64>,
    silent_installed_apps_enabled: Option<i64>,
    system_pane_suggestions_enabled: Option<i64>,
    subscribed_content_338388_enabled: Option<i64>,
    subscribed_content_338389_enabled: Option<i64>,
    publish_user_activities: Option<i64>,
    upload_user_activities: Option<i64>,
    location_consent_value: Option<String>,
    storage_sense_enabled: Option<i64>,
    background_apps_global_disabled: Option<i64>,
    push_notifications_toast_enabled: Option<i64>,
    notification_toasts_enabled: Option<i64>,
    focus_assist_allow_sound: Option<i64>,
    focus_assist_allow_notification_sound: Option<i64>,
    focus_assist_allow_toasts_above_lock: Option<i64>,
    focus_assist_allow_critical_toasts_above_lock: Option<i64>,
    recall_disable_ai_data_analysis: Option<i64>,
    hibernate_enabled: Option<i64>,
    boot_timeout_seconds: Option<i64>,
    diagtrack_start_mode: Option<String>,
    mapsbroker_start_mode: Option<String>,
    #[serde(default)]
    optional_service_start_modes: Vec<ServiceStartModeState>,
    enable_transparency: Option<i64>,
    apps_use_light_theme: Option<i64>,
    system_uses_light_theme: Option<i64>,
    min_animate: Option<String>,
    drag_full_windows: Option<String>,
    font_smoothing: Option<String>,
    taskbar_animations: Option<i64>,
    icons_only: Option<i64>,
    listview_alpha_select: Option<i64>,
    listview_shadow: Option<i64>,
    enable_aero_peek: Option<i64>,
    visual_fx_setting: Option<i64>,
    mmcss_system_responsiveness: Option<i64>,
    mmcss_games_gpu_priority: Option<i64>,
    mmcss_games_priority: Option<i64>,
    mmcss_games_scheduling_category: Option<String>,
    mmcss_games_sfio_priority: Option<String>,
    fate_trigger_cpu_priority: Option<i64>,
    fate_trigger_shipping_cpu_priority: Option<i64>,
    gamer_dependencies_summary: Option<String>,
    #[serde(default)]
    dns_interfaces: Vec<DnsInterfaceState>,
    power_plan_guid: Option<String>,
    power_plan_name: Option<String>,
    ultimate_performance_available: Option<bool>,
    usb_selective_suspend_ac: Option<String>,
    usb_selective_suspend_dc: Option<String>,
    pcie_link_state_ac: Option<String>,
    pcie_link_state_dc: Option<String>,
    display_idle_timeout_ac: Option<String>,
    display_idle_timeout_dc: Option<String>,
    timer_policy_summary: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_string_vec")]
    defender_exclusion_paths: Vec<String>,
}

#[tauri::command]
pub async fn advanced_engine_catalog() -> AdvancedCatalog {
    tauri::async_runtime::spawn_blocking(collect_advanced_catalog)
        .await
        .unwrap_or_else(|err| {
            build_catalog(
                fallback_state(),
                vec![format!(
                    "Falha ao ler catalogo avancado em segundo plano: {err}"
                )],
            )
        })
}

#[tauri::command]
pub async fn advanced_engine_apply(
    app: AppHandle,
    request: Option<AdvancedApplyRequest>,
) -> Result<AdvancedApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || advanced_engine_apply_blocking(app, request, true))
        .await
        .map_err(|err| format!("Falha ao aplicar Advanced Engine em segundo plano: {err}"))?
}

#[tauri::command]
pub async fn advanced_engine_apply_optimize_now(
    app: AppHandle,
    request: Option<AdvancedApplyRequest>,
) -> Result<AdvancedApplyResult, String> {
    // enforce_safe_test_mode must stay `true` here: this is the "Otimizar Agora" one-click
    // path and it must never be able to bypass the global HERMES_SAFE_TEST_MODE build flag.
    tauri::async_runtime::spawn_blocking(move || {
        advanced_engine_apply_blocking(app, request, true)
    })
    .await
    .map_err(|err| format!("Falha ao otimizar emulador no Otimizar Agora: {err}"))?
}

#[tauri::command]
pub async fn advanced_set_graphics_high_performance_optimize_now(
    app: AppHandle,
    executable_path: String,
    dry_run: Option<bool>,
) -> Result<AdvancedApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        graphics_preference_apply_blocking(
            app,
            executable_path,
            safe_mode::force_dry_run(dry_run.unwrap_or(false)),
        )
    })
    .await
    .map_err(|err| format!("Falha ao priorizar Elementos Graficos: {err}"))?
}

pub(crate) fn advanced_engine_apply_blocking(
    app: AppHandle,
    request: Option<AdvancedApplyRequest>,
    enforce_safe_test_mode: bool,
) -> Result<AdvancedApplyResult, String> {
    let request = request.unwrap_or_default();
    let requested_dry_run = request.dry_run.unwrap_or(!request.confirmed);
    let dry_run = if enforce_safe_test_mode {
        safe_mode::force_dry_run(requested_dry_run)
    } else {
        requested_dry_run
    };
    if !dry_run && !request.confirmed {
        return Err("Confirmacao obrigatoria antes de aplicar comandos avancados.".to_string());
    }

    let state = collect_windows_state()?;
    let selected_ids = selected_action_ids(request.action_ids.as_deref());
    let plans = build_plans(&state, &selected_ids);
    if plans.is_empty() {
        return Err("Nenhuma acao avancada segura foi selecionada.".to_string());
    }
    validate_plans_for_apply(&plans, request.extreme_mode.unwrap_or(false), dry_run)?;

    execute_advanced_plans(app, plans, dry_run)
}

fn graphics_preference_apply_blocking(
    app: AppHandle,
    executable_path: String,
    dry_run: bool,
) -> Result<AdvancedApplyResult, String> {
    if !cfg!(target_os = "windows") {
        return Err("Elementos Graficos exige Windows.".to_string());
    }

    let executable_path = normalize_graphics_preference_path(&executable_path)?;
    let registry_path = "HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences";
    let previous_value = read_registry_string(registry_path, &executable_path)?;
    let plans = vec![graphics_high_performance_plan(
        &executable_path,
        previous_value,
    )];
    validate_plans_for_apply(&plans, false, dry_run)?;
    execute_advanced_plans(app, plans, dry_run)
}

fn execute_advanced_plans(
    app: AppHandle,
    plans: Vec<AdvancedPlan>,
    dry_run: bool,
) -> Result<AdvancedApplyResult, String> {
    let snapshot = restore::restore_create_snapshot(
        app.clone(),
        Some(build_snapshot_request(&plans, dry_run)),
    )?;
    append_advanced_event(
        &app,
        AdvancedEventLevel::Info,
        Some(snapshot.id.clone()),
        if dry_run {
            "DRY-RUN | Advanced Engine criou snapshot obrigatorio em dry-run."
        } else {
            "Advanced Engine criou snapshot obrigatorio antes da aplicacao."
        },
    )?;

    let applied_actions = if dry_run {
        plans
            .iter()
            .map(|plan| AdvancedActionResult {
                id: plan.action.id.clone(),
                title: plan.action.title.clone(),
                status: AdvancedActionStatus::DryRun,
                message: format!(
                    "{} - nenhum comando CMD/PowerShell/Registro foi executado.",
                    safe_mode::mode_prefix(dry_run)
                ),
            })
            .collect::<Vec<_>>()
    } else {
        apply_plans(&app, &snapshot.id, &plans)?
    };

    let failed = applied_actions
        .iter()
        .any(|result| matches!(result.status, AdvancedActionStatus::Failed));
    let message = if failed {
        append_advanced_event(
            &app,
            AdvancedEventLevel::Warning,
            Some(snapshot.id.clone()),
            "Falha detectada. Rollback automatico acionado.",
        )?;
        match restore::restore_apply_snapshot(app.clone(), snapshot.id.clone(), Some(false)) {
            Ok(result) if result.applied => {
                "Falha durante comandos avancados. Rollback automatico concluido.".to_string()
            }
            Ok(result) => format!(
                "Falha durante comandos avancados. Rollback parcial: {}",
                result.message
            ),
            Err(error) => format!("Falha durante comandos avancados e rollback falhou: {error}"),
        }
    } else if dry_run {
        format!(
            "{} - comandos avancados validados com snapshot e rollback preparados. {}",
            safe_mode::mode_prefix(dry_run),
            if safe_mode::is_enabled() {
                safe_mode::notice()
            } else {
                ""
            }
        )
    } else {
        "Comandos avancados aplicados com snapshot, log e rollback disponiveis.".to_string()
    };

    append_advanced_event(
        &app,
        if failed {
            AdvancedEventLevel::Warning
        } else {
            AdvancedEventLevel::Info
        },
        Some(snapshot.id.clone()),
        &message,
    )?;

    Ok(AdvancedApplyResult {
        generated_at: now_timestamp(),
        engine_version: "advanced-engine-v1".to_string(),
        dry_run,
        snapshot_id: snapshot.id,
        rollback_available: true,
        applied_actions,
        message,
    })
}

pub fn collect_advanced_catalog() -> AdvancedCatalog {
    match collect_windows_state() {
        Ok(state) => build_catalog(state, Vec::new()),
        Err(error) => build_catalog(
            fallback_state(),
            vec![
                error,
                "Fallback indisponivel usado porque a leitura real nao respondeu. Nenhum estado demonstrativo foi retornado.".to_string(),
            ],
        ),
    }
}

fn collect_windows_state() -> Result<RawAdvancedState, String> {
    if !cfg!(target_os = "windows") {
        return Err("Advanced Engine usa PowerShell/Registro locais do Windows.".to_string());
    }

    let stdout = run_powershell(
        POWERSHELL_ADVANCED_STATE_SCRIPT,
        ADVANCED_COMMAND_TIMEOUT_SECONDS,
    )?;
    serde_json::from_str::<RawAdvancedState>(&stdout)
        .map_err(|err| format!("Nao foi possivel interpretar estado avancado: {err}"))
}

fn build_catalog(state: RawAdvancedState, warnings: Vec<String>) -> AdvancedCatalog {
    let plans = build_plans(&state, &default_action_ids());
    AdvancedCatalog {
        generated_at: now_timestamp(),
        engine_version: "advanced-engine-v1".to_string(),
        read_only: true,
        will_modify_system: false,
        telemetry: false,
        resident_process: false,
        actions: plans.into_iter().map(|plan| plan.action).collect(),
        blocked_actions: blocked_actions(),
        warnings,
    }
}

fn build_plans(state: &RawAdvancedState, selected_ids: &[String]) -> Vec<AdvancedPlan> {
    selected_ids
        .iter()
        .filter_map(|id| match id.as_str() {
            "enable-game-mode" => Some(enable_game_mode_plan(state)),
            "disable-game-mode" => Some(disable_game_mode_plan(state)),
            "disable-game-dvr" => Some(disable_game_dvr_plan(state)),
            "disable-xbox-game-bar-deep" => Some(disable_xbox_game_bar_deep_plan(state)),
            "enable-game-dvr" => Some(enable_game_dvr_plan(state)),
            "disable-startup-delay" => Some(disable_startup_delay_plan(state)),
            "disable-advertising-id" => Some(disable_advertising_id_plan(state)),
            "disable-tailored-experiences" => Some(disable_tailored_experiences_plan(state)),
            "disable-consumer-features" => Some(disable_consumer_features_plan(state)),
            "disable-activity-history" => Some(disable_activity_history_plan(state)),
            "disable-location-tracking" => Some(disable_location_tracking_plan(state)),
            "disable-storage-sense-auto-cleanup" => {
                Some(disable_storage_sense_auto_cleanup_plan(state))
            }
            "disable-background-apps" => Some(disable_background_apps_plan(state)),
            "disable-notification-toasts" => Some(disable_notification_toasts_plan(state)),
            "set-focus-assist-gamer" => Some(set_focus_assist_gamer_plan(state)),
            "disable-recall-user" => Some(disable_recall_user_plan(state)),
            "disable-hibernation" => Some(disable_hibernation_plan(state)),
            "set-boot-timeout-fast" => Some(set_boot_timeout_fast_plan(state)),
            "flush-dns-cache" => Some(flush_dns_cache_plan()),
            "dism-analyze-component-store" => Some(dism_analyze_component_store_plan()),
            "dism-start-component-cleanup" => Some(dism_start_component_cleanup_plan()),
            "dism-check-netfx3" => Some(dism_check_netfx3_plan()),
            "dism-check-directplay" => Some(dism_check_directplay_plan()),
            "dism-enable-directplay" => Some(dism_enable_directplay_plan()),
            "winsock-reset" => Some(winsock_reset_plan()),
            "reset-ip-stack" => Some(reset_ip_stack_plan()),
            "set-network-autotuning-normal" => Some(netsh_tcp_global_plan(
                "set-network-autotuning-normal",
                "Auto tuning de rede normal",
                "Ajusta o TCP Auto-Tuning para normal, evitando estado desativado que pode limitar throughput.",
                "autotuninglevel=normal",
                "cmd: netsh int tcp set global autotuninglevel=normal",
            )),
            "disable-network-ecn" => Some(netsh_tcp_global_plan(
                "disable-network-ecn",
                "ECN de rede seguro",
                "Desativa ECN para reduzir incompatibilidades com rotas, provedores e equipamentos antigos.",
                "ecncapability=disabled",
                "cmd: netsh int tcp set global ecncapability=disabled",
            )),
            "enable-network-rss" => Some(netsh_tcp_global_plan(
                "enable-network-rss",
                "RSS de rede ativo",
                "Ativa Receive-Side Scaling para distribuir processamento de rede quando o adaptador suportar.",
                "rss=enabled",
                "cmd: netsh int tcp set global rss=enabled",
            )),
            "set-diagtrack-service-manual" => Some(set_service_manual_plan(
                "set-diagtrack-service-manual",
                "Telemetria sob demanda",
                "Coloca o servico DiagTrack sob demanda para reduzir carga em segundo plano sem remover o servico.",
                "DiagTrack",
                state.diagtrack_start_mode.as_deref(),
            )),
            "set-mapsbroker-service-manual" => Some(set_service_manual_plan(
                "set-mapsbroker-service-manual",
                "Mapas sob demanda",
                "Coloca o servico MapsBroker sob demanda para reduzir servicos pouco usados durante jogos.",
                "MapsBroker",
                state.mapsbroker_start_mode.as_deref(),
            )),
            "set-wersvc-service-manual" => Some(set_service_manual_plan(
                "set-wersvc-service-manual",
                "Relatorio de erros sob demanda",
                "Coloca o Windows Error Reporting sob demanda para reduzir carga no boot sem remover diagnosticos do sistema.",
                "WerSvc",
                service_start_mode(state, "WerSvc").as_deref(),
            )),
            "set-wmpnetworksvc-service-manual" => Some(set_service_manual_plan(
                "set-wmpnetworksvc-service-manual",
                "Compartilhamento de midia sob demanda",
                "Coloca o Windows Media Player Network Sharing sob demanda quando existir, evitando servico de midia no boot.",
                "WMPNetworkSvc",
                service_start_mode(state, "WMPNetworkSvc").as_deref(),
            )),
            "set-fax-service-manual" => Some(set_service_manual_plan(
                "set-fax-service-manual",
                "Fax sob demanda",
                "Coloca o servico Fax sob demanda quando existir. Computadores gamer raramente precisam iniciar Fax no boot.",
                "Fax",
                service_start_mode(state, "Fax").as_deref(),
            )),
            "set-retaildemo-service-manual" => Some(set_service_manual_plan(
                "set-retaildemo-service-manual",
                "Demo de varejo sob demanda",
                "Coloca RetailDemo sob demanda quando existir, mantendo fora do boot de computadores pessoais.",
                "RetailDemo",
                service_start_mode(state, "RetailDemo").as_deref(),
            )),
            "set-phonesvc-service-manual" => Some(set_service_manual_plan(
                "set-phonesvc-service-manual",
                "Vincular telefone sob demanda",
                "Coloca PhoneSvc sob demanda para reduzir servicos de integracao com celular no boot.",
                "PhoneSvc",
                service_start_mode(state, "PhoneSvc").as_deref(),
            )),
            "set-walletservice-manual" => Some(set_service_manual_plan(
                "set-walletservice-manual",
                "Carteira do Windows sob demanda",
                "Coloca WalletService sob demanda quando existir, sem remover o recurso do Windows.",
                "WalletService",
                service_start_mode(state, "WalletService").as_deref(),
            )),
            "set-xbl-auth-manager-manual" => Some(set_service_manual_plan(
                "set-xbl-auth-manager-manual",
                "Xbox Live Auth sob demanda",
                "Coloca XblAuthManager sob demanda para reduzir carga Xbox no boot, preservando inicio quando necessario.",
                "XblAuthManager",
                service_start_mode(state, "XblAuthManager").as_deref(),
            )),
            "set-xbl-game-save-manual" => Some(set_service_manual_plan(
                "set-xbl-game-save-manual",
                "Xbox Game Save sob demanda",
                "Coloca XblGameSave sob demanda, mantendo compatibilidade quando jogos Xbox precisarem.",
                "XblGameSave",
                service_start_mode(state, "XblGameSave").as_deref(),
            )),
            "set-xbox-net-api-svc-manual" => Some(set_service_manual_plan(
                "set-xbox-net-api-svc-manual",
                "Xbox Live Networking sob demanda",
                "Coloca XboxNetApiSvc sob demanda para evitar inicializacao permanente de rede Xbox no boot.",
                "XboxNetApiSvc",
                service_start_mode(state, "XboxNetApiSvc").as_deref(),
            )),
            "allow-hermes-defender-exclusion" => allow_hermes_defender_exclusion_plan(state),
            "set-dns-cloudflare" => Some(set_dns_provider_plan(
                state,
                "set-dns-cloudflare",
                "Cloudflare",
                &["1.1.1.1", "1.0.0.1"],
            )),
            "set-dns-google" => Some(set_dns_provider_plan(
                state,
                "set-dns-google",
                "Google",
                &["8.8.8.8", "8.8.4.4"],
            )),
            "set-dns-opendns" => Some(set_dns_provider_plan(
                state,
                "set-dns-opendns",
                "OpenDNS",
                &["208.67.222.222", "208.67.220.220"],
            )),
            "set-dns-quad9" => Some(set_dns_provider_plan(
                state,
                "set-dns-quad9",
                "Quad9",
                &["9.9.9.9", "149.112.112.112"],
            )),
            "set-dns-adguard" => Some(set_dns_provider_plan(
                state,
                "set-dns-adguard",
                "AdGuard",
                &["94.140.14.14", "94.140.15.15"],
            )),
            "list-power-plans" => Some(list_power_plans_plan(state)),
            "set-high-performance-power-plan" => Some(set_power_plan_plan(
                state,
                "set-high-performance-power-plan",
                "Ativar plano Alto desempenho",
                "Troca o plano de energia para Alto desempenho usando powercfg, com rollback para o plano anterior.",
                HIGH_PERFORMANCE_POWER_PLAN_GUID,
                AdvancedRisk::Medium,
            )),
            "set-display-timeout-never" => Some(set_display_timeout_never_plan(state)),
            "set-windows-dark-mode" => Some(set_windows_dark_mode_plan(state)),
            "set-balanced-power-plan" => Some(set_power_plan_plan(
                state,
                "set-balanced-power-plan",
                "Ativar plano Equilibrado",
                "Troca o plano de energia para Equilibrado usando powercfg, com rollback para o plano anterior.",
                BALANCED_POWER_PLAN_GUID,
                AdvancedRisk::Low,
            )),
            "set-power-saver-power-plan" => Some(set_power_plan_plan(
                state,
                "set-power-saver-power-plan",
                "Ativar plano Economia de energia",
                "Troca o plano de energia para Economia de energia usando powercfg, com rollback para o plano anterior.",
                POWER_SAVER_POWER_PLAN_GUID,
                AdvancedRisk::Low,
            )),
            "duplicate-ultimate-performance-power-plan" => {
                Some(duplicate_ultimate_performance_power_plan(state))
            }
            "disable-usb-selective-suspend" => Some(disable_usb_selective_suspend_plan(state)),
            "disable-pcie-link-state-power-management" => {
                Some(disable_pcie_link_state_power_management_plan(state))
            }
            "check-timer-resolution-policy" => Some(check_timer_resolution_policy_plan(state)),
            "set-mmcss-gamer-pack" => Some(set_mmcss_gamer_pack_plan(state)),
            "set-fate-trigger-cpu-priority-high" => {
                Some(set_fate_trigger_cpu_priority_high_plan(state))
            }
            "check-gamer-dependencies" => Some(check_gamer_dependencies_plan(state)),
            "disable-transparency" => Some(disable_transparency_plan(state)),
            "disable-window-animations" => Some(disable_window_animations_plan(state)),
            "disable-visual-shadows" => Some(disable_visual_shadows_plan(state)),
            "set-visual-effects-custom" => Some(set_visual_effects_custom_plan(state)),
            "set-visual-effects-gamer-minimal" => {
                Some(set_visual_effects_gamer_minimal_plan(state))
            }
            "open-performance-options" => Some(open_performance_options_plan()),
            _ => None,
        })
        .collect()
}

fn enable_game_mode_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "enable-game-mode",
            "Ativar Game Mode",
            "Ativa as chaves nativas do Windows Game Mode no usuario atual.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            format!(
                "AutoGameModeEnabled={}, AllowAutoGameMode={}",
                display_optional(state.auto_game_mode_enabled),
                display_optional(state.allow_auto_game_mode)
            ),
            "Definir ambos como 1",
            "PowerShell New-ItemProperty em HKCU GameBar",
        ),
        operations: vec![
            registry_dword(
                "HKCU:\\Software\\Microsoft\\GameBar",
                "AutoGameModeEnabled",
                1,
                state.auto_game_mode_enabled,
                RestoreRollbackActionType::RestoreGameMode,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\GameBar",
                "AllowAutoGameMode",
                1,
                state.allow_auto_game_mode,
                RestoreRollbackActionType::RestoreGameMode,
            ),
        ],
    }
}

fn disable_game_mode_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "disable-game-mode",
            "Desativar Game Mode",
            "Desativa as chaves nativas do Windows Game Mode no usuario atual.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            format!(
                "AutoGameModeEnabled={}, AllowAutoGameMode={}",
                display_optional(state.auto_game_mode_enabled),
                display_optional(state.allow_auto_game_mode)
            ),
            "Definir ambos como 0",
            "PowerShell New-ItemProperty em HKCU GameBar",
        ),
        operations: vec![
            registry_dword(
                "HKCU:\\Software\\Microsoft\\GameBar",
                "AutoGameModeEnabled",
                0,
                state.auto_game_mode_enabled,
                RestoreRollbackActionType::RestoreGameMode,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\GameBar",
                "AllowAutoGameMode",
                0,
                state.allow_auto_game_mode,
                RestoreRollbackActionType::RestoreGameMode,
            ),
        ],
    }
}

fn disable_game_dvr_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "disable-game-dvr",
            "Desativar captura Game DVR",
            "Desativa captura em segundo plano do Game DVR para reduzir overhead durante jogos.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            format!(
                "GameDVR_Enabled={}, AppCaptureEnabled={}",
                display_optional(state.game_dvr_enabled),
                display_optional(state.app_capture_enabled)
            ),
            "Definir ambos como 0",
            "PowerShell New-ItemProperty em HKCU GameConfigStore/GameDVR",
        ),
        operations: vec![
            registry_dword(
                "HKCU:\\System\\GameConfigStore",
                "GameDVR_Enabled",
                0,
                state.game_dvr_enabled,
                RestoreRollbackActionType::RestoreGameMode,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR",
                "AppCaptureEnabled",
                0,
                state.app_capture_enabled,
                RestoreRollbackActionType::RestoreGameMode,
            ),
        ],
    }
}

fn disable_xbox_game_bar_deep_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "disable-xbox-game-bar-deep",
            "Desligar Xbox Game Bar e captura",
            "Desliga painel inicial, Nexus Game Bar e captura Game DVR sem remover Xbox ou quebrar Game Pass.",
            AdvancedMethod::Registry,
            AdvancedRisk::Medium,
            false,
            false,
            true,
            true,
            false,
            format!(
                "ShowStartupPanel={}, UseNexus={}, GameDVR={}, FSEBehavior={}, AppCapture={}",
                display_optional(state.game_bar_show_startup_panel),
                display_optional(state.game_bar_use_nexus_for_game_bar_enabled),
                display_optional(state.game_dvr_enabled),
                display_optional(state.game_dvr_fse_behavior_mode),
                display_optional(state.app_capture_enabled)
            ),
            "Desligar Game Bar startup, Nexus e capturas em segundo plano",
            "PowerShell New-ItemProperty em HKCU GameBar/GameConfigStore/GameDVR",
        ),
        operations: vec![
            registry_dword(
                "HKCU:\\Software\\Microsoft\\GameBar",
                "ShowStartupPanel",
                0,
                state.game_bar_show_startup_panel,
                RestoreRollbackActionType::RestoreGameMode,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\GameBar",
                "UseNexusForGameBarEnabled",
                0,
                state.game_bar_use_nexus_for_game_bar_enabled,
                RestoreRollbackActionType::RestoreGameMode,
            ),
            registry_dword(
                "HKCU:\\System\\GameConfigStore",
                "GameDVR_Enabled",
                0,
                state.game_dvr_enabled,
                RestoreRollbackActionType::RestoreGameMode,
            ),
            registry_dword(
                "HKCU:\\System\\GameConfigStore",
                "GameDVR_FSEBehaviorMode",
                2,
                state.game_dvr_fse_behavior_mode,
                RestoreRollbackActionType::RestoreGameMode,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR",
                "AppCaptureEnabled",
                0,
                state.app_capture_enabled,
                RestoreRollbackActionType::RestoreGameMode,
            ),
        ],
    }
}

fn enable_game_dvr_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "enable-game-dvr",
            "Ativar captura Game DVR",
            "Restaura a captura nativa do Game DVR no usuario atual.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            format!(
                "GameDVR_Enabled={}, AppCaptureEnabled={}",
                display_optional(state.game_dvr_enabled),
                display_optional(state.app_capture_enabled)
            ),
            "Definir ambos como 1",
            "PowerShell New-ItemProperty em HKCU GameConfigStore/GameDVR",
        ),
        operations: vec![
            registry_dword(
                "HKCU:\\System\\GameConfigStore",
                "GameDVR_Enabled",
                1,
                state.game_dvr_enabled,
                RestoreRollbackActionType::RestoreGameMode,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR",
                "AppCaptureEnabled",
                1,
                state.app_capture_enabled,
                RestoreRollbackActionType::RestoreGameMode,
            ),
        ],
    }
}

fn disable_startup_delay_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "disable-startup-delay",
            "Reduzir atraso de inicializacao",
            "Define StartupDelayInMSec como 0 para reduzir atraso de apps no logon.",
            AdvancedMethod::Registry,
            AdvancedRisk::Medium,
            false,
            false,
            true,
            true,
            false,
            display_optional(state.startup_delay_in_msec),
            "Definir StartupDelayInMSec como 0",
            "PowerShell New-ItemProperty em HKCU Explorer\\Serialize",
        ),
        operations: vec![registry_dword(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize",
            "StartupDelayInMSec",
            0,
            state.startup_delay_in_msec,
            RestoreRollbackActionType::RestoreRegistryValue,
        )],
    }
}

fn registry_dword_tweak_plan(
    id: &str,
    title: &str,
    description: &str,
    risk: AdvancedRisk,
    path: &str,
    name: &str,
    value: i64,
    previous: Option<i64>,
    requires_restart: bool,
) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            id,
            title,
            description,
            AdvancedMethod::Registry,
            risk,
            false,
            false,
            true,
            true,
            requires_restart,
            display_optional(previous),
            &format!("Definir {name} como {value}"),
            &format!("PowerShell New-ItemProperty em {path}"),
        ),
        operations: vec![registry_dword(
            path,
            name,
            value,
            previous,
            RestoreRollbackActionType::RestoreRegistryValue,
        )],
    }
}

fn registry_string_tweak_plan(
    id: &str,
    title: &str,
    description: &str,
    risk: AdvancedRisk,
    path: &str,
    name: &str,
    value: &str,
    previous: Option<String>,
    requires_restart: bool,
) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            id,
            title,
            description,
            AdvancedMethod::Registry,
            risk,
            false,
            false,
            true,
            true,
            requires_restart,
            display_optional_string(previous.as_deref()),
            &format!("Definir {name} como {value}"),
            &format!("PowerShell New-ItemProperty em {path}"),
        ),
        operations: vec![registry_string(
            path,
            name,
            value,
            previous,
            RestoreRollbackActionType::RestoreRegistryValue,
        )],
    }
}

fn disable_advertising_id_plan(state: &RawAdvancedState) -> AdvancedPlan {
    registry_dword_tweak_plan(
        "disable-advertising-id",
        "Desativar ID de publicidade",
        "Desativa o identificador de publicidade do usuario para reduzir rastreamento local.",
        AdvancedRisk::Low,
        "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo",
        "Enabled",
        0,
        state.advertising_info_enabled,
        false,
    )
}

fn disable_tailored_experiences_plan(state: &RawAdvancedState) -> AdvancedPlan {
    registry_dword_tweak_plan(
        "disable-tailored-experiences",
        "Desativar experiencias personalizadas",
        "Impede sugestoes personalizadas baseadas em dados de diagnostico do Windows.",
        AdvancedRisk::Low,
        "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Privacy",
        "TailoredExperiencesWithDiagnosticDataEnabled",
        0,
        state.tailored_experiences_enabled,
        false,
    )
}

fn disable_consumer_features_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "disable-consumer-features",
            "Reduzir sugestoes e apps promovidos",
            "Desativa sugestoes, instalacoes silenciosas e conteudo promovido no usuario atual.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            format!(
                "ContentDelivery={}, SilentInstalledApps={}, Suggestions={}",
                display_optional(state.content_delivery_allowed),
                display_optional(state.silent_installed_apps_enabled),
                display_optional(state.system_pane_suggestions_enabled)
            ),
            "Definir recursos promovidos como 0",
            "PowerShell New-ItemProperty em HKCU ContentDeliveryManager",
        ),
        operations: vec![
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager",
                "ContentDeliveryAllowed",
                0,
                state.content_delivery_allowed,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager",
                "OemPreInstalledAppsEnabled",
                0,
                state.oem_preinstalled_apps_enabled,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager",
                "PreInstalledAppsEnabled",
                0,
                state.preinstalled_apps_enabled,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager",
                "SilentInstalledAppsEnabled",
                0,
                state.silent_installed_apps_enabled,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager",
                "SystemPaneSuggestionsEnabled",
                0,
                state.system_pane_suggestions_enabled,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager",
                "SubscribedContent-338388Enabled",
                0,
                state.subscribed_content_338388_enabled,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager",
                "SubscribedContent-338389Enabled",
                0,
                state.subscribed_content_338389_enabled,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
        ],
    }
}

fn disable_activity_history_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "disable-activity-history",
            "Desativar historico de atividades",
            "Desativa publicacao e envio de atividades do usuario no Windows.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            format!(
                "PublishUserActivities={}, UploadUserActivities={}",
                display_optional(state.publish_user_activities),
                display_optional(state.upload_user_activities)
            ),
            "Definir PublishUserActivities e UploadUserActivities como 0",
            "PowerShell New-ItemProperty em HKCU Policies\\Microsoft\\Windows\\System",
        ),
        operations: vec![
            registry_dword(
                "HKCU:\\Software\\Policies\\Microsoft\\Windows\\System",
                "PublishUserActivities",
                0,
                state.publish_user_activities,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKCU:\\Software\\Policies\\Microsoft\\Windows\\System",
                "UploadUserActivities",
                0,
                state.upload_user_activities,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
        ],
    }
}

fn disable_location_tracking_plan(state: &RawAdvancedState) -> AdvancedPlan {
    registry_string_tweak_plan(
        "disable-location-tracking",
        "Bloquear localizacao para apps",
        "Define consentimento de localizacao do usuario como Deny.",
        AdvancedRisk::Medium,
        "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\location",
        "Value",
        "Deny",
        state.location_consent_value.clone(),
        false,
    )
}

fn disable_storage_sense_auto_cleanup_plan(state: &RawAdvancedState) -> AdvancedPlan {
    registry_dword_tweak_plan(
        "disable-storage-sense-auto-cleanup",
        "Desativar Storage Sense automatico",
        "Desativa limpeza automatica do Storage Sense para evitar remocoes inesperadas durante jogos.",
        AdvancedRisk::Low,
        "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\StorageSense\\Parameters\\StoragePolicy",
        "01",
        0,
        state.storage_sense_enabled,
        false,
    )
}

fn disable_background_apps_plan(state: &RawAdvancedState) -> AdvancedPlan {
    registry_dword_tweak_plan(
        "disable-background-apps",
        "Reduzir apps em segundo plano",
        "Bloqueia permissao global de apps em segundo plano no usuario atual para reduzir carga fora do jogo.",
        AdvancedRisk::Medium,
        "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications",
        "GlobalUserDisabled",
        1,
        state.background_apps_global_disabled,
        false,
    )
}

fn disable_notification_toasts_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "disable-notification-toasts",
            "Desativar notificacoes gamer",
            "Desativa banners/toasts de notificacao do Windows no usuario atual para reduzir interrupcoes durante jogos.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            format!(
                "ToastEnabled={}, NOC_GLOBAL_SETTING_TOASTS_ENABLED={}",
                display_optional(state.push_notifications_toast_enabled),
                display_optional(state.notification_toasts_enabled)
            ),
            "Definir notificacoes toast como 0",
            "PowerShell New-ItemProperty em HKCU PushNotifications/Notifications\\Settings",
        ),
        operations: vec![
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications",
                "ToastEnabled",
                0,
                state.push_notifications_toast_enabled,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings",
                "NOC_GLOBAL_SETTING_TOASTS_ENABLED",
                0,
                state.notification_toasts_enabled,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
        ],
    }
}

fn set_focus_assist_gamer_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "set-focus-assist-gamer",
            "Focus Assist gamer",
            "Reduz sons e notificacoes acima da tela bloqueada para manter foco durante jogos, sem desligar a central de seguranca.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            format!(
                "Sound={}, NotificationSound={}, AboveLock={}, CriticalAboveLock={}",
                display_optional(state.focus_assist_allow_sound),
                display_optional(state.focus_assist_allow_notification_sound),
                display_optional(state.focus_assist_allow_toasts_above_lock),
                display_optional(state.focus_assist_allow_critical_toasts_above_lock)
            ),
            "Aplicar foco gamer nas notificacoes do usuario atual",
            "PowerShell New-ItemProperty em HKCU Notifications\\Settings",
        ),
        operations: vec![
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings",
                "NOC_GLOBAL_SETTING_ALLOW_SOUND",
                0,
                state.focus_assist_allow_sound,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings",
                "NOC_GLOBAL_SETTING_ALLOW_NOTIFICATION_SOUND",
                0,
                state.focus_assist_allow_notification_sound,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings",
                "NOC_GLOBAL_SETTING_ALLOW_TOASTS_ABOVE_LOCK",
                0,
                state.focus_assist_allow_toasts_above_lock,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings",
                "NOC_GLOBAL_SETTING_ALLOW_CRITICAL_TOASTS_ABOVE_LOCK",
                0,
                state.focus_assist_allow_critical_toasts_above_lock,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
        ],
    }
}

fn disable_recall_user_plan(state: &RawAdvancedState) -> AdvancedPlan {
    registry_dword_tweak_plan(
        "disable-recall-user",
        "Desativar Recall no usuario",
        "Aplica politica de usuario para impedir analise local do Recall quando disponivel.",
        AdvancedRisk::Medium,
        "HKCU:\\Software\\Policies\\Microsoft\\Windows\\WindowsAI",
        "DisableAIDataAnalysis",
        1,
        state.recall_disable_ai_data_analysis,
        true,
    )
}

fn disable_hibernation_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "disable-hibernation",
            "Desativar hibernacao",
            "Executa powercfg /hibernate off para liberar espaco do hiberfil.sys e reduzir estados de energia pesados.",
            AdvancedMethod::Cmd,
            AdvancedRisk::Medium,
            true,
            false,
            true,
            true,
            false,
            display_optional(state.hibernate_enabled),
            "Executar powercfg /hibernate off",
            "cmd: powercfg /hibernate off",
        ),
        operations: vec![AdvancedOperation::Cmd {
            program: "powercfg".to_string(),
            args: vec!["/hibernate".to_string(), "off".to_string()],
            transient: false,
        }],
    }
}

fn set_boot_timeout_fast_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "set-boot-timeout-fast",
            "Boot menu rapido",
            "Define o timeout do menu de boot para 5 segundos quando houver menu de inicializacao, sem limitar processadores ou memoria.",
            AdvancedMethod::Cmd,
            AdvancedRisk::Medium,
            true,
            false,
            true,
            true,
            true,
            state
                .boot_timeout_seconds
                .map(|value| format!("{value} segundos"))
                .unwrap_or_else(|| "Nao detectado".to_string()),
            "Executar bcdedit /timeout 5",
            "cmd: bcdedit /timeout 5",
        ),
        operations: vec![AdvancedOperation::Cmd {
            program: "bcdedit".to_string(),
            args: vec!["/timeout".to_string(), "5".to_string()],
            transient: false,
        }],
    }
}

fn flush_dns_cache_plan() -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "flush-dns-cache",
            "Limpar cache DNS",
            "Executa ipconfig /flushdns para limpar cache DNS local. Acao transiente, sem ajuste persistente.",
            AdvancedMethod::Cmd,
            AdvancedRisk::Low,
            false,
            false,
            true,
            false,
            false,
            "Cache DNS atual".to_string(),
            "Executar ipconfig /flushdns",
            "cmd: ipconfig /flushdns",
        ),
        operations: vec![AdvancedOperation::Cmd {
            program: "ipconfig".to_string(),
            args: vec!["/flushdns".to_string()],
            transient: true,
        }],
    }
}

fn dism_analyze_component_store_plan() -> AdvancedPlan {
    dism_cmd_plan(
        "dism-analyze-component-store",
        "Analisar componentes do Windows",
        "Executa DISM AnalyzeComponentStore para medir residuos de atualizacoes antes da limpeza.",
        AdvancedRisk::Low,
        &["/online", "/cleanup-image", "/analyzecomponentstore"],
        "DISM analisa o armazenamento de componentes",
        "cmd: dism /online /cleanup-image /analyzecomponentstore",
        false,
    )
}

fn dism_start_component_cleanup_plan() -> AdvancedPlan {
    dism_cmd_plan(
        "dism-start-component-cleanup",
        "Limpar componentes do Windows Update",
        "Executa DISM StartComponentCleanup para remover residuos antigos de atualizacoes do Windows.",
        AdvancedRisk::Medium,
        &["/online", "/cleanup-image", "/startcomponentcleanup"],
        "DISM limpa o armazenamento de componentes",
        "cmd: dism /online /cleanup-image /startcomponentcleanup",
        true,
    )
}

fn winsock_reset_plan() -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "winsock-reset",
            "Resetar Winsock",
            "Executa netsh winsock reset para reconstruir o catalogo de rede. Requer reinicio.",
            AdvancedMethod::Cmd,
            AdvancedRisk::Medium,
            true,
            false,
            true,
            true,
            true,
            "Catalogo Winsock atual",
            "Executar netsh winsock reset",
            "cmd: netsh winsock reset",
        ),
        operations: vec![AdvancedOperation::Cmd {
            program: "netsh".to_string(),
            args: vec!["winsock".to_string(), "reset".to_string()],
            transient: false,
        }],
    }
}

fn reset_ip_stack_plan() -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "reset-ip-stack",
            "Resetar pilha TCP/IP",
            "Executa netsh int ip reset para limpar configuracoes corrompidas de rede. Requer reinicio.",
            AdvancedMethod::Cmd,
            AdvancedRisk::Medium,
            true,
            false,
            true,
            true,
            true,
            "Pilha TCP/IP atual",
            "Executar netsh int ip reset",
            "cmd: netsh int ip reset",
        ),
        operations: vec![AdvancedOperation::Cmd {
            program: "netsh".to_string(),
            args: vec!["int".to_string(), "ip".to_string(), "reset".to_string()],
            transient: false,
        }],
    }
}

fn netsh_tcp_global_plan(
    id: &str,
    title: &str,
    description: &str,
    setting: &str,
    command_preview: &str,
) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            id,
            title,
            description,
            AdvancedMethod::Cmd,
            AdvancedRisk::Medium,
            true,
            false,
            true,
            true,
            false,
            "Estado TCP global atual",
            &format!("Definir {setting}"),
            command_preview,
        ),
        operations: vec![AdvancedOperation::Cmd {
            program: "netsh".to_string(),
            args: vec![
                "int".to_string(),
                "tcp".to_string(),
                "set".to_string(),
                "global".to_string(),
                setting.to_string(),
            ],
            transient: false,
        }],
    }
}

fn set_service_manual_plan(
    id: &str,
    title: &str,
    description: &str,
    service_name: &str,
    current_mode: Option<&str>,
) -> AdvancedPlan {
    let service_detected = current_mode.is_some();
    let planned_change = if service_detected {
        "Definir inicializacao como Sob demanda"
    } else {
        "Servico nao detectado neste Windows; sem comando"
    };
    let command_preview = if service_detected {
        format!("cmd: sc.exe config {service_name} start= demand")
    } else {
        format!("indisponivel: {service_name} nao detectado")
    };
    let operations = if service_detected {
        vec![AdvancedOperation::Cmd {
            program: "sc.exe".to_string(),
            args: vec![
                "config".to_string(),
                service_name.to_string(),
                "start=".to_string(),
                "demand".to_string(),
            ],
            transient: false,
        }]
    } else {
        Vec::new()
    };

    AdvancedPlan {
        action: action(
            id,
            title,
            description,
            AdvancedMethod::Cmd,
            AdvancedRisk::Medium,
            true,
            false,
            true,
            true,
            false,
            current_mode.unwrap_or("Nao detectado"),
            planned_change,
            &command_preview,
        ),
        operations,
    }
}

fn service_start_mode(state: &RawAdvancedState, service_name: &str) -> Option<String> {
    state
        .optional_service_start_modes
        .iter()
        .find(|item| item.name.eq_ignore_ascii_case(service_name))
        .and_then(|item| item.start_mode.clone())
}

fn dism_check_netfx3_plan() -> AdvancedPlan {
    dism_cmd_plan(
        "dism-check-netfx3",
        "Verificar .NET Framework 3.5",
        "Consulta o estado do recurso NetFx3, usado por jogos e dependencias antigas.",
        AdvancedRisk::Low,
        &["/online", "/get-featureinfo", "/featurename:NetFx3"],
        "DISM consulta NetFx3",
        "cmd: dism /online /get-featureinfo /featurename:NetFx3",
        false,
    )
}

fn dism_check_directplay_plan() -> AdvancedPlan {
    dism_cmd_plan(
        "dism-check-directplay",
        "Verificar DirectPlay",
        "Consulta o estado do DirectPlay antes de preparar dependencias legadas de jogos.",
        AdvancedRisk::Low,
        &["/online", "/get-featureinfo", "/featurename:DirectPlay"],
        "DISM consulta DirectPlay",
        "cmd: dism /online /get-featureinfo /featurename:DirectPlay",
        false,
    )
}

fn dism_enable_directplay_plan() -> AdvancedPlan {
    dism_cmd_plan(
        "dism-enable-directplay",
        "Ativar DirectPlay",
        "Ativa o recurso DirectPlay para compatibilidade de jogos quando o Windows permitir.",
        AdvancedRisk::Medium,
        &[
            "/online",
            "/enable-feature",
            "/featurename:DirectPlay",
            "/all",
            "/norestart",
        ],
        "DISM habilita DirectPlay sem reiniciar automaticamente",
        "cmd: dism /online /enable-feature /featurename:DirectPlay /all /norestart",
        true,
    )
}

fn dism_cmd_plan(
    id: &str,
    title: &str,
    description: &str,
    risk: AdvancedRisk,
    args: &[&str],
    planned_change: &str,
    command_preview: &str,
    requires_restart: bool,
) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            id,
            title,
            description,
            AdvancedMethod::Cmd,
            risk,
            true,
            false,
            true,
            false,
            requires_restart,
            "Estado sera validado pelo DISM".to_string(),
            planned_change,
            command_preview,
        ),
        operations: vec![AdvancedOperation::Cmd {
            program: "dism".to_string(),
            args: args.iter().map(|item| item.to_string()).collect(),
            transient: true,
        }],
    }
}

fn allow_hermes_defender_exclusion_plan(state: &RawAdvancedState) -> Option<AdvancedPlan> {
    let executable_path = current_hermes_executable_path().ok()?;
    if !is_allowed_hermes_executable_path(&executable_path) {
        return None;
    }

    let already_excluded = state
        .defender_exclusion_paths
        .iter()
        .any(|item| paths_equal_ignore_case(item, &executable_path));
    let current_value = if already_excluded {
        "NEX já está nas exclusões do Defender"
    } else {
        "NEX ainda não está nas exclusões do Defender"
    };

    Some(AdvancedPlan {
        action: action(
            "allow-hermes-defender-exclusion",
            "Liberar NEX no Defender",
            "Adiciona somente o executável atual do NEX as exclusoes do Windows Defender para evitar falso positivo.",
            AdvancedMethod::PowerShell,
            AdvancedRisk::Medium,
            true,
            false,
            true,
            true,
            false,
            current_value,
            "Adicionar exclusao ExclusionPath apenas para NEX Optimizer.exe",
            "PowerShell Add-MpPreference -ExclusionPath <NEX>",
        ),
        operations: vec![AdvancedOperation::DefenderPathExclusion {
            path: executable_path,
            already_excluded,
        }],
    })
}

fn set_dns_provider_plan(
    state: &RawAdvancedState,
    id: &str,
    provider_label: &str,
    servers: &[&str],
) -> AdvancedPlan {
    let server_list = servers
        .iter()
        .map(|item| item.to_string())
        .collect::<Vec<_>>();
    AdvancedPlan {
        action: action(
            id,
            &format!("Aplicar DNS {provider_label}"),
            "Define DNS IPv4 nos adaptadores ativos com gateway e limpa o cache DNS.",
            AdvancedMethod::PowerShell,
            AdvancedRisk::Medium,
            false,
            false,
            true,
            true,
            false,
            current_dns_state(state),
            &format!("Definir DNS para {}", server_list.join(", ")),
            "PowerShell Set-DnsClientServerAddress + ipconfig /flushdns",
        ),
        operations: vec![AdvancedOperation::DnsProvider {
            provider_id: id.to_string(),
            provider_label: provider_label.to_string(),
            servers: server_list,
            previous_interfaces: state.dns_interfaces.clone(),
        }],
    }
}

fn list_power_plans_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "list-power-plans",
            "Listar planos de energia",
            "Executa powercfg /L para registrar localmente os planos de energia disponiveis. Nao altera o sistema.",
            AdvancedMethod::Cmd,
            AdvancedRisk::Low,
            false,
            false,
            true,
            false,
            false,
            current_power_plan(state),
            "Executar leitura powercfg /L",
            "cmd: powercfg /L",
        ),
        operations: vec![AdvancedOperation::Cmd {
            program: "powercfg".to_string(),
            args: vec!["/L".to_string()],
            transient: true,
        }],
    }
}

fn set_power_plan_plan(
    state: &RawAdvancedState,
    id: &str,
    title: &str,
    description: &str,
    guid: &str,
    risk: AdvancedRisk,
) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            id,
            title,
            description,
            AdvancedMethod::Cmd,
            risk,
            false,
            false,
            state.power_plan_guid.is_some(),
            true,
            false,
            current_power_plan(state),
            "powercfg /S com rollback para plano anterior",
            &format!("cmd: powercfg /S {guid}"),
        ),
        operations: vec![AdvancedOperation::PowerPlan {
            guid: guid.to_string(),
            previous_guid: state.power_plan_guid.clone(),
            previous_name: state.power_plan_name.clone(),
        }],
    }
}

fn duplicate_ultimate_performance_power_plan(state: &RawAdvancedState) -> AdvancedPlan {
    let available = state
        .ultimate_performance_available
        .map(|item| if item { "Disponivel" } else { "Nao detectado" })
        .unwrap_or("Nao detectado");

    AdvancedPlan {
        action: action(
            "duplicate-ultimate-performance-power-plan",
            "Disponibilizar Ultimate Performance",
            "Cria/expoe o plano Ultimate Performance quando o Windows permitir. O fluxo comum continua usando Alto desempenho.",
            AdvancedMethod::Cmd,
            AdvancedRisk::Medium,
            true,
            false,
            false,
            true,
            false,
            available,
            "Executar powercfg /duplicatescheme Ultimate Performance",
            &format!("cmd: powercfg /duplicatescheme {ULTIMATE_PERFORMANCE_POWER_PLAN_GUID}"),
        ),
        operations: vec![AdvancedOperation::Cmd {
            program: "powercfg".to_string(),
            args: vec![
                "/duplicatescheme".to_string(),
                ULTIMATE_PERFORMANCE_POWER_PLAN_GUID.to_string(),
            ],
            transient: false,
        }],
    }
}

fn disable_usb_selective_suspend_plan(state: &RawAdvancedState) -> AdvancedPlan {
    power_setting_plan(
        "disable-usb-selective-suspend",
            "Desativar suspensao seletiva USB",
            "Desativa a suspensao seletiva USB no plano atual para reduzir cortes de perifericos durante jogos.",
        USB_SETTINGS_SUBGROUP_GUID,
        USB_SELECTIVE_SUSPEND_SETTING_GUID,
        0,
        0,
        state.usb_selective_suspend_ac.clone(),
        state.usb_selective_suspend_dc.clone(),
    )
}

fn disable_pcie_link_state_power_management_plan(state: &RawAdvancedState) -> AdvancedPlan {
    power_setting_plan(
        "disable-pcie-link-state-power-management",
        "Desativar economia PCIe",
            "Desativa o Link State Power Management no plano atual para priorizar estabilidade de GPU/NVMe durante jogos.",
        PCI_EXPRESS_SUBGROUP_GUID,
        PCIE_LINK_STATE_POWER_MANAGEMENT_SETTING_GUID,
        0,
        0,
        state.pcie_link_state_ac.clone(),
        state.pcie_link_state_dc.clone(),
    )
}

fn set_display_timeout_never_plan(state: &RawAdvancedState) -> AdvancedPlan {
    power_setting_plan(
        "set-display-timeout-never",
        "Manter tela sempre ligada",
        "Define o desligamento da tela como Nunca no plano atual, tanto na tomada quanto na bateria.",
        DISPLAY_SETTINGS_SUBGROUP_GUID,
        DISPLAY_IDLE_TIMEOUT_SETTING_GUID,
        0,
        0,
        state.display_idle_timeout_ac.clone(),
        state.display_idle_timeout_dc.clone(),
    )
}

fn check_timer_resolution_policy_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "check-timer-resolution-policy",
            "Timer resolution seguro",
            "Audita politica de timer do bootloader para evitar tweaks agressivos de HPET/dynamic tick. Nao instala driver e nao altera kernel.",
            AdvancedMethod::Cmd,
            AdvancedRisk::Low,
            true,
            false,
            true,
            false,
            false,
            state
                .timer_policy_summary
                .as_deref()
                .unwrap_or("BCDEdit ainda nao auditado"),
            "Executar leitura bcdedit /enum e manter politica segura",
            "cmd: bcdedit /enum",
        ),
        operations: vec![AdvancedOperation::Cmd {
            program: "bcdedit".to_string(),
            args: vec!["/enum".to_string()],
            transient: true,
        }],
    }
}

fn power_setting_plan(
    id: &str,
    title: &str,
    description: &str,
    subgroup_guid: &str,
    setting_guid: &str,
    ac_value: i64,
    dc_value: i64,
    previous_ac_value: Option<String>,
    previous_dc_value: Option<String>,
) -> AdvancedPlan {
    let reversible = previous_ac_value.is_some() && previous_dc_value.is_some();
    let current_value = format!(
        "AC={} | DC={}",
        previous_ac_value.as_deref().unwrap_or("Nao detectado"),
        previous_dc_value.as_deref().unwrap_or("Nao detectado")
    );

    AdvancedPlan {
        action: action(
            id,
            title,
            description,
            AdvancedMethod::Cmd,
            AdvancedRisk::Medium,
            true,
            false,
            reversible,
            true,
            false,
            current_value,
            &format!("Definir AC={ac_value} e DC={dc_value} no plano atual"),
            "cmd: powercfg /SETACVALUEINDEX + /SETDCVALUEINDEX SCHEME_CURRENT",
        ),
        operations: vec![AdvancedOperation::PowerSetting {
            id: id.to_string(),
            subgroup_guid: subgroup_guid.to_string(),
            setting_guid: setting_guid.to_string(),
            ac_value,
            dc_value,
            previous_ac_value,
            previous_dc_value,
        }],
    }
}

fn set_mmcss_gamer_pack_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "set-mmcss-gamer-pack",
            "MMCSS Gamer Pack",
            "Ajusta Multimedia SystemProfile para priorizar jogos com SystemResponsiveness, GPU Priority, Priority, Scheduling Category e SFIO Priority.",
            AdvancedMethod::Registry,
            AdvancedRisk::Medium,
            true,
            false,
            true,
            true,
            true,
            format!(
                "SystemResponsiveness={}, GPU Priority={}, Priority={}, Scheduling={}, SFIO={}",
                display_optional(state.mmcss_system_responsiveness),
                display_optional(state.mmcss_games_gpu_priority),
                display_optional(state.mmcss_games_priority),
                display_optional_string(state.mmcss_games_scheduling_category.as_deref()),
                display_optional_string(state.mmcss_games_sfio_priority.as_deref())
            ),
            "Aplicar perfil MMCSS gamer recomendado",
            "PowerShell New-ItemProperty em HKLM Multimedia\\SystemProfile\\Tasks\\Games",
        ),
        operations: vec![
            registry_dword(
                "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile",
                "SystemResponsiveness",
                0,
                state.mmcss_system_responsiveness,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games",
                "GPU Priority",
                8,
                state.mmcss_games_gpu_priority,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games",
                "Priority",
                6,
                state.mmcss_games_priority,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_string(
                "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games",
                "Scheduling Category",
                "High",
                state.mmcss_games_scheduling_category.clone(),
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_string(
                "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games",
                "SFIO Priority",
                "High",
                state.mmcss_games_sfio_priority.clone(),
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
        ],
    }
}

fn set_fate_trigger_cpu_priority_high_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "set-fate-trigger-cpu-priority-high",
            "Prioridade CPU do Fate Trigger",
            "Aplica IFEO PerfOptions para priorizar os executaveis conhecidos do Fate Trigger/UE5.",
            AdvancedMethod::Registry,
            AdvancedRisk::Medium,
            true,
            false,
            true,
            true,
            true,
            format!(
                "FateTrigger.exe={}, FateTrigger-Win64-Shipping.exe={}",
                display_optional(state.fate_trigger_cpu_priority),
                display_optional(state.fate_trigger_shipping_cpu_priority)
            ),
            "Definir CpuPriorityClass como 5 (High) para Fate Trigger",
            "PowerShell New-ItemProperty em HKLM Image File Execution Options\\FateTrigger*\\PerfOptions",
        ),
        operations: vec![
            // CpuPriorityClass scale for IFEO\PerfOptions: 1=Low, 2=Below Normal, 3=Normal,
            // 4=Above Normal, 5=High, 6=Realtime. This action promises "High" priority, so it
            // must write 5 - writing 3 (Normal) silently applied no boost at all.
            registry_dword(
                "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\FateTrigger.exe\\PerfOptions",
                "CpuPriorityClass",
                5,
                state.fate_trigger_cpu_priority,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\FateTrigger-Win64-Shipping.exe\\PerfOptions",
                "CpuPriorityClass",
                5,
                state.fate_trigger_shipping_cpu_priority,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
        ],
    }
}

fn check_gamer_dependencies_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "check-gamer-dependencies",
            "Verificar dependencias gamer",
            "Lê VC++ Redistributables e DirectX localmente antes de qualquer instalacao futura com hash/assinatura.",
            AdvancedMethod::PowerShell,
            AdvancedRisk::Low,
            false,
            false,
            true,
            false,
            false,
            state
                .gamer_dependencies_summary
                .clone()
                .unwrap_or_else(|| "Dependencias ainda nao lidas".to_string()),
            "Checar VC++ 2005-2022 x86/x64 e DirectX End-User Runtime",
            "PowerShell Get-ItemProperty Uninstall + HKLM DirectX",
        ),
        operations: Vec::new(),
    }
}

fn graphics_high_performance_plan(
    executable_path: &str,
    previous_value: Option<String>,
) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "set-fate-trigger-graphics-high-performance",
            "Priorizar GPU do Fate Trigger",
            "Define o Fate Trigger em Elementos Graficos do Windows como Alto desempenho no usuario atual.",
            AdvancedMethod::Registry,
            AdvancedRisk::Medium,
            false,
            false,
            true,
            true,
            false,
            display_optional_string(previous_value.as_deref()),
            "Definir GpuPreference=2 para o executavel",
            "PowerShell New-ItemProperty em HKCU DirectX\\UserGpuPreferences",
        ),
        operations: vec![registry_string(
            "HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences",
            executable_path,
            "GpuPreference=2;",
            previous_value,
            RestoreRollbackActionType::RestoreRegistryValue,
        )],
    }
}

fn disable_transparency_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "disable-transparency",
            "Desativar transparencias",
            "Desativa transparencia visual do Windows para reduzir custo grafico leve.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            display_optional(state.enable_transparency),
            "Definir EnableTransparency como 0",
            "PowerShell New-ItemProperty em HKCU Themes\\Personalize",
        ),
        operations: vec![registry_dword(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
            "EnableTransparency",
            0,
            state.enable_transparency,
            RestoreRollbackActionType::RestoreVisualEffects,
        )],
    }
}

fn set_windows_dark_mode_plan(state: &RawAdvancedState) -> AdvancedPlan {
    let personalize_path =
        "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
    AdvancedPlan {
        action: action(
            "set-windows-dark-mode",
            "Ativar modo escuro do Windows",
            "Ativa o tema escuro nos aplicativos e na interface do Windows para o usuario atual.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            format!(
                "Aplicativos={} | Sistema={}",
                display_optional(state.apps_use_light_theme),
                display_optional(state.system_uses_light_theme)
            ),
            "Definir AppsUseLightTheme=0 e SystemUsesLightTheme=0",
            "PowerShell New-ItemProperty em HKCU Themes\\Personalize",
        ),
        operations: vec![
            registry_dword(
                personalize_path,
                "AppsUseLightTheme",
                0,
                state.apps_use_light_theme,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            registry_dword(
                personalize_path,
                "SystemUsesLightTheme",
                0,
                state.system_uses_light_theme,
                RestoreRollbackActionType::RestoreRegistryValue,
            ),
            AdvancedOperation::Cmd {
                program: "rundll32.exe".to_string(),
                args: vec!["user32.dll,UpdatePerUserSystemParameters".to_string()],
                transient: true,
            },
        ],
    }
}

fn disable_window_animations_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "disable-window-animations",
            "Reduzir animacoes visuais",
            "Desativa animacoes de janela, barra de tarefas e selecao suave do Explorer.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            format!(
                "MinAnimate={}, TaskbarAnimations={}, ListviewAlphaSelect={}",
                display_optional_string(state.min_animate.as_deref()),
                display_optional(state.taskbar_animations),
                display_optional(state.listview_alpha_select)
            ),
            "Definir animacoes como 0",
            "PowerShell New-ItemProperty em HKCU Desktop/Explorer",
        ),
        operations: vec![
            registry_string(
                "HKCU:\\Control Panel\\Desktop\\WindowMetrics",
                "MinAnimate",
                "0",
                state.min_animate.clone(),
                RestoreRollbackActionType::RestoreVisualEffects,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced",
                "TaskbarAnimations",
                0,
                state.taskbar_animations,
                RestoreRollbackActionType::RestoreVisualEffects,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced",
                "ListviewAlphaSelect",
                0,
                state.listview_alpha_select,
                RestoreRollbackActionType::RestoreVisualEffects,
            ),
        ],
    }
}

fn disable_visual_shadows_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "disable-visual-shadows",
            "Reduzir sombras do Explorer",
            "Desativa sombras de lista do Explorer mantendo rollback pelo snapshot.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            display_optional(state.listview_shadow),
            "Definir ListviewShadow como 0",
            "PowerShell New-ItemProperty em HKCU Explorer\\Advanced",
        ),
        operations: vec![registry_dword(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced",
            "ListviewShadow",
            0,
            state.listview_shadow,
            RestoreRollbackActionType::RestoreVisualEffects,
        )],
    }
}

fn set_visual_effects_custom_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "set-visual-effects-custom",
            "Marcar efeitos visuais como personalizados",
            "Define VisualFXSetting como personalizado para manter coerencia com ajustes visuais especificos.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            display_optional(state.visual_fx_setting),
            "Definir VisualFXSetting como 3",
            "PowerShell New-ItemProperty em HKCU Explorer\\VisualEffects",
        ),
        operations: vec![registry_dword(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects",
            "VisualFXSetting",
            3,
            state.visual_fx_setting,
            RestoreRollbackActionType::RestoreVisualEffects,
        )],
    }
}

fn set_visual_effects_gamer_minimal_plan(state: &RawAdvancedState) -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "set-visual-effects-gamer-minimal",
            "Visual Gamer minimo",
            "Replica o preset visual recomendado: somente conteudo ao arrastar, miniaturas e fontes suaves ficam ativos.",
            AdvancedMethod::Registry,
            AdvancedRisk::Low,
            false,
            false,
            true,
            true,
            false,
            format!(
                "DragFullWindows={}, IconsOnly={}, FontSmoothing={}",
                display_optional_string(state.drag_full_windows.as_deref()),
                display_optional(state.icons_only),
                display_optional_string(state.font_smoothing.as_deref())
            ),
            "Manter 3 efeitos ativos e desligar animacoes/transparencias/sombras",
            "PowerShell New-ItemProperty em HKCU Desktop/Explorer/DWM",
        ),
        operations: vec![
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects",
                "VisualFXSetting",
                3,
                state.visual_fx_setting,
                RestoreRollbackActionType::RestoreVisualEffects,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
                "EnableTransparency",
                0,
                state.enable_transparency,
                RestoreRollbackActionType::RestoreVisualEffects,
            ),
            registry_string(
                "HKCU:\\Control Panel\\Desktop",
                "DragFullWindows",
                "1",
                state.drag_full_windows.clone(),
                RestoreRollbackActionType::RestoreVisualEffects,
            ),
            registry_string(
                "HKCU:\\Control Panel\\Desktop",
                "FontSmoothing",
                "2",
                state.font_smoothing.clone(),
                RestoreRollbackActionType::RestoreVisualEffects,
            ),
            registry_string(
                "HKCU:\\Control Panel\\Desktop\\WindowMetrics",
                "MinAnimate",
                "0",
                state.min_animate.clone(),
                RestoreRollbackActionType::RestoreVisualEffects,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced",
                "IconsOnly",
                0,
                state.icons_only,
                RestoreRollbackActionType::RestoreVisualEffects,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced",
                "TaskbarAnimations",
                0,
                state.taskbar_animations,
                RestoreRollbackActionType::RestoreVisualEffects,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced",
                "ListviewAlphaSelect",
                0,
                state.listview_alpha_select,
                RestoreRollbackActionType::RestoreVisualEffects,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced",
                "ListviewShadow",
                0,
                state.listview_shadow,
                RestoreRollbackActionType::RestoreVisualEffects,
            ),
            registry_dword(
                "HKCU:\\Software\\Microsoft\\Windows\\DWM",
                "EnableAeroPeek",
                0,
                state.enable_aero_peek,
                RestoreRollbackActionType::RestoreVisualEffects,
            ),
        ],
    }
}

fn open_performance_options_plan() -> AdvancedPlan {
    AdvancedPlan {
        action: action(
            "open-performance-options",
            "Abrir Opcoes de desempenho do Windows",
            "Abre a ferramenta nativa de desempenho do Windows. Nao altera configuracoes automaticamente.",
            AdvancedMethod::Cmd,
            AdvancedRisk::Low,
            false,
            false,
            true,
            false,
            false,
            "Ferramenta nativa fechada".to_string(),
            "Abrir sysdm.cpl na aba Avancado",
            "cmd: rundll32 shell32.dll,Control_RunDLL sysdm.cpl,,3",
        ),
        operations: vec![AdvancedOperation::Cmd {
            program: "rundll32.exe".to_string(),
            args: vec![
                "shell32.dll,Control_RunDLL".to_string(),
                "sysdm.cpl,,3".to_string(),
            ],
            transient: true,
        }],
    }
}

fn action(
    id: &str,
    title: &str,
    description: &str,
    method: AdvancedMethod,
    risk: AdvancedRisk,
    requires_admin: bool,
    requires_extreme: bool,
    reversible: bool,
    persistent: bool,
    requires_restart: bool,
    current_value: impl Into<String>,
    planned_change: &str,
    command_preview: &str,
) -> AdvancedAction {
    AdvancedAction {
        id: id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        method,
        risk,
        requires_admin,
        requires_extreme,
        reversible,
        persistent,
        requires_restart,
        current_value: current_value.into(),
        planned_change: planned_change.to_string(),
        command_preview: command_preview.to_string(),
    }
}

fn registry_dword(
    path: &str,
    name: &str,
    value: i64,
    previous: Option<i64>,
    rollback_type: RestoreRollbackActionType,
) -> AdvancedOperation {
    AdvancedOperation::RegistryDword {
        path: path.to_string(),
        name: name.to_string(),
        value,
        previous_value: Some(
            previous
                .map(|item| item.to_string())
                .unwrap_or_else(|| MISSING_REGISTRY_VALUE.to_string()),
        ),
        rollback_type,
    }
}

fn registry_string(
    path: &str,
    name: &str,
    value: &str,
    previous: Option<String>,
    rollback_type: RestoreRollbackActionType,
) -> AdvancedOperation {
    AdvancedOperation::RegistryString {
        path: path.to_string(),
        name: name.to_string(),
        value: value.to_string(),
        previous_value: Some(previous.unwrap_or_else(|| MISSING_REGISTRY_VALUE.to_string())),
        rollback_type,
    }
}

fn blocked_actions() -> Vec<AdvancedBlockedAction> {
    let mut actions = vec![
        blocked(
            "chkdsk-repair",
            "chkdsk C: /f /r",
            "Bloqueado nesta fase: pode exigir reinicio, travar volume e demorar muito.",
            AdvancedMethod::Cmd,
            AdvancedRisk::High,
            true,
            true,
        ),
        blocked(
            "defrag-optimize",
            "defrag C: /O",
            "Bloqueado nesta fase: Windows ja agenda otimizacao e SSD/NVMe exigem cuidado.",
            AdvancedMethod::Cmd,
            AdvancedRisk::High,
            true,
            true,
        ),
        blocked(
            "disable-windows-update",
            "Desabilitar Windows Update permanentemente",
            "Bloqueado: o NEX não desativa atualizações de segurança de forma permanente.",
            AdvancedMethod::PowerShell,
            AdvancedRisk::High,
            true,
            true,
        ),
        blocked(
            "disable-defender",
            "Desabilitar Defender permanentemente",
            "Bloqueado: reduzir protecao permanente do Windows fica fora da filosofia segura.",
            AdvancedMethod::PowerShell,
            AdvancedRisk::High,
            true,
            true,
        ),
        blocked(
            "delete-user-files",
            "Apagar arquivos pessoais",
            "Bloqueado: Downloads, Documentos, Desktop, Imagens e Videos nunca entram no Advanced Engine.",
            AdvancedMethod::PowerShell,
            AdvancedRisk::High,
            true,
            true,
        ),
        blocked(
            "remove-programs",
            "Remover programas",
            "Bloqueado: o NEX pode desabilitar inicialização em engine propria, mas nao remove softwares.",
            AdvancedMethod::PowerShell,
            AdvancedRisk::High,
            true,
            true,
        ),
        blocked(
            "free-registry-delete",
            "Deletar chaves de Registro fora da allowlist",
            "Bloqueado: nenhuma chave fora da allowlist do Restore/Advanced pode ser removida.",
            AdvancedMethod::Registry,
            AdvancedRisk::High,
            true,
            true,
        ),
        blocked(
            "hklm-multimedia-tweaks",
            "Tweaks HKLM Multimedia/SystemProfile",
            "Bloqueado nesta fase: exige admin, afeta todo o sistema e precisa de backup dedicado.",
            AdvancedMethod::Registry,
            AdvancedRisk::High,
            true,
            true,
        ),
        blocked(
            "sfc-scan-now",
            "SFC /scannow automatico",
            "Fica para Centro de Reparo: exige confirmacao forte e nao deve rodar junto com otimizacoes.",
            AdvancedMethod::Cmd,
            AdvancedRisk::Medium,
            true,
            false,
        ),
        blocked(
            "dism-restore-health",
            "DISM RestoreHealth automatico",
            "Fica para Centro de Reparo: exige admin, pode demorar e nao deve rodar automaticamente.",
            AdvancedMethod::Cmd,
            AdvancedRisk::Medium,
            true,
            false,
        ),
        blocked(
            "msconfig-max-processors",
            "Limitar numero de processadores no boot",
            "Bloqueado: esta opcao do msconfig pode limitar a CPU em vez de otimizar. O NEX mantém processadores e memória sem teto artificial.",
            AdvancedMethod::Cmd,
            AdvancedRisk::High,
            true,
            true,
        ),
        blocked(
            "msconfig-max-memory",
            "Limitar memoria maxima no boot",
            "Bloqueado: esta opcao pode fazer o Windows iniciar com menos RAM disponivel. O NEX não aplica teto de memória.",
            AdvancedMethod::Cmd,
            AdvancedRisk::High,
            true,
            true,
        ),
        blocked(
            "disable-all-microsoft-services",
            "Desativar todos os servicos Microsoft",
            "Bloqueado: o NEX usa uma allowlist de servicos opcionais sob demanda e preserva seguranca, rede, audio, drivers, Windows Update e anticheat.",
            AdvancedMethod::Cmd,
            AdvancedRisk::High,
            true,
            true,
        ),
    ];
    actions.extend(blocked_gamer_dependency_installers());
    actions
}

fn blocked_gamer_dependency_installers() -> Vec<AdvancedBlockedAction> {
    [
        ("vc-redist-2005-x86", "Instalar VC++ 2005 x86"),
        ("vc-redist-2005-x64", "Instalar VC++ 2005 x64"),
        ("vc-redist-2008-x86", "Instalar VC++ 2008 x86"),
        ("vc-redist-2008-x64", "Instalar VC++ 2008 x64"),
        ("vc-redist-2010-x86", "Instalar VC++ 2010 x86"),
        ("vc-redist-2010-x64", "Instalar VC++ 2010 x64"),
        ("vc-redist-2012-x86", "Instalar VC++ 2012 x86"),
        ("vc-redist-2012-x64", "Instalar VC++ 2012 x64"),
        ("vc-redist-2013-x86", "Instalar VC++ 2013 x86"),
        ("vc-redist-2013-x64", "Instalar VC++ 2013 x64"),
        ("vc-redist-2015-2022-x86", "Instalar VC++ 2015-2022 x86"),
        ("vc-redist-2015-2022-x64", "Instalar VC++ 2015-2022 x64"),
        ("directx-runtime", "Instalar DirectX End-User Runtime"),
    ]
    .into_iter()
    .map(|(id, title)| {
        blocked(
            id,
            title,
            "Bloqueado: instalador exige fonte oficial Microsoft, SHA256 esperado e assinatura Authenticode valida antes de executar.",
            AdvancedMethod::Cmd,
            AdvancedRisk::Medium,
            true,
            false,
        )
    })
    .collect()
}

fn blocked(
    id: &str,
    title: &str,
    reason: &str,
    method: AdvancedMethod,
    risk: AdvancedRisk,
    requires_admin: bool,
    requires_extreme: bool,
) -> AdvancedBlockedAction {
    AdvancedBlockedAction {
        id: id.to_string(),
        title: title.to_string(),
        reason: reason.to_string(),
        method,
        risk,
        requires_admin,
        requires_extreme,
    }
}

fn selected_action_ids(action_ids: Option<&[String]>) -> Vec<String> {
    action_ids
        .filter(|items| !items.is_empty())
        .map(|items| {
            items
                .iter()
                .map(|item| item.trim().to_string())
                .filter(|item| allowed_action_ids().contains(item))
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(default_action_ids)
}

fn default_action_ids() -> Vec<String> {
    vec![
        "enable-game-mode".to_string(),
        "disable-game-dvr".to_string(),
        "disable-xbox-game-bar-deep".to_string(),
        "disable-startup-delay".to_string(),
        "disable-advertising-id".to_string(),
        "disable-tailored-experiences".to_string(),
        "disable-consumer-features".to_string(),
        "disable-activity-history".to_string(),
        "disable-location-tracking".to_string(),
        "disable-background-apps".to_string(),
        "disable-notification-toasts".to_string(),
        "disable-recall-user".to_string(),
        "disable-hibernation".to_string(),
        "set-boot-timeout-fast".to_string(),
        "flush-dns-cache".to_string(),
        "dism-analyze-component-store".to_string(),
        "dism-start-component-cleanup".to_string(),
        "set-network-autotuning-normal".to_string(),
        "disable-network-ecn".to_string(),
        "enable-network-rss".to_string(),
        "dism-check-netfx3".to_string(),
        "dism-check-directplay".to_string(),
        "set-diagtrack-service-manual".to_string(),
        "set-mapsbroker-service-manual".to_string(),
        "set-wersvc-service-manual".to_string(),
        "set-wmpnetworksvc-service-manual".to_string(),
        "set-fax-service-manual".to_string(),
        "set-retaildemo-service-manual".to_string(),
        "set-phonesvc-service-manual".to_string(),
        "set-walletservice-manual".to_string(),
        "set-xbl-auth-manager-manual".to_string(),
        "set-xbl-game-save-manual".to_string(),
        "set-xbox-net-api-svc-manual".to_string(),
        "allow-hermes-defender-exclusion".to_string(),
        "set-dns-cloudflare".to_string(),
        "list-power-plans".to_string(),
        "set-high-performance-power-plan".to_string(),
        "set-display-timeout-never".to_string(),
        "set-windows-dark-mode".to_string(),
        "disable-usb-selective-suspend".to_string(),
        "disable-pcie-link-state-power-management".to_string(),
        "set-mmcss-gamer-pack".to_string(),
        "set-fate-trigger-cpu-priority-high".to_string(),
        "check-gamer-dependencies".to_string(),
        "disable-storage-sense-auto-cleanup".to_string(),
        "set-visual-effects-gamer-minimal".to_string(),
        "disable-transparency".to_string(),
        "disable-window-animations".to_string(),
        "disable-visual-shadows".to_string(),
        "set-visual-effects-custom".to_string(),
    ]
}

fn allowed_action_ids() -> Vec<String> {
    vec![
        "enable-game-mode".to_string(),
        "disable-game-mode".to_string(),
        "disable-game-dvr".to_string(),
        "disable-xbox-game-bar-deep".to_string(),
        "enable-game-dvr".to_string(),
        "disable-startup-delay".to_string(),
        "disable-advertising-id".to_string(),
        "disable-tailored-experiences".to_string(),
        "disable-consumer-features".to_string(),
        "disable-activity-history".to_string(),
        "disable-location-tracking".to_string(),
        "disable-storage-sense-auto-cleanup".to_string(),
        "disable-background-apps".to_string(),
        "disable-notification-toasts".to_string(),
        "disable-recall-user".to_string(),
        "disable-hibernation".to_string(),
        "set-boot-timeout-fast".to_string(),
        "flush-dns-cache".to_string(),
        "dism-analyze-component-store".to_string(),
        "dism-start-component-cleanup".to_string(),
        "dism-check-netfx3".to_string(),
        "dism-check-directplay".to_string(),
        "dism-enable-directplay".to_string(),
        "winsock-reset".to_string(),
        "reset-ip-stack".to_string(),
        "set-network-autotuning-normal".to_string(),
        "disable-network-ecn".to_string(),
        "enable-network-rss".to_string(),
        "set-diagtrack-service-manual".to_string(),
        "set-mapsbroker-service-manual".to_string(),
        "set-wersvc-service-manual".to_string(),
        "set-wmpnetworksvc-service-manual".to_string(),
        "set-fax-service-manual".to_string(),
        "set-retaildemo-service-manual".to_string(),
        "set-phonesvc-service-manual".to_string(),
        "set-walletservice-manual".to_string(),
        "set-xbl-auth-manager-manual".to_string(),
        "set-xbl-game-save-manual".to_string(),
        "set-xbox-net-api-svc-manual".to_string(),
        "allow-hermes-defender-exclusion".to_string(),
        "set-dns-cloudflare".to_string(),
        "set-dns-google".to_string(),
        "set-dns-opendns".to_string(),
        "set-dns-quad9".to_string(),
        "set-dns-adguard".to_string(),
        "list-power-plans".to_string(),
        "set-high-performance-power-plan".to_string(),
        "set-display-timeout-never".to_string(),
        "set-windows-dark-mode".to_string(),
        "set-balanced-power-plan".to_string(),
        "set-power-saver-power-plan".to_string(),
        "duplicate-ultimate-performance-power-plan".to_string(),
        "disable-usb-selective-suspend".to_string(),
        "disable-pcie-link-state-power-management".to_string(),
        "set-mmcss-gamer-pack".to_string(),
        "set-fate-trigger-cpu-priority-high".to_string(),
        "check-gamer-dependencies".to_string(),
        "set-visual-effects-gamer-minimal".to_string(),
        "disable-transparency".to_string(),
        "disable-window-animations".to_string(),
        "disable-visual-shadows".to_string(),
        "set-visual-effects-custom".to_string(),
        "open-performance-options".to_string(),
    ]
}

fn build_snapshot_request(plans: &[AdvancedPlan], dry_run: bool) -> RestoreCreateSnapshotRequest {
    let mode = if dry_run { "dry-run" } else { "aplicacao real" };
    RestoreCreateSnapshotRequest {
        name: Some("Advanced Engine - Snapshot de seguranca".to_string()),
        description: Some(format!(
            "Snapshot obrigatorio antes da {mode} de comandos avancados allowlistados."
        )),
        planned_actions: Some(plans.iter().map(plan_to_planned_action).collect()),
        rollback_manifest: Some(
            plans
                .iter()
                .flat_map(plan_to_rollback_actions)
                .collect::<Vec<_>>(),
        ),
        previous_state: Some(
            plans
                .iter()
                .flat_map(plan_to_previous_state)
                .collect::<Vec<_>>(),
        ),
    }
}

fn validate_plans_for_apply(
    plans: &[AdvancedPlan],
    extreme_mode: bool,
    dry_run: bool,
) -> Result<(), String> {
    for plan in plans {
        if plan.action.requires_admin && !dry_run && !is_process_elevated() {
            return Err(format!(
                "{} exige administrador. Abra o NEX como administrador para aplicar esta acao.",
                plan.action.title
            ));
        }

        if plan.action.requires_extreme && !extreme_mode {
            return Err(format!(
                "{} exige nivel Extremo e confirmacao forte.",
                plan.action.title
            ));
        }

        if !dry_run && plan.action.persistent && !plan.action.reversible {
            return Err(format!(
                "{} e persistente, mas nao possui rollback seguro.",
                plan.action.title
            ));
        }

        if matches!(plan.action.risk, AdvancedRisk::High) && !extreme_mode {
            return Err(format!(
                "{} possui risco alto e permanece bloqueada fora do modo Extremo.",
                plan.action.title
            ));
        }

        for operation in &plan.operations {
            validate_operation(operation)?;
        }
    }

    Ok(())
}

fn validate_operation(operation: &AdvancedOperation) -> Result<(), String> {
    match operation {
        AdvancedOperation::RegistryDword { path, name, .. }
        | AdvancedOperation::RegistryString { path, name, .. } => {
            if !is_advanced_allowed_registry_target(path, name) {
                return Err(format!(
                    "Registro fora da allowlist do Advanced Engine: {path}|{name}"
                ));
            }
            Ok(())
        }
        AdvancedOperation::PowerPlan {
            guid,
            previous_guid,
            ..
        } => {
            if !is_allowed_power_plan_guid(guid) {
                return Err("Plano de energia fora da allowlist NEX.".to_string());
            }
            if previous_guid.is_none() {
                return Err(
                    "Plano de energia atual indisponivel; rollback nao pode ser garantido."
                        .to_string(),
                );
            }
            Ok(())
        }
        AdvancedOperation::PowerSetting {
            subgroup_guid,
            setting_guid,
            ac_value,
            dc_value,
            ..
        } => {
            if is_allowed_power_setting(subgroup_guid, setting_guid, *ac_value)
                && is_allowed_power_setting(subgroup_guid, setting_guid, *dc_value)
            {
                Ok(())
            } else {
                Err("Ajuste powercfg fora da allowlist NEX.".to_string())
            }
        }
        AdvancedOperation::DnsProvider { servers, .. } => {
            if is_allowed_dns_servers(servers) {
                Ok(())
            } else {
                Err("Provedor DNS fora da allowlist NEX.".to_string())
            }
        }
        AdvancedOperation::DefenderPathExclusion { path, .. } => {
            if is_allowed_hermes_executable_path(path) {
                Ok(())
            } else {
                Err("Exclusao do Defender fora da allowlist NEX.".to_string())
            }
        }
        AdvancedOperation::Cmd { program, args, .. } => {
            if is_allowed_native_command(program, args) {
                Ok(())
            } else {
                Err("Comando nativo fora da allowlist NEX.".to_string())
            }
        }
    }
}

fn is_advanced_allowed_registry_target(path: &str, name: &str) -> bool {
    let normalized = path.replace('/', "\\").to_ascii_lowercase();
    let normalized_name = name.to_ascii_lowercase();
    if normalized == "hkcu:\\software\\microsoft\\directx\\usergpupreferences" {
        return is_allowed_graphics_preference_executable_path(name);
    }

    matches!(
        (normalized.as_str(), normalized_name.as_str()),
        ("hkcu:\\software\\microsoft\\gamebar", "autogamemodeenabled")
            | ("hkcu:\\software\\microsoft\\gamebar", "allowautogamemode")
            | ("hkcu:\\software\\microsoft\\gamebar", "showstartuppanel")
            | (
                "hkcu:\\software\\microsoft\\gamebar",
                "usenexusforgamebarenabled"
            )
            | ("hkcu:\\system\\gameconfigstore", "gamedvr_enabled")
            | (
                "hkcu:\\system\\gameconfigstore",
                "gamedvr_fsebehaviormode"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\gamedvr",
                "appcaptureenabled"
            )
            | (
                "hklm:\\software\\microsoft\\windows nt\\currentversion\\multimedia\\systemprofile",
                "systemresponsiveness"
            )
            | (
                "hklm:\\software\\microsoft\\windows nt\\currentversion\\multimedia\\systemprofile\\tasks\\games",
                "gpu priority"
            )
            | (
                "hklm:\\software\\microsoft\\windows nt\\currentversion\\multimedia\\systemprofile\\tasks\\games",
                "priority"
            )
            | (
                "hklm:\\software\\microsoft\\windows nt\\currentversion\\multimedia\\systemprofile\\tasks\\games",
                "scheduling category"
            )
            | (
                "hklm:\\software\\microsoft\\windows nt\\currentversion\\multimedia\\systemprofile\\tasks\\games",
                "sfio priority"
            )
            | (
                "hklm:\\software\\microsoft\\windows nt\\currentversion\\image file execution options\\fatetrigger.exe\\perfoptions",
                "cpupriorityclass"
            )
            | (
                "hklm:\\software\\microsoft\\windows nt\\currentversion\\image file execution options\\fatetrigger-win64-shipping.exe\\perfoptions",
                "cpupriorityclass"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\explorer\\serialize",
                "startupdelayinmsec"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\advertisinginfo",
                "enabled"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\privacy",
                "tailoredexperienceswithdiagnosticdataenabled"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\contentdeliverymanager",
                "contentdeliveryallowed"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\contentdeliverymanager",
                "oempreinstalledappsenabled"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\contentdeliverymanager",
                "preinstalledappsenabled"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\contentdeliverymanager",
                "silentinstalledappsenabled"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\contentdeliverymanager",
                "systempanesuggestionsenabled"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\contentdeliverymanager",
                "subscribedcontent-338388enabled"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\contentdeliverymanager",
                "subscribedcontent-338389enabled"
            )
            | (
                "hkcu:\\software\\policies\\microsoft\\windows\\system",
                "publishuseractivities"
            )
            | (
                "hkcu:\\software\\policies\\microsoft\\windows\\system",
                "uploaduseractivities"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\capabilityaccessmanager\\consentstore\\location",
                "value"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\storagesense\\parameters\\storagepolicy",
                "01"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\backgroundaccessapplications",
                "globaluserdisabled"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\pushnotifications",
                "toastenabled"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\notifications\\settings",
                "noc_global_setting_toasts_enabled"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\notifications\\settings",
                "noc_global_setting_allow_sound"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\notifications\\settings",
                "noc_global_setting_allow_notification_sound"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\notifications\\settings",
                "noc_global_setting_allow_toasts_above_lock"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\notifications\\settings",
                "noc_global_setting_allow_critical_toasts_above_lock"
            )
            | (
                "hkcu:\\software\\policies\\microsoft\\windows\\windowsai",
                "disableaidataanalysis"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\themes\\personalize",
                "enabletransparency"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\themes\\personalize",
                "appsuselighttheme"
            )
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\themes\\personalize",
                "systemuseslighttheme"
            )
            | ("hkcu:\\control panel\\desktop", "dragfullwindows")
            | ("hkcu:\\control panel\\desktop", "fontsmoothing")
            | ("hkcu:\\control panel\\desktop\\windowmetrics", "minanimate")
            | (
                "hkcu:\\software\\microsoft\\windows\\currentversion\\explorer\\advanced",
                "iconsonly"
            )
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
            | ("hkcu:\\software\\microsoft\\windows\\dwm", "enableaeropeek")
    )
}

fn plan_to_planned_action(plan: &AdvancedPlan) -> RestorePlannedAction {
    RestorePlannedAction {
        id: plan.action.id.clone(),
        engine: "Advanced Engine".to_string(),
        title: plan.action.title.clone(),
        description: plan.action.description.clone(),
        risk: match plan.action.risk {
            AdvancedRisk::Low => RestoreRiskLevel::Low,
            AdvancedRisk::Medium => RestoreRiskLevel::Medium,
            AdvancedRisk::High => RestoreRiskLevel::High,
        },
        will_modify_system: true,
        requires_admin: plan.action.requires_admin,
    }
}

fn plan_to_rollback_actions(plan: &AdvancedPlan) -> Vec<RestoreRollbackAction> {
    plan.operations
        .iter()
        .enumerate()
        .map(|(index, operation)| match operation {
            AdvancedOperation::RegistryDword {
                path,
                name,
                previous_value,
                rollback_type,
                ..
            } => RestoreRollbackAction {
                id: format!("rollback-{}-{}", plan.action.id, index + 1),
                action_type: rollback_type.clone(),
                target: format!("{path}|{name}|DWord"),
                description: format!("Restaurar {name} para o valor anterior."),
                previous_value: previous_value.clone(),
                backup_path: None,
                command_preview: Some(
                    "PowerShell New-ItemProperty -PropertyType DWord".to_string(),
                ),
                status: RestoreRollbackActionStatus::Pending,
            },
            AdvancedOperation::RegistryString {
                path,
                name,
                previous_value,
                rollback_type,
                ..
            } => RestoreRollbackAction {
                id: format!("rollback-{}-{}", plan.action.id, index + 1),
                action_type: rollback_type.clone(),
                target: format!("{path}|{name}|String"),
                description: format!("Restaurar {name} para o valor anterior."),
                previous_value: previous_value.clone(),
                backup_path: None,
                command_preview: Some(
                    "PowerShell New-ItemProperty -PropertyType String".to_string(),
                ),
                status: RestoreRollbackActionStatus::Pending,
            },
            AdvancedOperation::PowerPlan {
                previous_guid,
                previous_name,
                ..
            } => previous_guid
                .as_ref()
                .map(|guid| RestoreRollbackAction {
                    id: format!("rollback-{}-{}", plan.action.id, index + 1),
                    action_type: RestoreRollbackActionType::RestorePowerPlan,
                    target: guid.clone(),
                    description: "Restaurar plano de energia anterior.".to_string(),
                    previous_value: previous_name.clone(),
                    backup_path: None,
                    command_preview: Some(format!("powercfg /S {guid}")),
                    status: RestoreRollbackActionStatus::Pending,
                })
                .unwrap_or_else(|| RestoreRollbackAction {
                    id: format!("rollback-{}-{}", plan.action.id, index + 1),
                    action_type: RestoreRollbackActionType::Noop,
                    target: "power-plan-unavailable".to_string(),
                    description:
                        "Plano de energia anterior indisponivel. Rollback real nao pode ser preparado."
                            .to_string(),
                    previous_value: None,
                    backup_path: None,
                    command_preview: Some("No-op".to_string()),
                    status: RestoreRollbackActionStatus::Pending,
                }),
            AdvancedOperation::PowerSetting {
                subgroup_guid,
                setting_guid,
                previous_ac_value,
                previous_dc_value,
                ..
            } => RestoreRollbackAction {
                id: format!("rollback-{}-{}", plan.action.id, index + 1),
                action_type: RestoreRollbackActionType::RestorePowerSetting,
                target: format!("{subgroup_guid}|{setting_guid}"),
                description: "Restaurar valores AC/DC anteriores do plano de energia.".to_string(),
                previous_value: Some(format!(
                    "AC={}|DC={}",
                    previous_ac_value
                        .clone()
                        .unwrap_or_else(|| "Nao detectado".to_string()),
                    previous_dc_value
                        .clone()
                        .unwrap_or_else(|| "Nao detectado".to_string())
                )),
                backup_path: None,
                command_preview: Some(
                    "powercfg /SETACVALUEINDEX + /SETDCVALUEINDEX".to_string(),
                ),
                status: RestoreRollbackActionStatus::Pending,
            },
            AdvancedOperation::DnsProvider {
                provider_label,
                servers,
                previous_interfaces,
                ..
            } => RestoreRollbackAction {
                id: format!("rollback-{}-{}", plan.action.id, index + 1),
                action_type: RestoreRollbackActionType::Custom,
                target: "dns-active-adapters".to_string(),
                description: format!(
                    "Restaurar DNS anterior apos aplicar {provider_label}. Interfaces capturadas: {}.",
                    previous_interfaces.len()
                ),
                previous_value: Some(previous_dns_state(previous_interfaces)),
                backup_path: None,
                command_preview: Some(format!(
                    "Set-DnsClientServerAddress -ServerAddresses {}",
                    servers.join(",")
                )),
                status: RestoreRollbackActionStatus::Pending,
            },
            AdvancedOperation::DefenderPathExclusion {
                path,
                already_excluded,
            } => {
                if *already_excluded {
                    RestoreRollbackAction {
                        id: format!("rollback-{}-{}", plan.action.id, index + 1),
                        action_type: RestoreRollbackActionType::Noop,
                        target: path.clone(),
                        description:
                            "Exclusão do Defender já existia antes do NEX executar a ação."
                                .to_string(),
                        previous_value: Some("already-excluded".to_string()),
                        backup_path: None,
                        command_preview: Some("No-op".to_string()),
                        status: RestoreRollbackActionStatus::Pending,
                    }
                } else {
                    RestoreRollbackAction {
                        id: format!("rollback-{}-{}", plan.action.id, index + 1),
                        action_type: RestoreRollbackActionType::RemoveDefenderExclusion,
                        target: path.clone(),
                        description:
                            "Remover a exclusao do executável NEX no Windows Defender."
                                .to_string(),
                        previous_value: Some("not-excluded".to_string()),
                        backup_path: None,
                        command_preview: Some("Remove-MpPreference -ExclusionPath".to_string()),
                        status: RestoreRollbackActionStatus::Pending,
                    }
                }
            }
            AdvancedOperation::Cmd { transient, .. } => RestoreRollbackAction {
                id: format!("rollback-{}-{}", plan.action.id, index + 1),
                action_type: RestoreRollbackActionType::Noop,
                target: if *transient {
                    "transient-command".to_string()
                } else {
                    "cmd-command".to_string()
                },
                description: if *transient {
                    "Comando transiente sem estado persistente. Nenhuma reversao e necessaria."
                        .to_string()
                } else {
                    "Comando CMD allowlistado sem rollback persistente.".to_string()
                },
                previous_value: None,
                backup_path: None,
                command_preview: Some("No-op".to_string()),
                status: RestoreRollbackActionStatus::Pending,
            },
        })
        .collect()
}

fn plan_to_previous_state(plan: &AdvancedPlan) -> Vec<RestorePreviousState> {
    plan.operations
        .iter()
        .enumerate()
        .map(|(index, operation)| match operation {
            AdvancedOperation::RegistryDword {
                path,
                name,
                previous_value,
                ..
            } => RestorePreviousState {
                key: format!("{}:{}:{}", plan.action.id, path, name),
                category: previous_state_category_for_operation(operation),
                value: previous_value
                    .clone()
                    .unwrap_or_else(|| MISSING_REGISTRY_VALUE.to_string()),
                source: "Advanced Engine".to_string(),
                captured: true,
            },
            AdvancedOperation::RegistryString {
                path,
                name,
                previous_value,
                ..
            } => RestorePreviousState {
                key: format!("{}:{}:{}", plan.action.id, path, name),
                category: previous_state_category_for_operation(operation),
                value: previous_value
                    .clone()
                    .unwrap_or_else(|| MISSING_REGISTRY_VALUE.to_string()),
                source: "Advanced Engine".to_string(),
                captured: true,
            },
            AdvancedOperation::PowerPlan {
                previous_guid,
                previous_name,
                ..
            } => RestorePreviousState {
                key: format!("{}:power-plan", plan.action.id),
                category: RestorePreviousStateCategory::PowerPlan,
                value: format!(
                    "{} | {}",
                    previous_name
                        .clone()
                        .unwrap_or_else(|| "Plano desconhecido".to_string()),
                    previous_guid
                        .clone()
                        .unwrap_or_else(|| "GUID indisponivel".to_string())
                ),
                source: "powercfg /GETACTIVESCHEME".to_string(),
                captured: previous_guid.is_some(),
            },
            AdvancedOperation::PowerSetting {
                id,
                previous_ac_value,
                previous_dc_value,
                ..
            } => RestorePreviousState {
                key: format!("{}:power-setting:{id}", plan.action.id),
                category: RestorePreviousStateCategory::Metadata,
                value: format!(
                    "AC={} | DC={}",
                    previous_ac_value
                        .clone()
                        .unwrap_or_else(|| "Nao detectado".to_string()),
                    previous_dc_value
                        .clone()
                        .unwrap_or_else(|| "Nao detectado".to_string())
                ),
                source: "powercfg /Q SCHEME_CURRENT".to_string(),
                captured: previous_ac_value.is_some() || previous_dc_value.is_some(),
            },
            AdvancedOperation::DnsProvider {
                provider_id,
                previous_interfaces,
                ..
            } => RestorePreviousState {
                key: format!("{}:dns", plan.action.id),
                category: RestorePreviousStateCategory::Metadata,
                value: previous_dns_state(previous_interfaces),
                source: format!("Get-DnsClientServerAddress antes de {provider_id}"),
                captured: !previous_interfaces.is_empty(),
            },
            AdvancedOperation::DefenderPathExclusion {
                path,
                already_excluded,
            } => RestorePreviousState {
                key: format!("{}:defender-exclusion", plan.action.id),
                category: RestorePreviousStateCategory::Metadata,
                value: if *already_excluded {
                    "already-excluded".to_string()
                } else {
                    "not-excluded".to_string()
                },
                source: format!("Get-MpPreference ExclusionPath para {path}"),
                captured: true,
            },
            AdvancedOperation::Cmd { program, args, .. } => RestorePreviousState {
                key: format!("{}:cmd:{}", plan.action.id, index + 1),
                category: RestorePreviousStateCategory::Metadata,
                value: format!("{} {}", program, args.join(" ")),
                source: "Advanced Engine".to_string(),
                captured: true,
            },
        })
        .collect()
}

fn previous_state_category_for_operation(
    operation: &AdvancedOperation,
) -> RestorePreviousStateCategory {
    match operation {
        AdvancedOperation::RegistryDword { rollback_type, .. }
        | AdvancedOperation::RegistryString { rollback_type, .. } => match rollback_type {
            RestoreRollbackActionType::RestoreGameMode => RestorePreviousStateCategory::GameMode,
            RestoreRollbackActionType::RestoreVisualEffects => {
                RestorePreviousStateCategory::VisualEffects
            }
            _ => RestorePreviousStateCategory::Registry,
        },
        AdvancedOperation::PowerPlan { .. } => RestorePreviousStateCategory::PowerPlan,
        AdvancedOperation::PowerSetting { .. } => RestorePreviousStateCategory::Metadata,
        AdvancedOperation::DnsProvider { .. } => RestorePreviousStateCategory::Metadata,
        AdvancedOperation::DefenderPathExclusion { .. } => RestorePreviousStateCategory::Metadata,
        AdvancedOperation::Cmd { .. } => RestorePreviousStateCategory::Metadata,
    }
}

fn apply_plans(
    app: &AppHandle,
    snapshot_id: &str,
    plans: &[AdvancedPlan],
) -> Result<Vec<AdvancedActionResult>, String> {
    let mut results = Vec::new();
    for plan in plans {
        let result = apply_plan(plan);
        let failed = matches!(result.status, AdvancedActionStatus::Failed);
        append_advanced_event(
            app,
            if failed {
                AdvancedEventLevel::Error
            } else {
                AdvancedEventLevel::Info
            },
            Some(snapshot_id.to_string()),
            &format!("{}: {}", plan.action.title, result.message),
        )?;
        results.push(result);
        if failed {
            break;
        }
    }
    Ok(results)
}

fn apply_plan(plan: &AdvancedPlan) -> AdvancedActionResult {
    if plan.operations.is_empty() {
        return AdvancedActionResult {
            id: plan.action.id.clone(),
            title: plan.action.title.clone(),
            status: AdvancedActionStatus::Skipped,
            message: "Alvo nao detectado neste Windows; nenhuma alteracao necessaria.".to_string(),
        };
    }

    for operation in &plan.operations {
        if let Err(error) = apply_operation(operation) {
            return AdvancedActionResult {
                id: plan.action.id.clone(),
                title: plan.action.title.clone(),
                status: AdvancedActionStatus::Failed,
                message: error,
            };
        }
    }

    AdvancedActionResult {
        id: plan.action.id.clone(),
        title: plan.action.title.clone(),
        status: AdvancedActionStatus::Applied,
        message: if plan_has_persistent_operations(plan) {
            "Acao persistente aplicada com rollback registrado no snapshot.".to_string()
        } else {
            "Acao temporaria executada e registrada. Nenhum estado persistente para reverter."
                .to_string()
        },
    }
}

fn plan_has_persistent_operations(plan: &AdvancedPlan) -> bool {
    plan.operations.iter().any(|operation| {
        !matches!(
            operation,
            AdvancedOperation::Cmd {
                transient: true,
                ..
            }
        )
    })
}

fn apply_operation(operation: &AdvancedOperation) -> Result<(), String> {
    match operation {
        AdvancedOperation::RegistryDword {
            path, name, value, ..
        } => set_registry_dword(path, name, *value),
        AdvancedOperation::RegistryString {
            path, name, value, ..
        } => set_registry_string(path, name, value),
        AdvancedOperation::PowerPlan { guid, .. } => {
            run_native_command("powercfg", &["/S".to_string(), guid.clone()]).map(|_| ())
        }
        AdvancedOperation::PowerSetting {
            subgroup_guid,
            setting_guid,
            ac_value,
            dc_value,
            ..
        } => {
            run_native_command(
                "powercfg",
                &[
                    "/SETACVALUEINDEX".to_string(),
                    "SCHEME_CURRENT".to_string(),
                    subgroup_guid.clone(),
                    setting_guid.clone(),
                    ac_value.to_string(),
                ],
            )?;
            run_native_command(
                "powercfg",
                &[
                    "/SETDCVALUEINDEX".to_string(),
                    "SCHEME_CURRENT".to_string(),
                    subgroup_guid.clone(),
                    setting_guid.clone(),
                    dc_value.to_string(),
                ],
            )?;
            run_native_command(
                "powercfg",
                &["/S".to_string(), "SCHEME_CURRENT".to_string()],
            )
            .map(|_| ())
        }
        AdvancedOperation::DnsProvider { servers, .. } => set_dns_provider(servers),
        AdvancedOperation::DefenderPathExclusion {
            path,
            already_excluded,
        } => set_defender_path_exclusion(path, *already_excluded),
        AdvancedOperation::Cmd { program, args, .. } => {
            run_native_command(program, args).map(|_| ())
        }
    }
}

fn set_registry_dword(path: &str, name: &str, value: i64) -> Result<(), String> {
    let path_arg = ps_escape(path);
    let name_arg = ps_escape(name);
    let script = format!(
        "$ErrorActionPreference = 'Stop'; New-Item -Path '{path_arg}' -Force | Out-Null; New-ItemProperty -Path '{path_arg}' -Name '{name_arg}' -Value {value} -PropertyType DWord -Force | Out-Null; 'ok'"
    );
    run_powershell(&script, ADVANCED_COMMAND_TIMEOUT_SECONDS).map(|_| ())
}

fn set_registry_string(path: &str, name: &str, value: &str) -> Result<(), String> {
    let path_arg = ps_escape(path);
    let name_arg = ps_escape(name);
    let value_arg = ps_escape(value);
    let script = format!(
        "$ErrorActionPreference = 'Stop'; New-Item -Path '{path_arg}' -Force | Out-Null; New-ItemProperty -Path '{path_arg}' -Name '{name_arg}' -Value '{value_arg}' -PropertyType String -Force | Out-Null; 'ok'"
    );
    run_powershell(&script, ADVANCED_COMMAND_TIMEOUT_SECONDS).map(|_| ())
}

fn set_dns_provider(servers: &[String]) -> Result<(), String> {
    if !is_allowed_dns_servers(servers) {
        return Err("Provedor DNS fora da allowlist NEX.".to_string());
    }

    let server_args = servers
        .iter()
        .map(|server| format!("'{}'", ps_escape(server)))
        .collect::<Vec<_>>()
        .join(",");
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
$servers = @({server_args})
$adapters = @(Get-NetIPConfiguration | Where-Object {{ $_.IPv4DefaultGateway -ne $null }} | Select-Object -ExpandProperty InterfaceAlias -Unique)
if ($adapters.Count -eq 0) {{ throw 'Nenhum adaptador ativo com gateway foi encontrado.' }}
foreach ($alias in $adapters) {{
  Set-DnsClientServerAddress -InterfaceAlias $alias -ServerAddresses $servers
}}
ipconfig /flushdns | Out-Null
'ok'"#
    );
    run_powershell(&script, ADVANCED_COMMAND_TIMEOUT_SECONDS).map(|_| ())
}

fn set_defender_path_exclusion(path: &str, already_excluded: bool) -> Result<(), String> {
    if !is_allowed_hermes_executable_path(path) {
        return Err("Exclusao do Defender bloqueada: alvo nao e o executável NEX.".to_string());
    }

    if already_excluded {
        return Ok(());
    }

    let path_arg = ps_escape(path);
    let script = format!(
        "$ErrorActionPreference = 'Stop'; $path = '{path_arg}'; if (!(Test-Path -LiteralPath $path)) {{ throw 'Executável NEX não encontrado' }}; $prefs = Get-MpPreference; if (@($prefs.ExclusionPath) -contains $path) {{ 'already' }} else {{ Add-MpPreference -ExclusionPath $path; 'ok' }}"
    );
    run_powershell(&script, ADVANCED_COMMAND_TIMEOUT_SECONDS).map(|_| ())
}

fn read_registry_string(path: &str, name: &str) -> Result<Option<String>, String> {
    let path_arg = ps_escape(path);
    let name_arg = ps_escape(name);
    let script = format!(
        "$ErrorActionPreference = 'Stop'; $path = '{path_arg}'; $name = '{name_arg}'; if (-not (Test-Path $path)) {{ '__HERMES_MISSING__'; exit 0 }}; $item = Get-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue; if ($null -eq $item) {{ '__HERMES_MISSING__'; exit 0 }}; $property = $item.PSObject.Properties[$name]; if ($null -eq $property) {{ '__HERMES_MISSING__' }} else {{ [string]$property.Value }}"
    );
    let output = run_powershell(&script, ADVANCED_COMMAND_TIMEOUT_SECONDS)?;
    if output.trim() == MISSING_REGISTRY_VALUE {
        Ok(None)
    } else {
        Ok(Some(output))
    }
}

fn is_allowed_dns_servers(servers: &[String]) -> bool {
    let normalized = servers
        .iter()
        .map(|item| item.trim().to_string())
        .collect::<Vec<_>>();
    matches!(
        normalized.as_slice(),
        [a, b]
            if (a == "1.1.1.1" && b == "1.0.0.1")
                || (a == "8.8.8.8" && b == "8.8.4.4")
                || (a == "208.67.222.222" && b == "208.67.220.220")
                || (a == "9.9.9.9" && b == "149.112.112.112")
                || (a == "94.140.14.14" && b == "94.140.15.15")
    )
}

fn current_dns_state(state: &RawAdvancedState) -> String {
    if state.dns_interfaces.is_empty() {
        return "DNS atual nao capturado".to_string();
    }
    previous_dns_state(&state.dns_interfaces)
}

fn previous_dns_state(interfaces: &[DnsInterfaceState]) -> String {
    if interfaces.is_empty() {
        return "Nenhuma interface ativa capturada".to_string();
    }
    interfaces
        .iter()
        .map(|item| {
            let servers = if item.server_addresses.is_empty() {
                "automatico/DHCP".to_string()
            } else {
                item.server_addresses.join(",")
            };
            format!("{}={servers}", item.interface_alias)
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn run_native_command(program: &str, args: &[String]) -> Result<String, String> {
    if !is_allowed_native_command(program, args) {
        return Err("Comando CMD bloqueado pela allowlist NEX.".to_string());
    }

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
    wait_for_process(&mut child, ADVANCED_COMMAND_TIMEOUT_SECONDS)?;
    command_output(child, program)
}

fn is_allowed_native_command(program: &str, args: &[String]) -> bool {
    let normalized_program = program.to_ascii_lowercase();
    let normalized_args = args
        .iter()
        .map(|arg| arg.to_ascii_lowercase())
        .collect::<Vec<_>>();

    match normalized_program.as_str() {
        "ipconfig" => normalized_args == ["/flushdns".to_string()],
        "bcdedit" | "bcdedit.exe" => {
            normalized_args == ["/enum".to_string()]
                || normalized_args == ["/timeout".to_string(), "5".to_string()]
        }
        "powercfg" => {
            normalized_args == ["/l".to_string()]
                || normalized_args == ["/list".to_string()]
                || normalized_args == ["/hibernate".to_string(), "off".to_string()]
                || normalized_args
                    == [
                        "/duplicatescheme".to_string(),
                        ULTIMATE_PERFORMANCE_POWER_PLAN_GUID.to_string(),
                    ]
                || matches!(
                    normalized_args.as_slice(),
                    [switch, guid]
                        if switch == "/s"
                            && (guid == "scheme_current" || is_allowed_power_plan_guid(guid))
                )
                || matches!(
                    normalized_args.as_slice(),
                    [switch, scheme, subgroup, setting, value]
                        if (switch == "/setacvalueindex" || switch == "/setdcvalueindex")
                            && scheme == "scheme_current"
                            && value == "0"
                            && is_allowed_power_setting(subgroup, setting, 0)
                )
        }
        "dism" | "dism.exe" => {
            normalized_args
                == [
                    "/online".to_string(),
                    "/cleanup-image".to_string(),
                    "/analyzecomponentstore".to_string(),
                ]
                || normalized_args
                    == [
                        "/online".to_string(),
                        "/cleanup-image".to_string(),
                        "/startcomponentcleanup".to_string(),
                    ]
                || normalized_args
                    == [
                        "/online".to_string(),
                        "/get-featureinfo".to_string(),
                        "/featurename:netfx3".to_string(),
                    ]
                || normalized_args
                    == [
                        "/online".to_string(),
                        "/get-featureinfo".to_string(),
                        "/featurename:directplay".to_string(),
                    ]
                || normalized_args
                    == [
                        "/online".to_string(),
                        "/enable-feature".to_string(),
                        "/featurename:directplay".to_string(),
                        "/all".to_string(),
                        "/norestart".to_string(),
                    ]
        }
        "netsh" => {
            normalized_args == ["winsock".to_string(), "reset".to_string()]
                || normalized_args == ["int".to_string(), "ip".to_string(), "reset".to_string()]
                || normalized_args
                    == [
                        "int".to_string(),
                        "tcp".to_string(),
                        "set".to_string(),
                        "global".to_string(),
                        "autotuninglevel=normal".to_string(),
                    ]
                || normalized_args
                    == [
                        "int".to_string(),
                        "tcp".to_string(),
                        "set".to_string(),
                        "global".to_string(),
                        "ecncapability=disabled".to_string(),
                    ]
                || normalized_args
                    == [
                        "int".to_string(),
                        "tcp".to_string(),
                        "set".to_string(),
                        "global".to_string(),
                        "rss=enabled".to_string(),
                    ]
        }
        "sc.exe" => matches!(
            normalized_args.as_slice(),
            [config, service, start_equals, mode]
                if config == "config"
                    && is_allowed_manual_service(service)
                    && start_equals == "start="
                    && mode == "demand"
        ),
        "rundll32.exe" => {
            normalized_args
                == [
                    "shell32.dll,control_rundll".to_string(),
                    "sysdm.cpl,,3".to_string(),
                ]
                || normalized_args == ["user32.dll,updateperusersystemparameters".to_string()]
        }
        _ => false,
    }
}

fn is_allowed_manual_service(service: &str) -> bool {
    matches!(
        service,
        "diagtrack"
            | "mapsbroker"
            | "wersvc"
            | "wmpnetworksvc"
            | "fax"
            | "retaildemo"
            | "phonesvc"
            | "walletservice"
            | "xblauthmanager"
            | "xblgamesave"
            | "xboxnetapisvc"
    )
}

fn is_allowed_power_plan_guid(guid: &str) -> bool {
    [
        BALANCED_POWER_PLAN_GUID,
        HIGH_PERFORMANCE_POWER_PLAN_GUID,
        POWER_SAVER_POWER_PLAN_GUID,
    ]
    .iter()
    .any(|allowed| guid.eq_ignore_ascii_case(allowed))
}

fn is_allowed_power_setting(subgroup_guid: &str, setting_guid: &str, value: i64) -> bool {
    if value != 0 {
        return false;
    }

    (subgroup_guid.eq_ignore_ascii_case(USB_SETTINGS_SUBGROUP_GUID)
        && setting_guid.eq_ignore_ascii_case(USB_SELECTIVE_SUSPEND_SETTING_GUID))
        || (subgroup_guid.eq_ignore_ascii_case(PCI_EXPRESS_SUBGROUP_GUID)
            && setting_guid.eq_ignore_ascii_case(PCIE_LINK_STATE_POWER_MANAGEMENT_SETTING_GUID))
        || (subgroup_guid.eq_ignore_ascii_case(DISPLAY_SETTINGS_SUBGROUP_GUID)
            && setting_guid.eq_ignore_ascii_case(DISPLAY_IDLE_TIMEOUT_SETTING_GUID))
}

fn current_hermes_executable_path() -> Result<String, String> {
    let path = std::env::current_exe()
        .map_err(|err| format!("Nao foi possivel localizar o executável NEX: {err}"))?;
    Ok(path.to_string_lossy().replace('/', "\\"))
}

fn is_allowed_hermes_executable_path(path: &str) -> bool {
    let normalized = path.trim().replace('/', "\\").to_ascii_lowercase();
    let bytes = normalized.as_bytes();
    let allowed_suffix = normalized.ends_with("\\nex optimizer.exe")
        || normalized.ends_with("\\nex-optimizer.exe")
        || normalized.ends_with("\\hermes-optimizer.exe");
    allowed_suffix && bytes.get(1) == Some(&b':') && bytes.get(2) == Some(&b'\\')
}

fn paths_equal_ignore_case(left: &str, right: &str) -> bool {
    left.trim()
        .replace('/', "\\")
        .eq_ignore_ascii_case(&right.trim().replace('/', "\\"))
}

fn is_process_elevated() -> bool {
    if !cfg!(target_os = "windows") {
        return false;
    }

    let script = r#"$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { 'true' } else { 'false' }"#;
    run_powershell(script, ADVANCED_COMMAND_TIMEOUT_SECONDS)
        .map(|output| output.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn normalize_graphics_preference_path(path: &str) -> Result<String, String> {
    let normalized = path.trim().replace('/', "\\");
    if is_allowed_graphics_preference_executable_path(&normalized) {
        Ok(normalized)
    } else {
        Err("Elementos Graficos aceita apenas executavel local do Fate Trigger.".to_string())
    }
}

fn is_allowed_graphics_preference_executable_path(path: &str) -> bool {
    let normalized = path.replace('/', "\\").to_ascii_lowercase();
    let bytes = normalized.as_bytes();
    normalized.ends_with(".exe")
        && bytes.len() > 6
        && bytes.get(1) == Some(&b':')
        && bytes.get(2) == Some(&b'\\')
        && (normalized.contains("fate trigger")
            || normalized.contains("fatetrigger")
            || normalized.contains("fate_trigger"))
}

fn append_advanced_event(
    app: &AppHandle,
    level: AdvancedEventLevel,
    snapshot_id: Option<String>,
    message: &str,
) -> Result<(), String> {
    let path = advanced_events_path(app)?;
    let mut history = read_advanced_event_history(&path);
    history.events.insert(
        0,
        AdvancedEvent {
            id: format!("advanced-event-{}-{}", now_timestamp(), now_nanos()),
            timestamp: now_timestamp(),
            snapshot_id,
            level,
            message: message.to_string(),
        },
    );
    history.events.truncate(MAX_ADVANCED_EVENTS);
    write_advanced_event_history(&path, &history)
}

fn advanced_events_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Nao foi possivel localizar AppData: {err}"))?;
    dir.push("history");
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Nao foi possivel criar historico avancado: {err}"))?;
    dir.push("advanced_events.json");
    Ok(dir)
}

fn read_advanced_event_history(path: &PathBuf) -> AdvancedEventHistory {
    let Ok(contents) = fs::read_to_string(path) else {
        return AdvancedEventHistory::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_advanced_event_history(
    path: &PathBuf,
    history: &AdvancedEventHistory,
) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(history)
        .map_err(|err| format!("Nao foi possivel serializar logs avancados: {err}"))?;
    fs::write(path, contents)
        .map_err(|err| format!("Nao foi possivel gravar logs avancados: {err}"))
}

fn run_powershell(script: &str, timeout_seconds: u64) -> Result<String, String> {
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
        .map_err(|err| format!("Nao foi possivel iniciar PowerShell avancado: {err}"))?;
    wait_for_process(&mut child, timeout_seconds)?;
    command_output(child, "PowerShell")
}

fn wait_for_process(child: &mut std::process::Child, timeout_seconds: u64) -> Result<(), String> {
    let started_at = SystemTime::now();
    loop {
        if child
            .try_wait()
            .map_err(|err| format!("Falha ao aguardar processo avancado: {err}"))?
            .is_some()
        {
            return Ok(());
        }

        let elapsed = SystemTime::now()
            .duration_since(started_at)
            .unwrap_or_default()
            .as_secs();
        if elapsed >= timeout_seconds {
            let _ = child.kill();
            return Err("Tempo limite atingido no comando avancado.".to_string());
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

fn fallback_state() -> RawAdvancedState {
    RawAdvancedState {
        auto_game_mode_enabled: None,
        allow_auto_game_mode: None,
        game_bar_show_startup_panel: None,
        game_bar_use_nexus_for_game_bar_enabled: None,
        game_dvr_enabled: None,
        game_dvr_fse_behavior_mode: None,
        app_capture_enabled: None,
        startup_delay_in_msec: None,
        advertising_info_enabled: None,
        tailored_experiences_enabled: None,
        content_delivery_allowed: None,
        oem_preinstalled_apps_enabled: None,
        preinstalled_apps_enabled: None,
        silent_installed_apps_enabled: None,
        system_pane_suggestions_enabled: None,
        subscribed_content_338388_enabled: None,
        subscribed_content_338389_enabled: None,
        publish_user_activities: None,
        upload_user_activities: None,
        location_consent_value: None,
        storage_sense_enabled: None,
        background_apps_global_disabled: None,
        push_notifications_toast_enabled: None,
        notification_toasts_enabled: None,
        focus_assist_allow_sound: None,
        focus_assist_allow_notification_sound: None,
        focus_assist_allow_toasts_above_lock: None,
        focus_assist_allow_critical_toasts_above_lock: None,
        recall_disable_ai_data_analysis: None,
        hibernate_enabled: None,
        boot_timeout_seconds: None,
        diagtrack_start_mode: None,
        mapsbroker_start_mode: None,
        optional_service_start_modes: Vec::new(),
        enable_transparency: None,
        apps_use_light_theme: None,
        system_uses_light_theme: None,
        min_animate: None,
        drag_full_windows: None,
        font_smoothing: None,
        taskbar_animations: None,
        icons_only: None,
        listview_alpha_select: None,
        listview_shadow: None,
        enable_aero_peek: None,
        visual_fx_setting: None,
        mmcss_system_responsiveness: None,
        mmcss_games_gpu_priority: None,
        mmcss_games_priority: None,
        mmcss_games_scheduling_category: None,
        mmcss_games_sfio_priority: None,
        fate_trigger_cpu_priority: None,
        fate_trigger_shipping_cpu_priority: None,
        gamer_dependencies_summary: None,
        dns_interfaces: Vec::new(),
        power_plan_guid: Some("Indisponivel".to_string()),
        power_plan_name: Some("Indisponivel".to_string()),
        ultimate_performance_available: None,
        usb_selective_suspend_ac: None,
        usb_selective_suspend_dc: None,
        pcie_link_state_ac: None,
        pcie_link_state_dc: None,
        display_idle_timeout_ac: None,
        display_idle_timeout_dc: None,
        timer_policy_summary: None,
        defender_exclusion_paths: Vec::new(),
    }
}

fn display_optional(value: Option<i64>) -> String {
    value
        .map(|item| item.to_string())
        .unwrap_or_else(|| "Nao definido".to_string())
}

fn display_optional_string(value: Option<&str>) -> String {
    value
        .map(|item| item.to_string())
        .unwrap_or_else(|| "Nao definido".to_string())
}

fn current_power_plan(state: &RawAdvancedState) -> String {
    format!(
        "{} ({})",
        state
            .power_plan_name
            .clone()
            .unwrap_or_else(|| "Plano desconhecido".to_string()),
        state
            .power_plan_guid
            .clone()
            .unwrap_or_else(|| "GUID indisponivel".to_string())
    )
}

fn ps_escape(value: &str) -> String {
    value.replace('\'', "''")
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

const POWERSHELL_ADVANCED_STATE_SCRIPT: &str = r#"
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

function Normalize-StringArray($values) {
  @($values |
    Where-Object { $null -ne $_ -and [string]$_ -ne '' } |
    ForEach-Object { [string]$_ })
}

function Get-ServiceStartMode($name) {
  try {
    $service = Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction SilentlyContinue
    if ($null -eq $service) { return $null }
    return [string]$service.StartMode
  } catch { return $null }
}

function Get-BootTimeoutSeconds() {
  try {
    $lines = @(bcdedit /enum '{bootmgr}' 2>&1)
    foreach ($line in $lines) {
      if ([string]$line -match '^\s*timeout\s+(\d+)\s*$') {
        return [int64]$matches[1]
      }
    }
    return $null
  } catch { return $null }
}

function Get-PowerSettingValues($subgroup, $setting) {
  $result = @{
    ac = $null
    dc = $null
  }
  try {
    $lines = @(powercfg /Q SCHEME_CURRENT $subgroup $setting)
    $localizedValues = @()
    foreach ($line in $lines) {
      if ($line -match 'Current AC Power Setting Index:\s+0x([0-9a-fA-F]+)') {
        $result.ac = [string]([Convert]::ToInt64($matches[1], 16))
      }
      if ($line -match 'Current DC Power Setting Index:\s+0x([0-9a-fA-F]+)') {
        $result.dc = [string]([Convert]::ToInt64($matches[1], 16))
      }
      if ([string]$line -match '0x([0-9a-fA-F]+)\s*$') {
        $localizedValues += [string]([Convert]::ToInt64($matches[1], 16))
      }
    }
    if (($null -eq $result.ac -or $null -eq $result.dc) -and $localizedValues.Count -ge 2) {
      $result.ac = $localizedValues[$localizedValues.Count - 2]
      $result.dc = $localizedValues[$localizedValues.Count - 1]
    }
  } catch {}
  return $result
}

$gameBarPath = 'HKCU:\Software\Microsoft\GameBar'
$gameConfigPath = 'HKCU:\System\GameConfigStore'
$gameDvrPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR'
$serializePath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Serialize'
$advertisingPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo'
$privacyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Privacy'
$contentDeliveryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'
$activityHistoryPath = 'HKCU:\Software\Policies\Microsoft\Windows\System'
$locationConsentPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location'
$storageSensePath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\StorageSense\Parameters\StoragePolicy'
$backgroundAppsPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications'
$pushNotificationsPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications'
$notificationSettingsPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings'
$windowsAiPath = 'HKCU:\Software\Policies\Microsoft\Windows\WindowsAI'
$powerPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Power'
$personalizePath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
$desktopPath = 'HKCU:\Control Panel\Desktop'
$windowMetricsPath = 'HKCU:\Control Panel\Desktop\WindowMetrics'
$advancedPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
$visualFxPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects'
$dwmPath = 'HKCU:\Software\Microsoft\Windows\DWM'
$mmcssPath = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile'
$mmcssGamesPath = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games'
$ifeoFateTriggerPath = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\FateTrigger.exe\PerfOptions'
$ifeoFateTriggerShippingPath = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\FateTrigger-Win64-Shipping.exe\PerfOptions'
$directXPath = 'HKLM:\SOFTWARE\Microsoft\DirectX'
$usbPower = Get-PowerSettingValues '2a737441-1930-4402-8d77-b2bebba308a3' '48e6b7a6-50f5-4782-a5d4-53bb8f07e226'
$pciePower = Get-PowerSettingValues '501a4d13-42af-4429-9fd1-a8218c268e20' 'ee12f906-d277-404b-b6da-e5fa1a576df5'
$displayPower = Get-PowerSettingValues '7516b95f-f776-4464-8c53-06167f40cc99' '3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e'
$optionalServiceNames = @(
  'WerSvc',
  'WMPNetworkSvc',
  'Fax',
  'RetailDemo',
  'PhoneSvc',
  'WalletService',
  'XblAuthManager',
  'XblGameSave',
  'XboxNetApiSvc'
)
$optionalServiceStartModes = @($optionalServiceNames | ForEach-Object {
  [pscustomobject]@{
    name = [string]$_
    startMode = Get-ServiceStartMode $_
  }
})

$timerPolicySummary = 'BCDEdit indisponivel'
try {
  $bcdOutput = @(bcdedit /enum 2>&1)
  if ($LASTEXITCODE -eq 0) {
    $timerFlags = @($bcdOutput | Where-Object { [string]$_ -match 'useplatformclock|disabledynamictick|useplatformtick' })
    if ($timerFlags.Count -gt 0) {
      $timerPolicySummary = (($timerFlags | ForEach-Object { ([string]$_).Trim() }) -join '; ')
    } else {
      $timerPolicySummary = 'Sem flags BCDEdit de timer customizadas detectadas'
    }
  } else {
    $timerPolicySummary = (($bcdOutput | Select-Object -First 2 | ForEach-Object { ([string]$_).Trim() }) -join ' ')
  }
} catch {
  $timerPolicySummary = 'BCDEdit indisponivel'
}

$powerPlanGuid = $null
$powerPlanName = $null
$ultimatePerformanceAvailable = $false
try {
  $activeScheme = powercfg /GETACTIVESCHEME
  if ($activeScheme -match '([0-9a-fA-F-]{36})\s+\(([^\)]+)\)') {
    $powerPlanGuid = $matches[1]
    $powerPlanName = $matches[2]
  }
  $powerSchemes = @(powercfg /L)
  $ultimatePerformanceAvailable = ($powerSchemes -join "`n") -match 'e9a42b02-d5df-448d-aa00-03f14749eb61|Ultimate Performance'
} catch {}

$dnsInterfaces = @()
try {
  $dnsInterfaces = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null } | ForEach-Object {
    $alias = [string]$_.InterfaceAlias
    $servers = @()
    try {
      $servers = Normalize-StringArray ((Get-DnsClientServerAddress -InterfaceAlias $alias -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses)
    } catch {
      $servers = @()
    }
    [pscustomobject]@{
      interfaceAlias = $alias
      serverAddresses = $servers
    }
  })
} catch {
  $dnsInterfaces = @()
}

$defenderExclusionPaths = @()
try {
  $defenderExclusionPaths = Normalize-StringArray ((Get-MpPreference).ExclusionPath)
} catch {
  $defenderExclusionPaths = @()
}

$minAnimateValue = $null
try {
  $minAnimateValue = [string](Get-ItemProperty -Path $windowMetricsPath -Name 'MinAnimate' -ErrorAction SilentlyContinue).MinAnimate
} catch {
  $minAnimateValue = $null
}

$gamerDependenciesSummary = $null
try {
  $vcKeys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $vcNames = @(Get-ItemProperty -Path $vcKeys -ErrorAction SilentlyContinue |
    Where-Object { [string]$_.DisplayName -match 'Visual C\+\+.*Redistributable' } |
    Select-Object -ExpandProperty DisplayName -Unique)
  $directXVersion = Get-StringValue $directXPath 'Version'
  $gamerDependenciesSummary = "VC++ Redistributables encontrados: $($vcNames.Count); DirectX=$directXVersion"
} catch {
  $gamerDependenciesSummary = $null
}

[pscustomobject]@{
  autoGameModeEnabled = Get-Dword $gameBarPath 'AutoGameModeEnabled'
  allowAutoGameMode = Get-Dword $gameBarPath 'AllowAutoGameMode'
  gameBarShowStartupPanel = Get-Dword $gameBarPath 'ShowStartupPanel'
  gameBarUseNexusForGameBarEnabled = Get-Dword $gameBarPath 'UseNexusForGameBarEnabled'
  gameDvrEnabled = Get-Dword $gameConfigPath 'GameDVR_Enabled'
  gameDvrFseBehaviorMode = Get-Dword $gameConfigPath 'GameDVR_FSEBehaviorMode'
  appCaptureEnabled = Get-Dword $gameDvrPath 'AppCaptureEnabled'
  startupDelayInMsec = Get-Dword $serializePath 'StartupDelayInMSec'
  advertisingInfoEnabled = Get-Dword $advertisingPath 'Enabled'
  tailoredExperiencesEnabled = Get-Dword $privacyPath 'TailoredExperiencesWithDiagnosticDataEnabled'
  contentDeliveryAllowed = Get-Dword $contentDeliveryPath 'ContentDeliveryAllowed'
  oemPreinstalledAppsEnabled = Get-Dword $contentDeliveryPath 'OemPreInstalledAppsEnabled'
  preinstalledAppsEnabled = Get-Dword $contentDeliveryPath 'PreInstalledAppsEnabled'
  silentInstalledAppsEnabled = Get-Dword $contentDeliveryPath 'SilentInstalledAppsEnabled'
  systemPaneSuggestionsEnabled = Get-Dword $contentDeliveryPath 'SystemPaneSuggestionsEnabled'
  subscribedContent338388Enabled = Get-Dword $contentDeliveryPath 'SubscribedContent-338388Enabled'
  subscribedContent338389Enabled = Get-Dword $contentDeliveryPath 'SubscribedContent-338389Enabled'
  publishUserActivities = Get-Dword $activityHistoryPath 'PublishUserActivities'
  uploadUserActivities = Get-Dword $activityHistoryPath 'UploadUserActivities'
  locationConsentValue = Get-StringValue $locationConsentPath 'Value'
  storageSenseEnabled = Get-Dword $storageSensePath '01'
  backgroundAppsGlobalDisabled = Get-Dword $backgroundAppsPath 'GlobalUserDisabled'
  pushNotificationsToastEnabled = Get-Dword $pushNotificationsPath 'ToastEnabled'
  notificationToastsEnabled = Get-Dword $notificationSettingsPath 'NOC_GLOBAL_SETTING_TOASTS_ENABLED'
  focusAssistAllowSound = Get-Dword $notificationSettingsPath 'NOC_GLOBAL_SETTING_ALLOW_SOUND'
  focusAssistAllowNotificationSound = Get-Dword $notificationSettingsPath 'NOC_GLOBAL_SETTING_ALLOW_NOTIFICATION_SOUND'
  focusAssistAllowToastsAboveLock = Get-Dword $notificationSettingsPath 'NOC_GLOBAL_SETTING_ALLOW_TOASTS_ABOVE_LOCK'
  focusAssistAllowCriticalToastsAboveLock = Get-Dword $notificationSettingsPath 'NOC_GLOBAL_SETTING_ALLOW_CRITICAL_TOASTS_ABOVE_LOCK'
  recallDisableAiDataAnalysis = Get-Dword $windowsAiPath 'DisableAIDataAnalysis'
  hibernateEnabled = Get-Dword $powerPath 'HibernateEnabled'
  bootTimeoutSeconds = Get-BootTimeoutSeconds
  diagtrackStartMode = Get-ServiceStartMode 'DiagTrack'
  mapsbrokerStartMode = Get-ServiceStartMode 'MapsBroker'
  optionalServiceStartModes = $optionalServiceStartModes
  enableTransparency = Get-Dword $personalizePath 'EnableTransparency'
  appsUseLightTheme = Get-Dword $personalizePath 'AppsUseLightTheme'
  systemUsesLightTheme = Get-Dword $personalizePath 'SystemUsesLightTheme'
  minAnimate = $minAnimateValue
  dragFullWindows = Get-StringValue $desktopPath 'DragFullWindows'
  fontSmoothing = Get-StringValue $desktopPath 'FontSmoothing'
  taskbarAnimations = Get-Dword $advancedPath 'TaskbarAnimations'
  iconsOnly = Get-Dword $advancedPath 'IconsOnly'
  listviewAlphaSelect = Get-Dword $advancedPath 'ListviewAlphaSelect'
  listviewShadow = Get-Dword $advancedPath 'ListviewShadow'
  enableAeroPeek = Get-Dword $dwmPath 'EnableAeroPeek'
  visualFxSetting = Get-Dword $visualFxPath 'VisualFXSetting'
  mmcssSystemResponsiveness = Get-Dword $mmcssPath 'SystemResponsiveness'
  mmcssGamesGpuPriority = Get-Dword $mmcssGamesPath 'GPU Priority'
  mmcssGamesPriority = Get-Dword $mmcssGamesPath 'Priority'
  mmcssGamesSchedulingCategory = Get-StringValue $mmcssGamesPath 'Scheduling Category'
  mmcssGamesSfioPriority = Get-StringValue $mmcssGamesPath 'SFIO Priority'
  fateTriggerCpuPriority = Get-Dword $ifeoFateTriggerPath 'CpuPriorityClass'
  fateTriggerShippingCpuPriority = Get-Dword $ifeoFateTriggerShippingPath 'CpuPriorityClass'
  gamerDependenciesSummary = $gamerDependenciesSummary
  dnsInterfaces = $dnsInterfaces
  powerPlanGuid = $powerPlanGuid
  powerPlanName = $powerPlanName
  ultimatePerformanceAvailable = $ultimatePerformanceAvailable
  usbSelectiveSuspendAc = $usbPower.ac
  usbSelectiveSuspendDc = $usbPower.dc
  pcieLinkStateAc = $pciePower.ac
  pcieLinkStateDc = $pciePower.dc
  displayIdleTimeoutAc = $displayPower.ac
  displayIdleTimeoutDc = $displayPower.dc
  timerPolicySummary = $timerPolicySummary
  defenderExclusionPaths = $defenderExclusionPaths
} | ConvertTo-Json -Depth 5 -Compress
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advanced_state_accepts_nullable_nested_windows_values() {
        let json = serde_json::json!({
            "optionalServiceStartModes": [
                { "name": null, "startMode": null },
                { "name": "WerSvc", "startMode": "Manual" }
            ],
            "dnsInterfaces": [
                { "interfaceAlias": null, "serverAddresses": null },
                { "interfaceAlias": "Ethernet", "serverAddresses": ["1.1.1.1", null] }
            ],
            "defenderExclusionPaths": ["C:\\NEX", null, ""]
        });

        let state: RawAdvancedState = serde_json::from_value(json).expect("nullable Windows state");

        assert_eq!(state.optional_service_start_modes[0].name, "");
        assert_eq!(state.optional_service_start_modes[1].name, "WerSvc");
        assert_eq!(state.dns_interfaces[0].interface_alias, "");
        assert!(state.dns_interfaces[0].server_addresses.is_empty());
        assert_eq!(state.dns_interfaces[1].server_addresses, vec!["1.1.1.1"]);
        assert_eq!(state.defender_exclusion_paths, vec!["C:\\NEX"]);
    }

    #[test]
    fn advanced_allowlist_accepts_only_supported_windows_theme_values() {
        assert!(is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
            "EnableTransparency"
        ));
        assert!(is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
            "AppsUseLightTheme"
        ));
        assert!(is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
            "SystemUsesLightTheme"
        ));
        assert!(!is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
            "ColorPrevalence"
        ));
    }

    #[test]
    fn advanced_allowlist_scopes_graphics_preference_to_fate_trigger() {
        assert!(is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences",
            "D:\\Games\\FateTrigger\\FateTrigger.exe"
        ));
        assert!(!is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences",
            "C:\\Windows\\System32\\notepad.exe"
        ));
    }

    #[test]
    fn advanced_allowlist_accepts_background_and_notification_gamer_targets() {
        assert!(is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications",
            "GlobalUserDisabled"
        ));
        assert!(is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications",
            "ToastEnabled"
        ));
        assert!(is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings",
            "NOC_GLOBAL_SETTING_TOASTS_ENABLED"
        ));
        assert!(is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings",
            "NOC_GLOBAL_SETTING_ALLOW_SOUND"
        ));
        assert!(is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings",
            "NOC_GLOBAL_SETTING_ALLOW_NOTIFICATION_SOUND"
        ));
        assert!(is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings",
            "NOC_GLOBAL_SETTING_ALLOW_TOASTS_ABOVE_LOCK"
        ));
        assert!(is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings",
            "NOC_GLOBAL_SETTING_ALLOW_CRITICAL_TOASTS_ABOVE_LOCK"
        ));
        assert!(!is_advanced_allowed_registry_target(
            "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings",
            "UnknownNotificationFlag"
        ));
    }

    #[test]
    fn advanced_allowlist_accepts_safe_tcp_global_commands() {
        let tcp_autotuning = vec![
            "int".to_string(),
            "tcp".to_string(),
            "set".to_string(),
            "global".to_string(),
            "autotuninglevel=normal".to_string(),
        ];
        let tcp_ecn = vec![
            "int".to_string(),
            "tcp".to_string(),
            "set".to_string(),
            "global".to_string(),
            "ecncapability=disabled".to_string(),
        ];
        let tcp_rss = vec![
            "int".to_string(),
            "tcp".to_string(),
            "set".to_string(),
            "global".to_string(),
            "rss=enabled".to_string(),
        ];
        let unsupported_tcp_setting = vec![
            "int".to_string(),
            "tcp".to_string(),
            "set".to_string(),
            "global".to_string(),
            "chimney=enabled".to_string(),
        ];

        assert!(is_allowed_native_command("netsh", &tcp_autotuning));
        assert!(is_allowed_native_command("netsh", &tcp_ecn));
        assert!(is_allowed_native_command("netsh", &tcp_rss));
        assert!(!is_allowed_native_command(
            "netsh",
            &unsupported_tcp_setting
        ));
    }

    #[test]
    fn advanced_allowlist_accepts_only_safe_power_settings() {
        let usb_ac_off = vec![
            "/SETACVALUEINDEX".to_string(),
            "SCHEME_CURRENT".to_string(),
            USB_SETTINGS_SUBGROUP_GUID.to_string(),
            USB_SELECTIVE_SUSPEND_SETTING_GUID.to_string(),
            "0".to_string(),
        ];
        let pcie_dc_off = vec![
            "/SETDCVALUEINDEX".to_string(),
            "SCHEME_CURRENT".to_string(),
            PCI_EXPRESS_SUBGROUP_GUID.to_string(),
            PCIE_LINK_STATE_POWER_MANAGEMENT_SETTING_GUID.to_string(),
            "0".to_string(),
        ];
        let display_ac_never = vec![
            "/SETACVALUEINDEX".to_string(),
            "SCHEME_CURRENT".to_string(),
            DISPLAY_SETTINGS_SUBGROUP_GUID.to_string(),
            DISPLAY_IDLE_TIMEOUT_SETTING_GUID.to_string(),
            "0".to_string(),
        ];
        let refresh_current_plan = vec!["/S".to_string(), "SCHEME_CURRENT".to_string()];
        let usb_ac_on = vec![
            "/SETACVALUEINDEX".to_string(),
            "SCHEME_CURRENT".to_string(),
            USB_SETTINGS_SUBGROUP_GUID.to_string(),
            USB_SELECTIVE_SUSPEND_SETTING_GUID.to_string(),
            "1".to_string(),
        ];
        let unsupported_setting = vec![
            "/SETACVALUEINDEX".to_string(),
            "SCHEME_CURRENT".to_string(),
            USB_SETTINGS_SUBGROUP_GUID.to_string(),
            "00000000-0000-0000-0000-000000000000".to_string(),
            "0".to_string(),
        ];
        let duplicate_ultimate = vec![
            "/duplicatescheme".to_string(),
            ULTIMATE_PERFORMANCE_POWER_PLAN_GUID.to_string(),
        ];

        assert!(is_allowed_native_command("powercfg", &usb_ac_off));
        assert!(is_allowed_native_command("powercfg", &pcie_dc_off));
        assert!(is_allowed_native_command("powercfg", &display_ac_never));
        assert!(is_allowed_native_command("powercfg", &refresh_current_plan));
        assert!(is_allowed_native_command("powercfg", &duplicate_ultimate));
        assert!(!is_allowed_native_command("powercfg", &usb_ac_on));
        assert!(!is_allowed_native_command("powercfg", &unsupported_setting));
    }

    #[test]
    fn advanced_allowlist_accepts_only_timer_policy_probe() {
        let timer_probe = vec!["/enum".to_string()];
        let boot_timeout = vec!["/timeout".to_string(), "5".to_string()];
        let boot_timeout_zero = vec!["/timeout".to_string(), "0".to_string()];
        let timer_write = vec![
            "/set".to_string(),
            "useplatformclock".to_string(),
            "true".to_string(),
        ];

        assert!(is_allowed_native_command("bcdedit", &timer_probe));
        assert!(is_allowed_native_command("bcdedit.exe", &timer_probe));
        assert!(is_allowed_native_command("bcdedit", &boot_timeout));
        assert!(!is_allowed_native_command("bcdedit", &boot_timeout_zero));
        assert!(!is_allowed_native_command("bcdedit", &timer_write));
    }

    #[test]
    fn advanced_default_catalog_includes_defender_executable_exclusion() {
        assert!(default_action_ids().contains(&"allow-hermes-defender-exclusion".to_string()));
    }

    #[test]
    fn advanced_phase_two_catalog_includes_dark_mode_and_display_never() {
        let action_ids = default_action_ids();

        assert!(action_ids.contains(&"set-windows-dark-mode".to_string()));
        assert!(action_ids.contains(&"set-display-timeout-never".to_string()));
    }

    #[test]
    fn advanced_allowlist_accepts_only_windows_theme_refresh_command() {
        let refresh_theme = vec!["user32.dll,UpdatePerUserSystemParameters".to_string()];
        let arbitrary_command = vec!["user32.dll,MessageBeep".to_string()];

        assert!(is_allowed_native_command("rundll32.exe", &refresh_theme));
        assert!(!is_allowed_native_command(
            "rundll32.exe",
            &arbitrary_command
        ));
    }

    #[test]
    fn advanced_defender_exclusion_accepts_only_nex_executables() {
        assert!(is_allowed_hermes_executable_path(
            "C:\\Users\\User\\AppData\\Local\\NEX Optimizer\\NEX Optimizer.exe"
        ));
        assert!(is_allowed_hermes_executable_path(
            "C:\\Projetos\\Hermes-Optimizer\\src-tauri\\target\\debug\\nex-optimizer.exe"
        ));
        assert!(!is_allowed_hermes_executable_path(
            "C:\\Users\\User\\Downloads\\NEX Optimizer"
        ));
        assert!(!is_allowed_hermes_executable_path(
            "C:\\Windows\\System32\\notepad.exe"
        ));
    }

    #[test]
    fn advanced_allowlist_accepts_only_optional_services_as_demand_start() {
        let wersvc_manual = vec![
            "config".to_string(),
            "WerSvc".to_string(),
            "start=".to_string(),
            "demand".to_string(),
        ];
        let xbox_manual = vec![
            "config".to_string(),
            "XboxNetApiSvc".to_string(),
            "start=".to_string(),
            "demand".to_string(),
        ];
        let defender_disabled = vec![
            "config".to_string(),
            "WinDefend".to_string(),
            "start=".to_string(),
            "disabled".to_string(),
        ];
        let spooler_disabled = vec![
            "config".to_string(),
            "Spooler".to_string(),
            "start=".to_string(),
            "disabled".to_string(),
        ];
        let random_service_manual = vec![
            "config".to_string(),
            "RandomService".to_string(),
            "start=".to_string(),
            "demand".to_string(),
        ];

        assert!(is_allowed_native_command("sc.exe", &wersvc_manual));
        assert!(is_allowed_native_command("sc.exe", &xbox_manual));
        assert!(!is_allowed_native_command("sc.exe", &defender_disabled));
        assert!(!is_allowed_native_command("sc.exe", &spooler_disabled));
        assert!(!is_allowed_native_command("sc.exe", &random_service_manual));
    }

    #[test]
    fn advanced_optional_service_plan_skips_when_service_is_absent() {
        let plan = set_service_manual_plan(
            "set-fax-service-manual",
            "Fax sob demanda",
            "Coloca o servico Fax sob demanda quando existir.",
            "Fax",
            None,
        );

        assert!(plan.operations.is_empty());
        let result = apply_plan(&plan);
        assert!(matches!(result.status, AdvancedActionStatus::Skipped));
    }
}
