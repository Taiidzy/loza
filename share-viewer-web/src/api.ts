export interface ShareMeta {
  name: string;
  isDir: boolean;
  hasPassword: boolean;
  isActive: boolean;
  createdAt: string;
  expiresAt: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  sha256: string | null;
}

export interface ShareEntry {
  id: string;
  path: string;
  name: string;
  isDir: boolean;
  sizeBytes: number;
  mimeType: string | null;
  createdAt: string;
  updatedAt: string;
  sha256: string | null;
}

export interface UnlockResponse {
  access: string;
}

/** Абсолютный путь текущей страницы: `<origin>/share/<token>…`. */
export function tokenFromPath(): string | null {
  const match = window.location.pathname.match(/^\/share\/([a-f0-9]{64})\/?$/);
  return match ? match[1] : null;
}

class ApiError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("Нет соединения с сервером");
  }
  if (!response.ok) {
    let message = `Ошибка ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.error === "string" && body.error) {
        message = body.error;
      }
    } catch {
      /* ignore malformed body */
    }
    throw new ApiError(message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const shareApi = {
  meta(token: string): Promise<ShareMeta> {
    return request(`/share/api/${token}/meta`);
  },

  unlock(token: string, password: string): Promise<UnlockResponse> {
    return request(`/share/api/${token}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  },

  list(token: string, access: string, path: string): Promise<ShareEntry[]> {
    const q = new URLSearchParams({ access });
    if (path) q.set("path", path);
    return request(`/share/api/${token}/list?${q.toString()}`);
  },

  /** URL для прямого просмотра в браузере (inline). */
  previewUrl(token: string, access: string, path: string): string {
    const q = new URLSearchParams({ access });
    if (path) q.set("path", path);
    return `/share/api/${token}/preview?${q.toString()}`;
  },

  /** URL для скачивания (attachment + Range). */
  downloadUrl(token: string, access: string, path: string): string {
    const q = new URLSearchParams({ access });
    if (path) q.set("path", path);
    return `/share/api/${token}/download?${q.toString()}`;
  },
};