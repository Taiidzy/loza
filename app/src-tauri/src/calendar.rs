//! Прокси между React и backend'ом для календарных событий.
//!
//! Схема данных 1:1 повторяет CalendarEvent/CalendarEventDraft из
//! app/src/types/calendar.ts — Tauri здесь не добавляет и не убирает поля.
//!
//! Transport strategy:
//! - Primary: WebSocket `/ws/app` (unified session with the status listener).
//!   Request-response with 10s timeout, automatic reconnect, and broadcast
//!   notifications to other client connections of the same user.
//! - Fallback: HTTP `/calendar/events` endpoints. Used only when the WS
//!   client is not yet connected (e.g., right after startup before the
//!   background WS task has established a connection). This ensures the
//!   calendar tab always works, even if WS hasn't completed its connect
//!   handshake yet.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::server_config;
use crate::session_store;
use crate::LozaState;

// ─── Types (mirror backend/src/models/event.rs) ───────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum Recurrence {
    None,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    #[serde(rename = "startDate")]
    pub start_date: String,
    #[serde(rename = "endDate")]
    pub end_date: String,
    #[serde(rename = "startTime")]
    pub start_time: Option<String>,
    #[serde(rename = "endTime")]
    pub end_time: Option<String>,
    pub color: String,
    pub recurrence: Recurrence,
    #[serde(rename = "isMultiDay")]
    pub is_multi_day: bool,
    #[serde(rename = "isAllDay")]
    pub is_all_day: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalendarEventDraft {
    pub title: String,
    #[serde(rename = "startDate")]
    pub start_date: String,
    #[serde(rename = "endDate")]
    pub end_date: String,
    #[serde(rename = "startTime")]
    pub start_time: Option<String>,
    #[serde(rename = "endTime")]
    pub end_time: Option<String>,
    pub color: String,
    pub recurrence: Recurrence,
    #[serde(rename = "isMultiDay")]
    pub is_multi_day: bool,
    #[serde(rename = "isAllDay")]
    pub is_all_day: bool,
}

#[derive(Debug, Deserialize)]
struct ServerErrorResponse {
    error: String,
    code: String,
}

fn describe_error(body: Option<ServerErrorResponse>, fallback: &str) -> String {
    match body {
        Some(e) => format!("{}: {}", e.code, e.error),
        None => fallback.to_string(),
    }
}

fn require_session(app: &AppHandle) -> Result<(String, String), String> {
    let token = session_store::load_session(app)
        .map(|s| s.token)
        .ok_or_else(|| "NO_SESSION: Not logged in".to_string())?;
    let server_url = server_config::require_server_url(app)?;
    Ok((token, server_url))
}

// ─── HTTP fallback (used when WS is unavailable) ──────────────────────────────

async fn http_get_events(
    state: &tauri::State<'_, LozaState>,
    token: &str,
    server_url: &str,
) -> Result<Vec<CalendarEvent>, String> {
    let resp = state
        .client
        .get(format!("{}/calendar/events", server_url))
        .header("x-session-token", token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to load events"));
    }

    resp.json::<Vec<CalendarEvent>>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

async fn http_create_event(
    state: &tauri::State<'_, LozaState>,
    token: &str,
    server_url: &str,
    draft: &CalendarEventDraft,
) -> Result<CalendarEvent, String> {
    let resp = state
        .client
        .post(format!("{}/calendar/events", server_url))
        .header("x-session-token", token)
        .json(draft)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to create event"));
    }

    resp.json::<CalendarEvent>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

async fn http_update_event(
    state: &tauri::State<'_, LozaState>,
    token: &str,
    server_url: &str,
    event: &CalendarEvent,
) -> Result<CalendarEvent, String> {
    let resp = state
        .client
        .put(format!("{}/calendar/events/{}", server_url, event.id))
        .header("x-session-token", token)
        .json(event)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to update event"));
    }

    resp.json::<CalendarEvent>()
        .await
        .map_err(|e| format!("PARSE_ERROR: {}", e))
}

async fn http_delete_event(
    state: &tauri::State<'_, LozaState>,
    token: &str,
    server_url: &str,
    id: &str,
) -> Result<(), String> {
    let resp = state
        .client
        .delete(format!("{}/calendar/events/{}", server_url, id))
        .header("x-session-token", token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to delete event"));
    }

    Ok(())
}

// ─── Tauri invoke commands (WS-first, HTTP fallback) ───────────────────────────

/// `invoke("get_calendar_events")`
/// Соответствует calendarService.getEvents() на фронте.
#[tauri::command]
pub async fn get_calendar_events(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
) -> Result<Vec<CalendarEvent>, String> {
    let (token, server_url) = require_session(&app)?;

    // Try WebSocket first
    let ws_result = state
        .ws
        .send_request("calendar.get", serde_json::Value::Null)
        .await;

    if let Ok(result) = ws_result {
        return serde_json::from_value::<Vec<CalendarEvent>>(result)
            .map_err(|e| format!("PARSE_ERROR: {}", e));
    }

    // Fall back to HTTP
    tracing::debug!("[desktop.calendar] WS failed, falling back to HTTP");
    http_get_events(&state, &token, &server_url).await
}

/// `invoke("create_calendar_event", { draft })`
/// Соответствует calendarService.createEvent(draft) на фронте.
#[tauri::command]
pub async fn create_calendar_event(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    draft: CalendarEventDraft,
) -> Result<CalendarEvent, String> {
    let (token, server_url) = require_session(&app)?;

    let params = serde_json::to_value(&draft)
        .map_err(|e| format!("ENCODE_ERROR: {}", e))?;

    let ws_result = state.ws.send_request("calendar.create", params).await;

    if let Ok(result) = ws_result {
        return serde_json::from_value::<CalendarEvent>(result)
            .map_err(|e| format!("PARSE_ERROR: {}", e));
    }

    tracing::debug!("[desktop.calendar] WS failed, falling back to HTTP");
    http_create_event(&state, &token, &server_url, &draft).await
}

/// `invoke("update_calendar_event", { event })`
/// Соответствует calendarService.updateEvent(event) на фронте (принимает
/// полный CalendarEvent, включая id).
#[tauri::command]
pub async fn update_calendar_event(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    event: CalendarEvent,
) -> Result<CalendarEvent, String> {
    let (token, server_url) = require_session(&app)?;

    let params = serde_json::to_value(&event)
        .map_err(|e| format!("ENCODE_ERROR: {}", e))?;

    let ws_result = state.ws.send_request("calendar.update", params).await;

    if let Ok(result) = ws_result {
        return serde_json::from_value::<CalendarEvent>(result)
            .map_err(|e| format!("PARSE_ERROR: {}", e));
    }

    tracing::debug!("[desktop.calendar] WS failed, falling back to HTTP");
    http_update_event(&state, &token, &server_url, &event).await
}

/// `invoke("delete_calendar_event", { id })`
/// Соответствует calendarService.deleteEvent(id) на фrontе.
#[tauri::command]
pub async fn delete_calendar_event(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    id: String,
) -> Result<(), String> {
    let (token, server_url) = require_session(&app)?;

    let params = serde_json::json!({ "id": id });

    let ws_result = state.ws.send_request("calendar.delete", params).await;

    match ws_result {
        Ok(_) => return Ok(()),
        Err(e) => tracing::debug!("[desktop.calendar] WS failed: {}, falling back to HTTP", e),
    }

    http_delete_event(&state, &token, &server_url, &id).await
}
