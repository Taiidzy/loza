use tauri::Manager;
use window_vibrancy::{apply_vibrancy, apply_mica, NSVisualEffectMaterial};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            // Для macOS: используем нативный Vibrancy
            #[cfg(target_os = "macos")]
            let _ = apply_vibrancy(
                &window, 
                NSVisualEffectMaterial::Popover, 
                None, 
                Some(14.0) // Синхронизируем радиус с CSS
            );

            // Для Windows 11: используем эффект Mica (слюда)
            // true = темная тема. Можно заменить на apply_blur для Windows 10
            #[cfg(target_os = "windows")]
            let _ = apply_mica(&window, Some(true)); 

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}