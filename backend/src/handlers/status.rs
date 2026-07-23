use axum::{
    extract::State,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
};
use chrono::Utc;
use sysinfo::Disks;

use crate::db::{AppState, repository, state::STORAGE_HISTORY_DAYS};
use crate::handlers::auth::{ErrorResponse, now_secs, require_session, touch_session};
use crate::models::{ClientInfo, LoadInfo, ServerStatus, StorageInfo};

/// Клиент считается online, пока его heartbeat был не более 15 секунд назад.
const PRESENCE_TTL_SECS: u64 = 15;

async fn collect_clients(state: &AppState) -> Vec<ClientInfo> {
    let sessions = match repository::list_sessions(&state.pool).await {
        Ok(sessions) => sessions,
        Err(error) => {
            tracing::error!(%error, "failed to load sessions for status");
            return Vec::new();
        }
    };
    let now = now_secs();

    sessions
        .iter()
        .map(|s| {
            let last_seen_iso = chrono::DateTime::<Utc>::from_timestamp(s.last_seen as i64, 0)
                .unwrap_or_else(Utc::now)
                .to_rfc3339();

            ClientInfo {
                id: s.public_id.clone(),
                name: s.device.clone(),
                device: s.device.clone(),
                active: s.expires_at > now && now.saturating_sub(s.last_seen) <= PRESENCE_TTL_SECS,
                last_seen: last_seen_iso,
            }
        })
        .collect()
}

/// Реальные метрики диска (общий/занятый объём) через sysinfo::Disks,
/// плюс разбивка по категориям через сканирование storage/<category>.
fn collect_storage(state: &AppState) -> StorageInfo {
    let disks = Disks::new_with_refreshed_list();

    // 1. Читаем путь из окружения (.env), если его нет — берём дефолтный "./storage"
    let root_dir = std::env::var("STORAGE_ROOT").unwrap_or_else(|_| "./storage".to_string());

    // 2. Преобразуем в абсолютный путь
    let storage_path = std::fs::canonicalize(&root_dir)
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default().join(&root_dir));

    // 3. Ищем нужный диск по префиксу
    let target_disk = disks
        .list()
        .iter()
        .filter(|d| storage_path.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len());

    let (total_bytes, used_bytes) = match target_disk {
        Some(disk) => (
            disk.total_space(),
            disk.total_space() - disk.available_space(),
        ),
        None => (0, 0),
    };

    let categories = state.storage_categories(now_secs());

    let used_percent = if total_bytes > 0 {
        (used_bytes as f32 / total_bytes as f32) * 100.0
    } else {
        0.0
    };

    state.maybe_push_storage_sample(used_percent, now_secs());

    let history7d = {
        let Ok(hist) = state.storage_history.read() else {
            tracing::error!("storage history lock is poisoned");
            return StorageInfo {
                total_bytes,
                used_bytes,
                categories,
                history7d: vec![used_percent; STORAGE_HISTORY_DAYS],
            };
        };
        let mut v = hist.clone();
        while v.len() < STORAGE_HISTORY_DAYS {
            v.insert(0, used_percent);
        }
        v
    };

    StorageInfo {
        total_bytes,
        used_bytes,
        categories,
        history7d,
    }
}

/// Реальная загрузка CPU/RAM через sysinfo::System.
/// Проценты округляются до десятых (1 знак после запятой) — так их
/// отображает фронт (DashboardCards.tsx выводит cpuPercent/memPercent как есть,
/// без форматирования на своей стороне).
fn collect_load(state: &AppState) -> LoadInfo {
    let Ok(mut sys) = state.sys.lock() else {
        tracing::error!("system metrics lock is poisoned");
        return LoadInfo {
            cpu_percent: 0.0,
            mem_percent: 0.0,
            history: Vec::new(),
        };
    };
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_percent = round_to_tenths(sys.global_cpu_usage());
    let mem_percent = if sys.total_memory() > 0 {
        round_to_tenths((sys.used_memory() as f32 / sys.total_memory() as f32) * 100.0)
    } else {
        0.0
    };
    drop(sys);

    state.push_load_sample(cpu_percent);
    let history = match state.load_history.read() {
        Ok(history) => history.clone(),
        Err(_) => {
            tracing::error!("load history lock is poisoned");
            Vec::new()
        }
    };

    LoadInfo {
        cpu_percent,
        mem_percent,
        history,
    }
}

fn round_to_tenths(value: f32) -> f32 {
    (value * 10.0).round() / 10.0
}

/// Собирает ServerStatus целиком — единая точка правды, используется и HTTP-хендлером,
/// и WebSocket-стримом, чтобы обе точки входа возвращали идентичную форму данных.
pub async fn collect_server_status(state: &AppState) -> ServerStatus {
    ServerStatus {
        clients: collect_clients(state).await,
        storage: collect_storage(state),
        load: collect_load(state),
        activity: Vec::new(), // пока нет backend event-log — честный пустой список
        updated_at: Utc::now().to_rfc3339(),
    }
}

/// GET /status — разовый снимок (используется Tauri для первого рендера до того,
/// как откроется WS-соединение).
pub async fn get_status(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<
    axum::response::Json<ServerStatus>,
    (axum::http::StatusCode, axum::response::Json<ErrorResponse>),
> {
    require_session(&state, &headers).await?;
    Ok(axum::response::Json(collect_server_status(&state).await))
}

/// WS /ws/status — сразу после подключения (первый tick интервала срабатывает
/// немедленно) и затем каждые 2 сек отправляет свежий ServerStatus,
/// пока клиент не отключится.
pub async fn ws_status(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, (axum::http::StatusCode, axum::response::Json<ErrorResponse>)> {
    let (_, session) = require_session(&state, &headers).await?;
    if !state.try_acquire_status_ws() {
        return Err((
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            axum::response::Json(ErrorResponse {
                error: "Too many status stream connections".to_string(),
                code: "STATUS_WS_CAPACITY_REACHED".to_string(),
            }),
        ));
    }
    let upgrade_state = state.clone();
    let failed_upgrade_state = state;
    Ok(ws
        .on_failed_upgrade(move |error| {
            failed_upgrade_state.release_status_ws();
            tracing::warn!(%error, "status websocket upgrade failed");
        })
        .on_upgrade(move |socket| handle_ws_status(socket, upgrade_state, session.token)))
}

async fn handle_ws_status(mut socket: WebSocket, state: AppState, token: String) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));

    loop {
        interval.tick().await;
        if touch_session(&state, &token).await.is_none() {
            break;
        }
        let status = collect_server_status(&state).await;
        let payload = match serde_json::to_string(&status) {
            Ok(p) => p,
            Err(_) => continue,
        };

        if socket.send(Message::Text(payload)).await.is_err() {
            // Клиент отключился (Tauri перезапустился, приложение закрыто и т.п.)
            break;
        }
    }
    state.release_status_ws();
}
