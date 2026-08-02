use std::sync::Arc;

use tauri::Manager;

#[cfg(target_os = "macos")]
use window_vibrancy::NSVisualEffectMaterial;

#[cfg(target_os = "macos")]
use window_vibrancy::apply_vibrancy;

#[cfg(target_os = "windows")]
use window_vibrancy::apply_mica;

mod auth;
mod calendar;
mod server_config;
mod session_store;
mod status;
mod ws_client;

// ─── Shared state ──────────────────────────────────────────────────────────────

pub struct LozaState {
    pub client: reqwest::Client,
    pub ws: Arc<ws_client::WsClient>,
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize structured logging (tracing subscriber)
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    let ws_client = Arc::new(ws_client::WsClient::new());

    tauri::Builder::default()
        .setup({
            let ws = ws_client.clone();
            move |app| {
                let window = app.get_webview_window("main").unwrap();

                #[cfg(target_os = "macos")]
                let _ = apply_vibrancy(&window, NSVisualEffectMaterial::Popover, None, Some(14.0));

                #[cfg(target_os = "windows")]
                let _ = apply_mica(&window, Some(true));

                // Start the unified WS client. This replaces the old
                // `spawn_status_listener` (which connected to /ws/status).
                // The new client connects to /ws/app and handles both
                // request-response (calendar CRUD) and push (status, events).
                ws_client::spawn_ws_loop(app.handle().clone(), ws);

                // Тихо продлевает токен сессии (если она есть) при каждом запуске
                // приложения — пользователю не нужно входить заново, пока он
                // открывает приложение хотя бы раз в TOKEN_TTL_SECS.
                let app_handle = app.handle().clone();
                let client = reqwest::Client::new();
                tauri::async_runtime::spawn(async move {
                    auth::refresh_session_silently(&app_handle, &client).await;
                });

                Ok(())
            }
        })
        .manage(LozaState {
            client: reqwest::Client::new(),
            ws: ws_client,
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            auth::login,
            auth::get_current_user,
            auth::logout,
            auth::health_check,
            server_config::get_server_url,
            server_config::set_server_url,
            server_config::clear_server_url,
            status::get_server_status,
            calendar::get_calendar_events,
            calendar::create_calendar_event,
            calendar::update_calendar_event,
            calendar::delete_calendar_event
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
