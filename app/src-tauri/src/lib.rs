use tauri::Manager;
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

// ─── Shared HTTP client state ─────────────────────────────────────────────────

pub struct LozaState {
    pub client: reqwest::Client,
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "macos")]
            let _ = apply_vibrancy(
                &window,
                NSVisualEffectMaterial::Popover,
                None,
                Some(14.0),
            );

            #[cfg(target_os = "windows")]
            let _ = apply_mica(&window, Some(true));

            // Открывает WS-соединение к /ws/status и проксирует каждое сообщение
            // в React как событие "server-status" — React больше не опрашивает
            // сервер сам и не знает о его существовании.
            status::spawn_status_listener(app.handle().clone());

            // Тихо продлевает токен сессии (если она есть) при каждом запуске
            // приложения — пользователю не нужно входить заново, пока он
            // открывает приложение хотя бы раз в TOKEN_TTL_SECS.
            let app_handle = app.handle().clone();
            let client = reqwest::Client::new();
            tauri::async_runtime::spawn(async move {
                auth::refresh_session_silently(&app_handle, &client).await;
            });

            Ok(())
        })
        .manage(LozaState {
            client: reqwest::Client::new(),
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