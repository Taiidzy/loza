//! Прокси между React и /calendar/events backend'а.
//!
//! Схема данных 1:1 повторяет CalendarEvent/CalendarEventDraft из
//! app/src/types/calendar.ts — Tauri здесь не добавляет и не убирает поля.
//! Токен сессии React не передаёт и не видит — он берётся из session_store
//! (см. auth.rs) и подставляется в заголовок запроса здесь.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::server_config;
use crate::session_store;
use crate::LozaState;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum Recurrence {
    None,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

/// startDate/endDate — "YYYY-MM-DD". startTime/endTime — "HH:mm" или None,
/// если isAllDay = true. isMultiDay и isAllDay — независимые флаги (см.
/// комментарий в backend/src/models/event.rs).
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

/// Токен текущей сессии + адрес сервера — общий helper для всех calendar-команд.
/// Если сессии или адреса нет, значит React обратился к календарю в обход
/// ProtectedRoute/ServerSetupPage — считаем это ошибкой авторизации/конфигурации.
fn require_session(app: &AppHandle) -> Result<(String, String), String> {
    let token = session_store::load_session(app)
        .map(|s| s.token)
        .ok_or_else(|| "NO_SESSION: Not logged in".to_string())?;
    let server_url = server_config::require_server_url(app)?;
    Ok((token, server_url))
}

/// `invoke("get_calendar_events")`
/// Соответствует calendarService.getEvents() на фронте.
#[tauri::command]
pub async fn get_calendar_events(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
) -> Result<Vec<CalendarEvent>, String> {
    let (token, server_url) = require_session(&app)?;

    let resp = state
        .client
        .get(format!("{}/calendar/events", server_url))
        .header("x-session-token", &token)
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

/// `invoke("create_calendar_event", { draft })`
/// Соответствует calendarService.createEvent(draft) на фронте.
#[tauri::command]
pub async fn create_calendar_event(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    draft: CalendarEventDraft,
) -> Result<CalendarEvent, String> {
    let (token, server_url) = require_session(&app)?;

    let resp = state
        .client
        .post(format!("{}/calendar/events", server_url))
        .header("x-session-token", &token)
        .json(&draft)
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

    let resp = state
        .client
        .put(format!("{}/calendar/events/{}", server_url, event.id))
        .header("x-session-token", &token)
        .json(&event)
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

/// `invoke("delete_calendar_event", { id })`
/// Соответствует calendarService.deleteEvent(id) на фронте.
#[tauri::command]
pub async fn delete_calendar_event(
    app: AppHandle,
    state: tauri::State<'_, LozaState>,
    id: String,
) -> Result<(), String> {
    let (token, server_url) = require_session(&app)?;

    let resp = state
        .client
        .delete(format!("{}/calendar/events/{}", server_url, id))
        .header("x-session-token", &token)
        .send()
        .await
        .map_err(|e| format!("SERVER_UNREACHABLE: {}", e))?;

    if !resp.status().is_success() {
        let err = resp.json::<ServerErrorResponse>().await.ok();
        return Err(describe_error(err, "UNKNOWN: Failed to delete event"));
    }

    Ok(())
}
