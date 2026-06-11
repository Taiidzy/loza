import { invoke } from "@tauri-apps/api/core";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
  username: string;
  display_name: string;
  role: string;
  expires_at: number;
}

export interface UserInfo {
  username: string;
  display_name: string;
  role: string;
  session_created_at: number;
}

export interface AuthState {
  token: string;
  username: string;
  display_name: string;
  role: string;
  expires_at: number;
}

// ─── Session storage keys ─────────────────────────────────────────────────────

const SESSION_KEY = "loza_session";

// ─── Persistence helpers ──────────────────────────────────────────────────────

export function saveSession(data: AuthState): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

export function loadSession(): AuthState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s: AuthState = JSON.parse(raw);
    // Check expiry
    if (Date.now() / 1000 > s.expires_at) {
      clearSession();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

// ─── Tauri command wrappers ───────────────────────────────────────────────────

/**
 * React -> Tauri Backend -> Rust Server -> response
 * Authenticates with the standalone Loza server via the Tauri proxy.
 */
export async function authLogin(
  username: string,
  password: string
): Promise<LoginResponse> {
  // invoke() throws a string on error (from Rust's Err(String))
  const result = await invoke<LoginResponse>("login", { username, password });
  return result;
}

/**
 * Validate current session token against the server.
 */
export async function authGetMe(token: string): Promise<UserInfo> {
  return await invoke<UserInfo>("get_me", { token });
}

/**
 * Invalidate the session on the server and clear local storage.
 */
export async function authLogout(token: string): Promise<void> {
  await invoke<void>("logout", { token });
  clearSession();
}

/**
 * Check if the Loza server is reachable.
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    return await invoke<boolean>("health_check");
  } catch {
    return false;
  }
}