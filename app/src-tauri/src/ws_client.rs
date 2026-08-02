//! Unified WebSocket client for the Tauri desktop app.
//!
//! Replaces the separate `/ws/status` listener with a single connection to
//! `/ws/app` that handles both request-response (calendar CRUD) and server-
//! initiated push (status updates, calendar event broadcasts).
//!
//! Architecture:
//! - `WsClient` is a lightweight handle (wraps an `Option<mpsc::UnboundedSender>`)
//!   stored in Tauri state. Invoke commands call `send_request()` which forwards
//!   through a channel.
//! - A background task (`spawn_ws_loop`) owns the receiver, manages the WS
//!   connection lifecycle, and dispatches responses back to awaiting invoke calls
//!   via `oneshot` channels. It also emits Tauri events for push messages.
//! - If the WS connection is down, `send_request` fails fast — callers should
//!   fall back to HTTP (existing invoke commands in `calendar.rs` retain
//!   their HTTP implementations as fallback).

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use uuid::Uuid;

use crate::{server_config, session_store};

/// Tauri event name for live status updates (same as `status.rs`).
pub const SERVER_STATUS_EVENT: &str = "server-status";

/// Event emitted when a calendar event is created/updated/deleted by another
/// connection of the same user. Payload is a stringified JSON WsPush.
pub const CALENDAR_EVENT_PUSH_EVENT: &str = "calendar-event-pushed";

// ─── Wire protocol types (mirror backend/src/handlers/ws.rs) ──────────────────

#[derive(Debug, Deserialize)]
pub struct WsResponse {
    pub id: String,
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<WsError>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct WsError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct WsPush {
    #[serde(rename = "type")]
    pub kind: String,
    pub method: String,
    pub params: serde_json::Value,
}

// ─── Internal: request from invoke command → WS processor task ────────────────

struct WsClientRequest {
    id: String,
    method: String,
    params: serde_json::Value,
    respond_to: oneshot::Sender<Result<serde_json::Value, WsError>>,
}

// ─── Public handle stored in Tauri state ──────────────────────────────────────

pub struct WsClient {
    sender: std::sync::Mutex<Option<mpsc::UnboundedSender<WsClientRequest>>>,
}

impl Default for WsClient {
    fn default() -> Self {
        Self::new()
    }
}

impl WsClient {
    pub fn new() -> Self {
        WsClient {
            sender: std::sync::Mutex::new(None),
        }
    }

    fn set_sender(&self, tx: mpsc::UnboundedSender<WsClientRequest>) {
        *self.sender.lock().expect("ws_sender mutex poisoned") = Some(tx);
    }

    pub fn is_connected(&self) -> bool {
        self.sender.lock().expect("ws_sender mutex poisoned").is_some()
    }

    /// Sends a request over WS and waits for the response.
    /// Fails immediately if the WS client is not initialized.
    pub async fn send_request(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let tx = match self.sender.lock() {
            Ok(guard) => match guard.as_ref() {
                Some(tx) => tx.clone(),
                None => return Err("WebSocket client is not initialized".to_string()),
            },
            Err(_) => return Err("WebSocket mutex poisoned".to_string()),
        };

        let id = Uuid::new_v4().to_string();
        let (resp_tx, resp_rx) = oneshot::channel();
        let req = WsClientRequest {
            id: id.clone(),
            method: method.to_string(),
            params,
            respond_to: resp_tx,
        };

        tx.send(req).map_err(|_| "WebSocket processor shut down".to_string())?;

        let timeout = Duration::from_secs(10);
        match tokio::time::timeout(timeout, resp_rx).await {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(ws_err))) => Err(format!("{}: {}", ws_err.code, ws_err.message)),
            Ok(Err(_)) => Err("WebSocket processor disconnected".to_string()),
            Err(_) => Err("WebSocket request timed out after 10s".to_string()),
        }
    }
}

// ─── Background task ──────────────────────────────────────────────────────────

const RECONNECT_DELAY_SECS: u64 = 3;

pub fn spawn_ws_loop(app: AppHandle, ws_client: std::sync::Arc<WsClient>) {
    let (tx, rx) = mpsc::unbounded_channel::<WsClientRequest>();
    ws_client.set_sender(tx);

    tauri::async_runtime::spawn(async move {
        ws_loop(app, rx).await;
    });
}

async fn ws_loop(
    app: AppHandle,
    mut rx: mpsc::UnboundedReceiver<WsClientRequest>,
) {
    tracing::info!("[ws_client] starting unified WS loop");

    loop {
        let (server_url, token) = match (
            server_config::load_server_url(&app),
            session_store::load_session(&app),
        ) {
            (Some(url), Some(session)) => (url, session.token),
            _ => {
                // No server configured or no session — wait and retry silently.
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
        };

        match run_ws_session(&app, &server_url, &token, &mut rx).await {
            WsSessionResult::Reconnect => {
                tracing::warn!(
                    "[ws_client] disconnected, reconnecting in {}s",
                    RECONNECT_DELAY_SECS
                );
                tokio::time::sleep(Duration::from_secs(RECONNECT_DELAY_SECS)).await;
            }
        }
    }
}

enum WsSessionResult {
    Reconnect,
}

struct PendingRequest {
    respond_to: oneshot::Sender<Result<serde_json::Value, WsError>>,
    sent_at: Instant,
}

const REQUEST_TIMEOUT_SECS: u64 = 10;

async fn run_ws_session(
    app: &AppHandle,
    server_url: &str,
    token: &str,
    rx: &mut mpsc::UnboundedReceiver<WsClientRequest>,
) -> WsSessionResult {
    let ws_url = match server_config::require_ws_url_from(server_url, "/ws/app") {
        Ok(url) => url,
        Err(e) => {
            tracing::error!(error = %e, "[ws_client] failed to construct WS URL");
            return WsSessionResult::Reconnect;
        }
    };

    tracing::info!("[ws_client] connecting to {}", ws_url);
    let mut request = match ws_url.into_client_request() {
        Ok(req) => req,
        Err(e) => {
            tracing::error!(error = %e, "[ws_client] failed to build WS request");
            return WsSessionResult::Reconnect;
        }
    };

    if let Ok(header_value) = HeaderValue::from_str(token) {
        request.headers_mut().insert("x-session-token", header_value);
    } else {
        tracing::error!("[ws_client] invalid session token");
        return WsSessionResult::Reconnect;
    }

    let (ws_stream, _) = match tokio_tungstenite::connect_async(request).await {
        Ok(stream) => stream,
        Err(e) => {
            tracing::warn!(error = %e, "WS connection failed");
            return WsSessionResult::Reconnect;
        }
    };

    let (mut writer, mut reader) = ws_stream.split();
    tracing::info!("[ws_client] connected to /ws/app");

    let mut pending: std::collections::HashMap<String, PendingRequest> =
        std::collections::HashMap::new();

    loop {
        tokio::select! {
            // Incoming requests from invoke commands (forward to server)
            req = rx.recv() => {
                match req {
                    Some(req) => {
                        let ws_req = serde_json::json!({
                            "id": req.id,
                            "method": req.method,
                            "params": req.params,
                        });
                        let text = match serde_json::to_string(&ws_req) {
                            Ok(s) => s,
                            Err(_) => {
                                let _ = req.respond_to.send(Err(WsError {
                                    code: "ENCODE_ERROR".to_string(),
                                    message: "Failed to serialize request".to_string(),
                                }));
                                continue;
                            }
                        };
                        pending.insert(req.id.clone(), PendingRequest {
                            respond_to: req.respond_to,
                            sent_at: Instant::now(),
                        });

                        if let Err(e) = writer.send(WsMessage::Text(text)).await {
                            tracing::warn!(error = %e, "[ws_client] failed to send WS request");
                            return drain_pending_and_reconnect(&mut pending);
                        }
                    }
                    None => {
                        // All senders dropped
                        return drain_pending_and_reconnect(&mut pending);
                    }
                }
            }

            // Incoming messages from server (responses + pushes)
            msg = reader.next() => {
                match msg {
                    Some(Ok(WsMessage::Text(text))) => {
                        // Try parsing as push first
                        if let Ok(push) = serde_json::from_str::<WsPush>(&text) {
                            if push.kind == "push" {
                                handle_push(app, &push);
                                continue;
                            }
                        }
                        // Then try as response
                        if let Ok(resp) = serde_json::from_str::<WsResponse>(&text) {
                            if let Some(pr) = pending.remove(&resp.id) {
                                let _ = pr.respond_to.send(
                                    resp.result.ok_or_else(|| WsError {
                                        code: resp.error.as_ref()
                                            .map(|e| e.code.clone())
                                            .unwrap_or_else(|| "UNKNOWN_ERROR".to_string()),
                                        message: resp.error.as_ref()
                                            .map(|e| e.message.clone())
                                            .unwrap_or_else(|| "Unknown error".to_string()),
                                    })
                                );
                            }
                        }
                    }
                    Some(Ok(WsMessage::Ping(bytes))) => {
                        if let Err(e) = writer.send(WsMessage::Pong(bytes)).await {
                            tracing::warn!(error = %e, "[ws_client] failed to send pong");
                            return drain_pending_and_reconnect(&mut pending);
                        }
                    }
                    Some(Ok(WsMessage::Pong(_))) => {}
                    Some(Ok(WsMessage::Close(_))) | None => {
                        tracing::info!("[ws_client] server closed connection");
                        return drain_pending_and_reconnect(&mut pending);
                    }
                    Some(Ok(WsMessage::Frame(_))) => {} // Control frames handled internally
                    Some(Ok(WsMessage::Binary(_))) => {}
                    Some(Err(e)) => {
                        tracing::warn!(error = %e, "[ws_client] WS error");
                        return drain_pending_and_reconnect(&mut pending);
                    }
                }
            }
        }

        // Check for timed-out requests (after each select arm)
        let now = Instant::now();
        let timed_out: Vec<String> = pending
            .iter()
            .filter(|(_, pr)| now.duration_since(pr.sent_at).as_secs() >= REQUEST_TIMEOUT_SECS)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &timed_out {
            if let Some(pr) = pending.remove(id) {
                let _ = pr.respond_to.send(Err(WsError {
                    code: "TIMEOUT".to_string(),
                    message: format!("Request timed out after {}s", REQUEST_TIMEOUT_SECS),
                }));
            }
        }
    }
}

fn drain_pending_and_reconnect(
    pending: &mut std::collections::HashMap<String, PendingRequest>,
) -> WsSessionResult {
    let err = WsError {
        code: "WS_DISCONNECTED".to_string(),
        message: "WebSocket connection lost".to_string(),
    };
    for (_, pr) in pending.drain() {
        let _ = pr.respond_to.send(Err(err.clone()));
    }
    WsSessionResult::Reconnect
}

fn handle_push(app: &AppHandle, push: &WsPush) {
    match push.method.as_str() {
        "status.update" => {
            // Re-emit as the same Tauri event the old status listener used.
            // The payload is the raw JSON value from params.
            let _ = app.emit(SERVER_STATUS_EVENT, push.params.clone());
            tracing::debug!("[ws_client] emitted status.update");
        }
        "calendar.event.created" | "calendar.event.updated" | "calendar.event.deleted" => {
            // Emit as a stringified JSON so the React listener can parse it.
            if let Ok(json) = serde_json::to_string(&push) {
                let _ = app.emit(CALENDAR_EVENT_PUSH_EVENT, json);
                tracing::debug!("[ws_client] emitted {}", push.method);
            }
        }
        _ => {
            tracing::debug!("[ws_client] received unknown push method: {}", push.method);
        }
    }
}
