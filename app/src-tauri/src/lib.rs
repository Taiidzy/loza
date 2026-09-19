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
mod files;
mod server_config;
mod session_store;
mod status;
mod transfers;
mod ws_client;

// ─── Shared state ──────────────────────────────────────────────────────────────

pub struct LozaState {
    pub client: reqwest::Client,
    /// Клиент без общего таймаута — для длительных upload/download.
    /// Общий `client` имеет лимит 30с на весь запрос, которого не хватает
    /// для больших файлов (тело загрузки отправляется до ответа сервера).
    pub file_client: reqwest::Client,
    pub ws: Arc<ws_client::WsClient>,
    pub transfers: transfers::TransferRegistry,
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
                if let Some(window) = app.get_webview_window("main") {
                    #[cfg(target_os = "macos")]
                    let _ = apply_vibrancy(&window, NSVisualEffectMaterial::Popover, None, Some(14.0));

                    #[cfg(target_os = "windows")]
                    let _ = apply_mica(&window, Some(true));
                } else {
                    tracing::warn!("main window not found — vibrancy effects skipped");
                }

                // Start the unified WS client. This replaces the old
                // `spawn_status_listener` (which connected to /ws/status).
                // The new client connects to /ws/app and handles both
                // request-response (calendar CRUD) and push (status, events).
                ws_client::spawn_ws_loop(app.handle().clone(), ws);

                // Тихо продлевает токен сессии при старте и далее каждые 6ч,
                // пока приложение открыто. Access-JWT живёт 24ч, но строка
                // сессии на сервере — 30 дней, поэтому refresh с любым живым
                // токеном выдаёт новый; пользователь не должен входить заново,
                // если открывает приложение хотя бы раз в месяц.
                let app_handle = app.handle().clone();
                let client = reqwest::Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(10))
                    .timeout(std::time::Duration::from_secs(30))
                    .build()
                    .unwrap_or_else(|_| reqwest::Client::new());
                tauri::async_runtime::spawn(async move {
                    loop {
                        let _ = auth::refresh_session_silently(&app_handle, &client).await;
                        tokio::time::sleep(std::time::Duration::from_secs(6 * 60 * 60)).await;
                    }
                });

                Ok(())
            }
        })
        .manage(LozaState {
            client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(10))
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("failed to build HTTP client"),
            file_client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("failed to build file-transfer HTTP client"),
            ws: ws_client,
            transfers: transfers::TransferRegistry::new(),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
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
            calendar::delete_calendar_event,
            files::list_files,
            files::search_files,
            files::get_file_info,
            files::create_share,
            files::list_shares,
            files::revoke_share,
            files::get_share_url,
            files::upload_file,
            files::upload_file_path,
            files::upload_paths,
            files::download_file,
            files::download_file_to_downloads,
            files::delete_file,
            files::rename_file,
            files::move_file,
            files::copy_file,
            files::create_dir,
            files::mutate_files,
            transfers::cancel_transfer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
