//! Единый WebSocket endpoint `/ws/app` — запрос-ответ + сервер-инициированные push.
//!
//! Протокол (JSON Lines, каждое сообщение на отдельной строке):
//!
//! Request (client → server):
//!   {"id":"<uuid>","method":"calendar.get","params":{}}
//!
//! Response (server → client, correlated by id):
//!   {"id":"<uuid>","result":{...}}        // success
//!   {"id":"<uuid>","error":{"code":"...","message":"..."}}  // failure
//!
//! Push (server → client, no id):
//!   {"type":"push","method":"status.update","params":{...}}
//!   {"type":"push","method":"calendar.event.created","params":{...}}
//!   {"type":"push","method":"calendar.event.updated","params":{...}}
//!   {"type":"push","method":"calendar.event.deleted","params":{"id":"..."}}
//!
//! Auth: клиент аутентифицируется через заголовок `x-session-token` при WebSocket handshake,
//! так же, как и в /ws/status. После аутентификации токен считается валидным на протяжении
//! всего соединения; сервер периодически проверяет сессию через touch_session.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::{extract::State, http::HeaderMap};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use uuid::Uuid;

use crate::handlers::auth::{ErrorResponse, require_session, touch_session};
use crate::handlers::calendar::{CalendarError, validate_event};
use crate::handlers::status::collect_server_status;
use crate::models::{CalendarEvent, CalendarEventDraft};
use crate::db::repository;
use crate::db::AppState;

const REQUEST_TIMEOUT_SECS: u64 = 10;
const STATUS_PUSH_INTERVAL_SECS: u64 = 2;

// ─── Message envelope types ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct WsRequest {
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct WsResponse {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<WsError>,
}

#[derive(Debug, Serialize)]
pub struct WsError {
    pub code: String,
    pub message: String,
}

impl From<CalendarError> for WsError {
    fn from(err: CalendarError) -> Self {
        WsError {
            code: err.code,
            message: err.message,
        }
    }
}

/// Server-initiated push message (no client request id).
#[derive(Debug, Serialize)]
pub struct WsPush {
    #[serde(rename = "type")]
    pub kind: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

impl WsPush {
    pub fn status_update(status: &crate::models::ServerStatus) -> Self {
        WsPush {
            kind: "push".to_string(),
            method: "status.update".to_string(),
            params: serde_json::to_value(status).ok(),
        }
    }

    pub fn event_created(event: CalendarEvent) -> Self {
        WsPush {
            kind: "push".to_string(),
            method: "calendar.event.created".to_string(),
            params: serde_json::to_value(event).ok(),
        }
    }

    pub fn event_updated(event: CalendarEvent) -> Self {
        WsPush {
            kind: "push".to_string(),
            method: "calendar.event.updated".to_string(),
            params: serde_json::to_value(event).ok(),
        }
    }

    pub fn event_deleted(id: &str) -> Self {
        WsPush {
            kind: "push".to_string(),
            method: "calendar.event.deleted".to_string(),
            params: Some(serde_json::json!({ "id": id })),
        }
    }
}

pub fn make_response(id: &str, result: serde_json::Value) -> Message {
    Message::Text(
        serde_json::to_string(&WsResponse {
            id: id.to_string(),
            result: Some(result),
            error: None,
        })
        .unwrap_or_default(),
    )
}

pub fn make_error(id: &str, code: &str, message: &str) -> Message {
    Message::Text(
        serde_json::to_string(&WsResponse {
            id: id.to_string(),
            result: None,
            error: Some(WsError {
                code: code.to_string(),
                message: message.to_string(),
            }),
        })
        .unwrap_or_default(),
    )
}

// ─── Request handlers ─────────────────────────────────────────────────────────

/// Processes a single client request, returning the result or error as a JSON value.
async fn handle_request(
    state: &AppState,
    username: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, WsError> {
    match method {
        "calendar.get" => {
            let events = repository::list_events(&state.pool, username)
                .await
                .map_err(|e| CalendarError::from(e))?;
            Ok(serde_json::to_value(events).unwrap_or_default())
        }

        "calendar.create" => {
            let draft: CalendarEventDraft =
                serde_json::from_value(params).map_err(|e| {
                    CalendarError::invalid(&format!("Invalid request params: {e}"))
                })?;

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
            .map_err(WsError::from)?;

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

            repository::create_event(&state.pool, username, &event)
                .await
                .map_err(CalendarError::from)?;

            // Broadcast to all connections of the same user
            let push = WsPush::event_created(event.clone());
            let json = serde_json::to_string(&push).unwrap_or_default();
            state.broadcast_to_user(username, Message::Text(json));

            Ok(serde_json::to_value(event).unwrap_or_default())
        }

        "calendar.update" => {
            let event: CalendarEvent =
                serde_json::from_value(params).map_err(|e| {
                    CalendarError::invalid(&format!("Invalid request params: {e}"))
                })?;

            validate_event(
                &event.title,
                &event.start_date,
                &event.end_date,
                event.start_time.as_deref(),
                event.end_time.as_deref(),
                &event.color,
                event.is_multi_day,
                event.is_all_day,
            )
            .map_err(WsError::from)?;

            if !repository::update_event(&state.pool, username, &event.id, &event)
                .await
                .map_err(CalendarError::from)?
            {
                return Err(CalendarError::not_found(&event.id).into());
            }

            let push = WsPush::event_updated(event.clone());
            let json = serde_json::to_string(&push).unwrap_or_default();
            state.broadcast_to_user(username, Message::Text(json));

            Ok(serde_json::to_value(event).unwrap_or_default())
        }

        "calendar.delete" => {
            #[derive(Deserialize)]
            struct DeleteParams {
                id: String,
            }
            let params: DeleteParams =
                serde_json::from_value(params).map_err(|e| {
                    CalendarError::invalid(&format!("Invalid request params: {e}"))
                })?;

            if !repository::delete_event(&state.pool, username, &params.id)
                .await
                .map_err(CalendarError::from)?
            {
                return Err(CalendarError::not_found(&params.id).into());
            }

            let push = WsPush::event_deleted(&params.id);
            let json = serde_json::to_string(&push).unwrap_or_default();
            state.broadcast_to_user(username, Message::Text(json));

            Ok(serde_json::Value::Null)
        }

        "status.get" => {
            let status = collect_server_status(state).await;
            Ok(serde_json::to_value(status).unwrap_or_default())
        }

        _ => Err(WsError {
            code: "METHOD_NOT_FOUND".to_string(),
            message: format!("Unknown method: {method}"),
        }),
    }
}

// ─── Connection handler ───────────────────────────────────────────────────────

pub async fn handle_ws_app(
    socket: WebSocket,
    state: AppState,
    username: String,
    token: String,
) {
    tracing::info!(username = %username, "WS /ws/app connection established");

    let (mut writer, mut reader) = socket.split();
    let (conn_id, mut broadcast_rx) = state.register_ws_client(&username);
    tracing::debug!(username = %username, conn_id = %conn_id, "registered WS client");

    let mut status_interval = tokio::time::interval(Duration::from_secs(STATUS_PUSH_INTERVAL_SECS));

    loop {
        tokio::select! {
            // Incoming client messages (requests)
            msg = reader.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(req) = serde_json::from_str::<WsRequest>(&text) {
                            let state_clone = state.clone();
                            let username_clone = username.clone();
                            let req_id = req.id.clone();
                            let method = req.method.clone();
                            let params = req.params.clone();

                            // Process request with timeout in a spawned task.
                            // The result is sent back through the broadcast channel's
                            // sibling — but actually we just send directly via writer.
                            let timeout = Duration::from_secs(REQUEST_TIMEOUT_SECS);
                            let result = tokio::time::timeout(
                                timeout,
                                handle_request(&state_clone, &username_clone, &method, params)
                            ).await;

                            let response = match result {
                                Ok(Ok(value)) => make_response(&req_id, value),
                                Ok(Err(ws_err)) => make_error(&req_id, &ws_err.code, &ws_err.message),
                                Err(_) => make_error(&req_id, "TIMEOUT", "Request timed out"),
                            };

                            if writer.send(response).await.is_err() {
                                break;
                            }
                        } else {
                            if writer.send(make_error("unknown", "PARSE_ERROR", "Invalid JSON message")).await.is_err() {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        tracing::debug!(username = %username, conn_id = %conn_id, "WS connection closed by client");
                        break;
                    }
                    Some(Ok(Message::Ping(bytes))) => {
                        if writer.send(Message::Pong(bytes)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Binary(_))) => {
                        if writer.send(make_error("unknown", "UNSUPPORTED", "Binary messages not supported")).await.is_err() {
                            break;
                        }
                    }
                    Some(Err(e)) => {
                        tracing::warn!(error = %e, username = %username, "WS connection error");
                        break;
                    }
                }
            }

            // Push messages from broadcasts (e.g., event created by another
            // connection of the same user)
            msg = broadcast_rx.recv() => {
                match msg {
                    Some(msg) => {
                        if writer.send(msg).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }

            // Status push timer
            _ = status_interval.tick() => {
                if touch_session(&state, &token).await.is_none() {
                    tracing::info!(username = %username, "WS session expired, disconnecting");
                    let _ = writer.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                        code: axum::extract::ws::CloseCode::from(1008u16),
                        reason: "Session expired".into(),
                    }))).await;
                    break;
                }

                let status = collect_server_status(&state).await;
                let push = WsPush::status_update(&status);
                let json = serde_json::to_string(&push).unwrap_or_default();
                if writer.send(Message::Text(json)).await.is_err() {
                    break;
                }
            }
        }
    }

    // Cleanup
    state.release_app_ws();
    state.unregister_ws_client(&username, conn_id);
    tracing::info!(username = %username, conn_id = %conn_id, "WS /ws/app connection cleaned up");
}

// ─── Upgrade handler ──────────────────────────────────────────────────────────

pub async fn ws_app(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<axum::response::Response, (axum::http::StatusCode, axum::response::Json<ErrorResponse>)> {
    let (_, session) = require_session(&state, &headers)
        .await
        .map_err(|_| {
            (
                axum::http::StatusCode::UNAUTHORIZED,
                axum::response::Json(ErrorResponse {
                    error: "Missing or invalid session token".to_string(),
                    code: "NO_TOKEN".to_string(),
                }),
            )
        })?;

    if !state.try_acquire_app_ws() {
        tracing::warn!(username = %session.username, "WS /ws/app connection rejected: capacity reached");
        return Err((
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            axum::response::Json(ErrorResponse {
                error: "Too many WebSocket connections".to_string(),
                code: "APP_WS_CAPACITY_REACHED".to_string(),
            }),
        ));
    }

    let username = session.username.clone();
    let username_for_failed = username.clone();
    let token = session.token.clone();

    tracing::info!(username = %username, "WS /ws/app upgrade accepted");

    Ok(ws
        .on_failed_upgrade(move |error| {
            tracing::warn!(error = %error, username = %username_for_failed, "WS /ws/app upgrade failed");
        })
        .on_upgrade(move |socket| handle_ws_app(socket, state.clone(), username, token)))
}
