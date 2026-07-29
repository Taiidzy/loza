import { invoke } from "@tauri-apps/api/core";
import { logger } from "../shared/utils/logger";

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
  logger.info("auth", "invoke(login)", { username, password: "*".repeat(password.length) });
  try {
    const result = await invoke<UserInfo>("login", { username, password });
    logger.info("auth", "login succeeded", result);
    return result;
  } catch (err) {
    // Rust-команды при ошибке возвращают строку (см. describe_error в auth.rs) —
    // именно её и увидим здесь целиком, до любой локализации в AuthPage.
    logger.error("auth", "login failed", err);
    throw err;
  }
}

/**
 * Возвращает текущего залогиненного пользователя (если сессия есть и валидна)
 * или null. Используется при старте приложения (ProtectedRoute) — не требует
 * токена, Rust сам знает, что и как проверять.
 */
export async function getCurrentUser(): Promise<UserInfo | null> {
  let user = await invoke<UserInfo | null>("get_current_user");
  logger.info("auth", "invoke(get_current_user)", user)
  return user;
}

/**
 * Отзывает сессию на сервере и очищает локальное (Rust) хранилище.
 */
export async function authLogout(): Promise<void> {
  await invoke<void>("logout");
}

/**
 * Проверяет доступность Loza-сервера по конкретному адресу — используется
 * на экране ввода адреса сервера, до того как адрес сохранён.
 */
export async function checkServerHealth(url: string): Promise<boolean> {
  logger.info("auth", "invoke(health_check)", url);
  try {
    const ok = await invoke<boolean>("health_check", { url });
    logger.info("auth", "health_check completed", ok);
    return ok;
  } catch (err) {
    logger.error("auth", "health_check failed", err);
    return false;
  }
}

// ─── Адрес сервера ───────────────────────────────────────────────────────────
//
// Раньше адрес сервера был вкопан в Rust-константу (SERVER_URL = "http://localhost:4242").
// Теперь он вводится один раз на первом экране (см. pages/server-setup/ServerSetupPage)
// и хранится в Rust (тем же tauri-plugin-store, что и сессия) — React его не хранит
// сам, только читает/пишет через invoke, как и с токеном.

/**
 * Текущий сохранённый адрес сервера, или null, если он ещё не настроен
 * (первый запуск приложения).
 */
export async function getServerUrl(): Promise<string | null> {
  return await invoke<string | null>("get_server_url");
}

/**
 * Нормализует и сохраняет адрес сервера. Возвращает нормализованную форму
 * (со схемой, без конечного слэша), чтобы отобразить её как есть.
 */
export async function setServerUrl(url: string): Promise<string> {
  logger.info("auth", "invoke(set_server_url)", url);
  const normalized = await invoke<string>("set_server_url", { url });
  logger.info("auth", "server URL saved", normalized);
  return normalized;
}

/**
 * Сбрасывает сохранённый адрес — используется в "Сменить сервер" в настройках.
 */
export async function clearServerUrl(): Promise<void> {
  await invoke<void>("clear_server_url");
}
