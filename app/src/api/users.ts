import { invoke } from "@tauri-apps/api/core";

export interface ManagedUser {
  username: string;
  display_name: string;
  role: "admin" | "user";
  quota_bytes: number | null;
}

export interface CreateUserInput {
  username: string;
  password: string;
  display_name?: string;
  role?: "admin" | "user";
  quota_bytes?: number | null;
}

export async function listUsers(): Promise<ManagedUser[]> {
  return invoke<ManagedUser[]>("list_users");
}

export async function createUser(request: CreateUserInput): Promise<ManagedUser> {
  return invoke<ManagedUser>("create_user", { request });
}

export async function changeUserPassword(
  username: string,
  request: { current_password?: string | null; new_password: string }
): Promise<void> {
  await invoke<void>("change_user_password", { username, request });
}

export async function updateUserQuota(username: string, quotaBytes: number | null): Promise<ManagedUser> {
  return invoke<ManagedUser>("update_user_quota", {
    username,
    request: { quota_bytes: quotaBytes },
  });
}

export async function deleteUser(username: string): Promise<void> {
  await invoke<void>("delete_user", { username });
}
