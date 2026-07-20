import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ServerStatus } from '../types/serverStatus';

const SERVER_STATUS_EVENT = "server-status";

/**
 * Разовый снимок текущего состояния сервера — используется для первого
 * рендера, до того как придёт первое событие подписки.
 */
export async function fetchServerStatus(): Promise<ServerStatus> {
  return await invoke<ServerStatus>("get_server_status");
}

/**
 * Подписывается на поток обновлений статуса сервера (Tauri-событие,
 * под капотом — WebSocket-соединение Rust-слоя с backend'ом).
 * Возвращает функцию отписки.
 */
export async function subscribeServerStatus(
  onUpdate: (status: ServerStatus) => void
): Promise<UnlistenFn> {
  return await listen<ServerStatus>(SERVER_STATUS_EVENT, (event) => {
    onUpdate(event.payload);
  });
}