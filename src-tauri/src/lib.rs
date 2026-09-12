mod advanced;
mod advisor;
mod advisor_ai_engine;
mod anti_cheat;
mod benchmark;
mod clean;
mod diagnostic;
mod gamer;
mod gamer_dependencies;
mod license_policy;
mod license_transport;
mod licensing;
mod optimizer;
mod performance;
mod profiles;
mod restore;
mod safe_mode;
mod startup;
mod system;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewUrl};

const NEX_COMPANION_LABEL: &str = "nex-companion";
const NEX_COMPANION_COMPACT_WIDTH: f64 = 124.0;
const NEX_COMPANION_COMPACT_HEIGHT: f64 = 116.0;

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct NexCompanionSettings {
    enabled: bool,
    show_when_minimized: bool,
    always_on_top: bool,
    hide_in_fullscreen: bool,
    compact_mode: bool,
    click_through: bool,
    size: String,
    position: Option<NexCompanionPosition>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct NexCompanionPosition {
    x: i32,
    y: i32,
}

impl Default for NexCompanionSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            show_when_minimized: true,
            always_on_top: true,
            hide_in_fullscreen: false,
            compact_mode: true,
            click_through: false,
            size: "medium".to_string(),
            position: None,
        }
    }
}

#[derive(Default)]
struct NexCompanionRuntime {
    inner: Mutex<NexCompanionRuntimeState>,
}

#[derive(Default)]
struct NexCompanionRuntimeState {
    is_running: bool,
    status: String,
    settings: NexCompanionSettings,
}

fn companion_size(_settings: &NexCompanionSettings) -> (f64, f64) {
    (NEX_COMPANION_COMPACT_WIDTH, NEX_COMPANION_COMPACT_HEIGHT)
}

fn enforce_companion_policy(mut settings: NexCompanionSettings) -> NexCompanionSettings {
    settings.enabled = true;
    settings.show_when_minimized = true;
    settings.always_on_top = true;
    settings.hide_in_fullscreen = false;
    settings.compact_mode = true;
    settings.click_through = false;
    settings.size = "medium".to_string();
    settings
}

fn apply_companion_settings(
    window: &tauri::WebviewWindow,
    settings: &NexCompanionSettings,
) -> Result<(), String> {
    let (width, height) = companion_size(settings);
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| format!("Nao foi possivel dimensionar o NEX Companion: {error}"))?;
    window
        .set_always_on_top(settings.always_on_top)
        .map_err(|error| format!("Nao foi possivel ajustar o NEX Companion: {error}"))?;
    window
        .set_ignore_cursor_events(settings.click_through)
        .map_err(|error| format!("Nao foi possivel ajustar os cliques do NEX Companion: {error}"))
}

fn position_companion(window: &tauri::WebviewWindow, settings: &NexCompanionSettings) {
    let Ok(monitors) = window.available_monitors() else {
        return;
    };
    if monitors.is_empty() {
        return;
    }

    let requested = settings.position.as_ref();
    let monitor = requested
        .and_then(|position| {
            monitors.iter().find(|monitor| {
                let origin = monitor.position();
                let size = monitor.size();
                position.x >= origin.x
                    && position.y >= origin.y
                    && position.x < origin.x + size.width as i32
                    && position.y < origin.y + size.height as i32
            })
        })
        .or_else(|| {
            window.current_monitor().ok().flatten().and_then(|current| {
                monitors
                    .iter()
                    .find(|monitor| monitor.name() == current.name())
            })
        })
        .unwrap_or(&monitors[0]);

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let Ok(window_size) = window.outer_size() else {
        return;
    };

    let min_x = monitor_position.x;
    let min_y = monitor_position.y;
    let max_x = monitor_position.x + monitor_size.width as i32 - window_size.width as i32;
    let max_y = monitor_position.y + monitor_size.height as i32 - window_size.height as i32;
    let default_x = max_x - 18;
    let default_y = max_y - 42;
    let requested_x = requested.map(|position| position.x).unwrap_or(default_x);
    let requested_y = requested.map(|position| position.y).unwrap_or(default_y);
    let max_x = max_x.max(min_x);
    let max_y = max_y.max(min_y);
    let mut x = requested_x.clamp(min_x, max_x);
    let mut y = requested_y.clamp(min_y, max_y);
    const SNAP_DISTANCE: i32 = 32;

    if (x - min_x).abs() <= SNAP_DISTANCE {
        x = min_x;
    } else if (max_x - x).abs() <= SNAP_DISTANCE {
        x = max_x;
    }
    if (y - min_y).abs() <= SNAP_DISTANCE {
        y = min_y;
    } else if (max_y - y).abs() <= SNAP_DISTANCE {
        y = max_y;
    }

    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

fn show_companion(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(NEX_COMPANION_LABEL)
        .ok_or_else(|| "Janela do NEX Companion nao encontrada.".to_string())?;
    let settings = {
        let runtime = app.state::<NexCompanionRuntime>();
        let mut state = runtime
            .inner
            .lock()
            .map_err(|_| "Estado do NEX Companion indisponivel.".to_string())?;
        state.settings.compact_mode = true;
        state.settings.clone()
    };

    let _ = app.emit_to(
        NEX_COMPANION_LABEL,
        "nex://companion-settings",
        settings.clone(),
    );
    apply_companion_settings(&window, &settings)?;
    position_companion(&window, &settings);
    window
        .show()
        .map_err(|error| format!("Nao foi possivel mostrar o NEX Companion: {error}"))
}

fn hide_companion(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(NEX_COMPANION_LABEL)
        .ok_or_else(|| "Janela do NEX Companion nao encontrada.".to_string())?;
    window
        .hide()
        .map_err(|error| format!("Nao foi possivel ocultar o NEX Companion: {error}"))
}

fn open_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Janela principal nao encontrada.".to_string())?;
    window
        .show()
        .map_err(|error| format!("Nao foi possivel mostrar a janela principal: {error}"))?;
    window
        .unminimize()
        .map_err(|error| format!("Nao foi possivel restaurar a janela principal: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("Nao foi possivel focar a janela principal: {error}"))?;
    let _ = hide_companion(app);
    Ok(())
}

fn should_show_companion(app: &tauri::AppHandle) -> bool {
    let runtime = app.state::<NexCompanionRuntime>();
    let Ok(state) = runtime.inner.lock() else {
        return false;
    };
    let has_visible_status =
        state.is_running || matches!(state.status.as_str(), "completed" | "error");
    has_visible_status
}

fn reconcile_companion_visibility(app: &tauri::AppHandle) {
    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };
    let Some(companion_window) = app.get_webview_window(NEX_COMPANION_LABEL) else {
        return;
    };
    let main_is_minimized = main_window.is_minimized().unwrap_or(false);
    let main_is_visible = main_window.is_visible().unwrap_or(true);
    let companion_is_visible = companion_window.is_visible().unwrap_or(false);
    let should_be_visible = (main_is_minimized || !main_is_visible) && should_show_companion(app);

    if should_be_visible && !companion_is_visible {
        let _ = show_companion(app);
    } else if !should_be_visible && companion_is_visible {
        let _ = hide_companion(app);
    }
}

#[tauri::command]
fn nex_companion_update_runtime(
    app: tauri::AppHandle,
    is_running: bool,
    status: String,
) -> Result<(), String> {
    let runtime = app.state::<NexCompanionRuntime>();
    let mut state = runtime
        .inner
        .lock()
        .map_err(|_| "Estado do NEX Companion indisponivel.".to_string())?;
    state.is_running = is_running;
    state.status = status.clone();
    drop(state);

    if matches!(status.as_str(), "idle" | "cancelled") {
        let _ = hide_companion(&app);
    } else {
        reconcile_companion_visibility(&app);
    }
    Ok(())
}

#[tauri::command]
fn nex_companion_update_settings(
    app: tauri::AppHandle,
    settings: NexCompanionSettings,
) -> Result<(), String> {
    let settings = enforce_companion_policy(settings);
    let runtime = app.state::<NexCompanionRuntime>();
    let settings_changed = {
        let mut state = runtime
            .inner
            .lock()
            .map_err(|_| "Estado do NEX Companion indisponivel.".to_string())?;
        let changed = state.settings != settings;
        state.settings = settings.clone();
        changed
    };

    if settings_changed {
        let Some(window) = app.get_webview_window(NEX_COMPANION_LABEL) else {
            return Err("Janela do NEX Companion nao encontrada.".to_string());
        };
        apply_companion_settings(&window, &settings)?;
        position_companion(&window, &settings);
    }
    reconcile_companion_visibility(&app);
    Ok(())
}

#[tauri::command]
fn nex_companion_show(app: tauri::AppHandle) -> Result<(), String> {
    reconcile_companion_visibility(&app);
    Ok(())
}

#[tauri::command]
fn nex_companion_hide(app: tauri::AppHandle) -> Result<(), String> {
    open_main_window(&app)
}

#[tauri::command]
fn nex_companion_open_main(app: tauri::AppHandle) -> Result<(), String> {
    open_main_window(&app)
}

#[tauri::command]
fn nex_app_exit(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg(windows)]
fn colorref(red: u8, green: u8, blue: u8) -> u32 {
    (red as u32) | ((green as u32) << 8) | ((blue as u32) << 16)
}

#[cfg(windows)]
fn apply_nex_window_frame(window: &tauri::WebviewWindow) {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
        DWMWA_USE_IMMERSIVE_DARK_MODE,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    let dark_mode = 1i32;
    let caption_color = colorref(10, 3, 18);
    let border_color = colorref(32, 12, 52);
    let text_color = colorref(248, 244, 255);

    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark_mode as *const _ as _,
            std::mem::size_of_val(&dark_mode) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            &caption_color as *const _ as _,
            std::mem::size_of_val(&caption_color) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &border_color as *const _ as _,
            std::mem::size_of_val(&border_color) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_TEXT_COLOR,
            &text_color as *const _ as _,
            std::mem::size_of_val(&text_color) as u32,
        );
    }
}

#[tauri::command]
fn hermes_window_minimize(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Janela principal nao encontrada.".to_string())?;

    if window.is_fullscreen().unwrap_or(false) {
        window.set_fullscreen(false).map_err(|error| {
            format!("Nao foi possivel sair da tela cheia antes de minimizar: {error}")
        })?;
    }

    window
        .minimize()
        .map_err(|error| format!("Nao foi possivel minimizar a janela: {error}"))?;

    if should_show_companion(&app) {
        show_companion(&app)?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(NexCompanionRuntime::default())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = open_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            let app = window.app_handle();
            if window.label() == NEX_COMPANION_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = open_main_window(app);
                }
                return;
            }

            if window.label() != "main" {
                return;
            }

            match event {
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(true) => {
                    reconcile_companion_visibility(app);
                }
                tauri::WindowEvent::CloseRequested { api, .. } if should_show_companion(app) => {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = show_companion(app);
                }
                _ => {}
            }
        });

    builder
        .setup(|app| {
            licensing::initialize(app.handle()).map_err(std::io::Error::other)?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                apply_nex_window_frame(&window);
            }

            let companion = tauri::WebviewWindowBuilder::new(
                app,
                NEX_COMPANION_LABEL,
                WebviewUrl::App("/companion".into()),
            )
            .title("NEXT Companion")
            .inner_size(NEX_COMPANION_COMPACT_WIDTH, NEX_COMPANION_COMPACT_HEIGHT)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .build()?;
            let companion_settings = NexCompanionSettings::default();
            apply_companion_settings(&companion, &companion_settings)
                .map_err(std::io::Error::other)?;
            position_companion(&companion, &companion_settings);

            let tray_menu = tauri::menu::MenuBuilder::new(app)
                .text("open-main", "Abrir NEXT")
                .text("optimization-status", "Status da otimização")
                .separator()
                .text("quit-nex", "Sair")
                .build()?;
            let mut tray_builder = tauri::tray::TrayIconBuilder::with_id("nex-tray")
                .tooltip("NEXT Optimizer")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open-main" => {
                        let _ = open_main_window(app);
                    }
                    "optimization-status" => {
                        let _ = open_main_window(app);
                    }
                    "quit-nex" => {
                        let running = app
                            .state::<NexCompanionRuntime>()
                            .inner
                            .lock()
                            .map(|state| state.is_running)
                            .unwrap_or(false);
                        if running {
                            let _ = open_main_window(app);
                            let _ =
                                app.emit_to("main", "nex://exit-requested", "optimization-running");
                        } else {
                            app.exit(0);
                        }
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            tray_builder.build(app)?;

            #[cfg(all(debug_assertions, windows))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            advanced::advanced_engine_apply,
            advanced::advanced_engine_apply_optimize_now,
            advanced::advanced_engine_catalog,
            advanced::advanced_set_graphics_high_performance_optimize_now,
            anti_cheat::anti_cheat_enable_memory_integrity,
            anti_cheat::anti_cheat_engine_read,
            advisor_ai_engine::advisor_ai_engine_analyze,
            advisor::advisor_pro_analyze,
            benchmark::benchmark_engine_read_cached,
            benchmark::benchmark_engine_run,
            clean::clean_engine_apply,
            clean::clean_engine_apply_optimize_now,
            clean::clean_engine_scan,
            clean::clean_quarantine_purge_expired,
            diagnostic::diagnostic_engine_read_cached,
            diagnostic::diagnostic_engine_refresh_live,
            diagnostic::diagnostic_engine_read,
            gamer::gamer_engine_apply,
            gamer::gamer_engine_read,
            gamer::gamer_profile_delete,
            gamer::gamer_profile_save,
            gamer::gamer_profiles_list,
            gamer::gamer_restore_session,
            gamer_dependencies::gamer_dependency_audit_official_manifest,
            gamer_dependencies::gamer_dependency_download_official_installers,
            gamer_dependencies::gamer_dependency_install_verified,
            gamer_dependencies::gamer_dependency_open_cache_dir,
            gamer_dependencies::gamer_dependency_verify_installers,
            licensing::nex_device_identity,
            licensing::nex_license_activate,
            licensing::nex_license_verify,
            licensing::nex_license_sign_out,
            optimizer::optimize_now_plan,
            performance::performance_apply_controlled,
            performance::performance_engine_read,
            profiles::profiles_apply,
            profiles::profiles_list,
            restore::restore_apply_snapshot,
            restore::restore_create_snapshot,
            restore::restore_engine_status,
            restore::restore_list_snapshots,
            restore::restore_list_events,
            restore::restore_validate_snapshot,
            startup::startup_engine_apply,
            startup::startup_engine_read,
            system::system_boot_context_read,
            system::system_cancel_restart,
            system::system_open_windows_security,
            system::system_restart_computer,
            system::system_security_context_read,
            hermes_window_minimize,
            nex_companion_update_runtime,
            nex_companion_update_settings,
            nex_companion_show,
            nex_companion_hide,
            nex_companion_open_main,
            nex_app_exit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
