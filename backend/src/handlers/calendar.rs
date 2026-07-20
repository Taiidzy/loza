use axum::{extract::Path, extract::State, http::StatusCode, response::Json};
use uuid::Uuid;

use crate::db::AppState;
use crate::handlers::auth::touch_session;
use crate::models::{CalendarEvent, CalendarEventDraft};

use super::auth::ErrorResponse;

fn error(code: &str, msg: &str) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorResponse {
            error: msg.to_string(),
            code: code.to_string(),
        }),
    )
}

fn not_found(id: &str) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: format!("Событие с id \"{}\" не найдено", id),
            code: "EVENT_NOT_FOUND".to_string(),
        }),
    )
}

/// Достаёт username из валидной сессии по заголовку x-session-token.
/// Общая точка входа для всех calendar-хендлеров — события всегда привязаны
/// к конкретному пользователю (см. решение из обсуждения ТЗ).
fn require_username(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<String, (StatusCode, Json<ErrorResponse>)> {
    let token = headers
        .get("x-session-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if token.is_empty() {
        return Err(error("NO_TOKEN", "Missing session token"));
    }

    match touch_session(state, token) {
        Some((claims, _)) => Ok(claims.sub),
        None => Err(error("INVALID_TOKEN", "Invalid or expired session")),
    }
}

/// GET /calendar/events — все события текущего пользователя.
/// Соответствует calendarService.getEvents() на фронте.
pub async fn get_events(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<CalendarEvent>>, (StatusCode, Json<ErrorResponse>)> {
    let username = require_username(&state, &headers)?;
    let events = state.events.read().unwrap();
    Ok(Json(events.get(&username).cloned().unwrap_or_default()))
}

/// POST /calendar/events — создать событие. Тело — CalendarEventDraft (без id).
/// Соответствует calendarService.createEvent(draft) на фронте.
pub async fn create_event(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(draft): Json<CalendarEventDraft>,
) -> Result<Json<CalendarEvent>, (StatusCode, Json<ErrorResponse>)> {
    let username = require_username(&state, &headers)?;

    let event = CalendarEvent {
        id: format!("evt-{}", Uuid::new_v4()),
        title: draft.title,
        start_date: draft.start_date,
        end_date: draft.end_date,
        start_time: draft.start_time,
        end_time: draft.end_time,
        color: draft.color,
        recurrence: draft.recurrence,
        is_multi_day: draft.is_multi_day,
        is_all_day: draft.is_all_day,
    };

    let mut events = state.events.write().unwrap();
    events.entry(username).or_default().push(event.clone());

    Ok(Json(event))
}

/// PUT /calendar/events/:id — обновить событие целиком.
/// Соответствует calendarService.updateEvent(event) на фронте (принимает
/// полный CalendarEvent, включая id — как и клиентская сигнатура).
pub async fn update_event(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(updated): Json<CalendarEvent>,
) -> Result<Json<CalendarEvent>, (StatusCode, Json<ErrorResponse>)> {
    let username = require_username(&state, &headers)?;

    let mut events = state.events.write().unwrap();
    let list = events.entry(username).or_default();

    let idx = list.iter().position(|e| e.id == id).ok_or_else(|| not_found(&id))?;
    list[idx] = updated.clone();

    Ok(Json(updated))
}

/// DELETE /calendar/events/:id — удалить событие.
/// Соответствует calendarService.deleteEvent(id) на фронте.
pub async fn delete_event(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let username = require_username(&state, &headers)?;

    let mut events = state.events.write().unwrap();
    let list = events.entry(username).or_default();

    let before = list.len();
    list.retain(|e| e.id != id);

    if list.len() == before {
        return Err(not_found(&id));
    }

    Ok(StatusCode::NO_CONTENT)
}
