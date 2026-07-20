import { invoke } from "@tauri-apps/api/core";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Данные о текущем пользователе. Намеренно не содержит токен — токен живёт
 * только в Tauri (Rust), React его никогда не видит и не хранит.
 */
export interface UserInfo {
  username: string;
  display_name: string;
  role: string;
}

// ─── Tauri command wrappers ───────────────────────────────────────────────────
//
// React ничего не знает о сервере, токенах или транспорте — вся эта логика
// (HTTP-запросы к backend'у, хранение и продление JWT) реализована в Rust
// (app/src-tauri/src/auth.rs, session_store.rs).

/**
 * Логинится через Tauri. При успехе сессия (включая токен) сохраняется
 * в Rust-хранилище; сюда возвращается только безопасный UserInfo.
 */
export async function authLogin(username: string, password: string): Promise<UserInfo> {
  return await invoke<UserInfo>("login", { username, password });
}

/**
 * Возвращает текущего залогиненного пользователя (если сессия есть и валидна)
 * или null. Используется при старте приложения (ProtectedRoute) — не требует
 * токена, Rust сам знает, что и как проверять.
 */
export async function getCurrentUser(): Promise<UserInfo | null> {
  return await invoke<UserInfo | null>("get_current_user");
}

/**
 * Отзывает сессию на сервере и очищает локальное (Rust) хранилище.
 */
export async function authLogout(): Promise<void> {
  await invoke<void>("logout");
}

/**
 * Проверяет доступность Loza-сервера.
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    return await invoke<boolean>("health_check");
  } catch {
    return false;
  }
}
