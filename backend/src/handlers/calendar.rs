use axum::{extract::Path, extract::State, http::StatusCode, response::Json};
use chrono::{NaiveDate, NaiveTime};
use uuid::Uuid;

use crate::db::{AppState, repository};
use crate::handlers::auth::{ErrorResponse, require_session};
use crate::handlers::ws::WsPush;
use crate::models::{CalendarEvent, CalendarEventDraft};

type ApiError = (StatusCode, Json<ErrorResponse>);

/// Транспортно-независимая ошибка валидации/бизнес-логики.
/// Используется и HTTP-хендлерами, и WS-хендлером — чтобы не дублировать
/// сообщения об ошибках и коды.
#[derive(Debug, Clone)]
pub struct CalendarError {
    pub code: String,
    pub message: String,
}

impl CalendarError {
    pub fn new(code: &str, message: &str) -> Self {
        CalendarError {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    pub fn not_found(id: &str) -> Self {
        CalendarError::new(
            "EVENT_NOT_FOUND",
            &format!("Event with id {id} was not found"),
        )
    }

    pub fn invalid(message: &str) -> Self {
        CalendarError::new("INVALID_CALENDAR_EVENT", message)
    }

    pub fn database(message: &str) -> Self {
        CalendarError::new("DATABASE_UNAVAILABLE", message)
    }
}

impl From<sqlx::Error> for CalendarError {
    fn from(err: sqlx::Error) -> Self {
        tracing::error!(error = %err, "calendar database operation failed");
        CalendarError::database("The database is temporarily unavailable")
    }
}

fn database_error(error: sqlx::Error) -> ApiError {
    tracing::error!(error = %error, "calendar database operation failed");
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ErrorResponse {
            error: "The database is temporarily unavailable".to_string(),
            code: "DATABASE_UNAVAILABLE".to_string(),
        }),
    )
}

fn api_error_from_calendar(err: CalendarError) -> ApiError {
    let status = match err.code.as_str() {
        "EVENT_NOT_FOUND" => StatusCode::NOT_FOUND,
        "INVALID_CALENDAR_EVENT" => StatusCode::BAD_REQUEST,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    };
    (
        status,
        Json(ErrorResponse {
            error: err.message,
            code: err.code,
        }),
    )
}

pub async fn require_username(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<String, ApiError> {
    require_session(state, headers)
        .await
        .map(|(claims, _)| claims.sub)
}

pub fn validate_event(
    title: &str,
    start_date: &str,
    end_date: &str,
    start_time: Option<&str>,
    end_time: Option<&str>,
    color: &str,
    is_multi_day: bool,
    is_all_day: bool,
) -> Result<(), CalendarError> {
    if title.trim().is_empty() || title.chars().count() > 200 {
        return Err(CalendarError::invalid("Title must contain 1-200 characters"));
    }
    let start = NaiveDate::parse_from_str(start_date, "%Y-%m-%d")
        .map_err(|_| CalendarError::invalid("startDate must use YYYY-MM-DD format"))?;
    let end = NaiveDate::parse_from_str(end_date, "%Y-%m-%d")
        .map_err(|_| CalendarError::invalid("endDate must use YYYY-MM-DD format"))?;
    if end < start {
        return Err(CalendarError::invalid("endDate cannot be before startDate"));
    }
    if !is_multi_day && start != end {
        return Err(CalendarError::invalid(
            "Single-day events must use the same startDate and endDate",
        ));
    }
    if !is_valid_color(color) {
        return Err(CalendarError::invalid("color must be a #RRGGBB value"));
    }

    if is_all_day {
        if start_time.is_some() || end_time.is_some() {
            return Err(CalendarError::invalid(
                "All-day events cannot include startTime or endTime",
            ));
        }
    } else {
        let (Some(start_time), Some(end_time)) = (start_time, end_time) else {
            return Err(CalendarError::invalid("Timed events require startTime and endTime"));
        };
        NaiveTime::parse_from_str(start_time, "%H:%M")
            .map_err(|_| CalendarError::invalid("startTime must use HH:MM format"))?;
        NaiveTime::parse_from_str(end_time, "%H:%M")
            .map_err(|_| CalendarError::invalid("endTime must use HH:MM format"))?;
    }
    Ok(())
}

fn is_valid_color(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

pub async fn get_events(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<CalendarEvent>>, ApiError> {
    let username = require_username(&state, &headers).await?;
    repository::list_events(&state.pool, &username)
        .await
        .map(Json)
        .map_err(database_error)
}

pub async fn create_event(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(draft): Json<CalendarEventDraft>,
) -> Result<Json<CalendarEvent>, ApiError> {
    let username = require_username(&state, &headers).await?;
    validate_event(
        &draft.title,
        &draft.start_date,
        &draft.end_date,
        draft.start_time.as_deref(),
        draft.end_time.as_deref(),
        &draft.color,
        draft.is_multi_day,
        draft.is_all_day,
    )
    .map_err(api_error_from_calendar)?;
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
    repository::create_event(&state.pool, &username, &event)
        .await
        .map_err(database_error)?;

    // Broadcast to all WS clients of the same user
    let payload = serde_json::to_string(&WsPush::event_created(event.clone())).unwrap_or_default();
    state.broadcast_to_user(&username, axum::extract::ws::Message::Text(payload));

    Ok(Json(event))
}

pub async fn update_event(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(updated): Json<CalendarEvent>,
) -> Result<Json<CalendarEvent>, ApiError> {
    let username = require_username(&state, &headers).await?;
    if updated.id != id {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Event id does not match the request path".to_string(),
                code: "EVENT_ID_MISMATCH".to_string(),
            }),
        ));
    }
    validate_event(
        &updated.title,
        &updated.start_date,
        &updated.end_date,
        updated.start_time.as_deref(),
        updated.end_time.as_deref(),
        &updated.color,
        updated.is_multi_day,
        updated.is_all_day,
    )
    .map_err(api_error_from_calendar)?;
    if !repository::update_event(&state.pool, &username, &id, &updated)
        .await
        .map_err(database_error)?
    {
        return Err(api_error_from_calendar(CalendarError::not_found(&id)));
    }

    let payload = serde_json::to_string(&WsPush::event_updated(updated.clone())).unwrap_or_default();
    state.broadcast_to_user(&username, axum::extract::ws::Message::Text(payload));

    Ok(Json(updated))
}

#[cfg(test)]
mod tests {
    use super::validate_event;

    #[test]
    fn rejects_invalid_calendar_payloads() {
        assert!(
            validate_event(
                "Meeting",
                "2026-07-23",
                "2026-07-22",
                Some("09:00"),
                Some("10:00"),
                "#ff9fd0",
                true,
                false,
            )
            .is_err()
        );
        assert!(
            validate_event(
                "Meeting",
                "2026-07-23",
                "2026-07-23",
                None,
                None,
                "blue",
                false,
                true,
            )
            .is_err()
        );
    }

    #[test]
    fn accepts_a_valid_calendar_payload() {
        assert!(
            validate_event(
                "Meeting",
                "2026-07-23",
                "2026-07-23",
                Some("09:00"),
                Some("10:00"),
                "#ff9fd0",
                false,
                false,
            )
            .is_ok()
        );
    }
}

pub async fn delete_event(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let username = require_username(&state, &headers).await?;
    if !repository::delete_event(&state.pool, &username, &id)
        .await
        .map_err(database_error)?
    {
        return Err(api_error_from_calendar(CalendarError::not_found(&id)));
    }

    let payload = WsPush::event_deleted(&id);
    let json = serde_json::to_string(&payload).unwrap_or_default();
    state.broadcast_to_user(&username, axum::extract::ws::Message::Text(json));

    Ok(StatusCode::NO_CONTENT)
}
