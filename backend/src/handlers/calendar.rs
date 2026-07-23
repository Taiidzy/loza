use axum::{extract::Path, extract::State, http::StatusCode, response::Json};
use uuid::Uuid;

use crate::db::{AppState, repository};
use crate::handlers::auth::{ErrorResponse, require_session};
use crate::models::{CalendarEvent, CalendarEventDraft};

type ApiError = (StatusCode, Json<ErrorResponse>);

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

fn not_found(id: &str) -> ApiError {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: format!("Event with id {id} was not found"),
            code: "EVENT_NOT_FOUND".to_string(),
        }),
    )
}

fn require_username(state: &AppState, headers: &axum::http::HeaderMap) -> Result<String, ApiError> {
    require_session(state, headers).map(|(claims, _)| claims.sub)
}

pub async fn get_events(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<CalendarEvent>>, ApiError> {
    let username = require_username(&state, &headers)?;
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
    repository::create_event(&state.pool, &username, &event)
        .await
        .map_err(database_error)?;
    Ok(Json(event))
}

pub async fn update_event(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(updated): Json<CalendarEvent>,
) -> Result<Json<CalendarEvent>, ApiError> {
    let username = require_username(&state, &headers)?;
    if updated.id != id {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Event id does not match the request path".to_string(),
                code: "EVENT_ID_MISMATCH".to_string(),
            }),
        ));
    }
    if !repository::update_event(&state.pool, &username, &id, &updated)
        .await
        .map_err(database_error)?
    {
        return Err(not_found(&id));
    }
    Ok(Json(updated))
}

pub async fn delete_event(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let username = require_username(&state, &headers)?;
    if !repository::delete_event(&state.pool, &username, &id)
        .await
        .map_err(database_error)?
    {
        return Err(not_found(&id));
    }
    Ok(StatusCode::NO_CONTENT)
}
