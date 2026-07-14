// ─── Server status types ────────────────────────────────────────────────────
// Единая точка входа для данных о состоянии Loza-сервера.
// Сейчас fetchServerStatus() отдаёт мок. Когда появится реальный API/Tauri
// invoke — меняется только тело этой функции, компоненты трогать не надо.

export interface ServiceState {
  id: string;
  label: string;
  ok: boolean;
}

export interface ActivityEvent {
  time: string;
  msg: string;
  type: "info" | "ok" | "warn" | "error";
}

export interface ClientInfo {
  id: string;
  name: string;
  device: string;
  active: boolean;
  lastSeen: string; // ISO
}

export interface StorageCategory {
  id: string;
  label: string;
  bytes: number;
  color: string;
}

export interface StorageInfo {
  totalBytes: number;
  usedBytes: number;
  categories: StorageCategory[];
  history7d: number[]; // % used, last 7 days
}

export interface LoadInfo {
  cpuPercent: number;
  memPercent: number;
  history: number[]; // last N samples, %
}

export interface ServerStatus {
  services: ServiceState[];
  clients: ClientInfo[];
  storage: StorageInfo;
  load: LoadInfo;
  activity: ActivityEvent[];
  updatedAt: string;
}

// ─── Mock ────────────────────────────────────────────────────────────────────

const GB = 1024 ** 3;

function mockServerStatus(): ServerStatus {
  const now = new Date();

  return {
    services: [
      { id: "loza-server", label: "Loza Server", ok: true },
      { id: "tauri-backend", label: "Tauri Backend", ok: true },
      { id: "session-store", label: "Session Store", ok: true },
    ],
    clients: [
      { id: "c1", name: "MacBook Pro Ани", device: "macOS · Loza Desktop", active: true, lastSeen: now.toISOString() },
      { id: "c2", name: "iPhone 15", device: "iOS · Loza Mobile", active: false, lastSeen: new Date(now.getTime() - 3 * 3600e3).toISOString() },
    ],
    storage: {
      totalBytes: 512 * GB,
      usedBytes: 214 * GB,
      categories: [
        { id: "photos", label: "Фото", bytes: 92 * GB, color: "#ff9fd0" },
        { id: "video", label: "Видео", bytes: 68 * GB, color: "#b478ff" },
        { id: "docs", label: "Документы", bytes: 24 * GB, color: "#5fb8ff" },
        { id: "backups", label: "Бэкапы", bytes: 20 * GB, color: "#3ecf6e" },
        { id: "other", label: "Прочее", bytes: 10 * GB, color: "#ffbd2e" },
      ],
      history7d: [38, 39, 40, 40, 41, 41.5, 41.8],
    },
    load: {
      cpuPercent: 42,
      memPercent: 58,
      history: [30, 45, 38, 55, 48, 40, 42, 50, 44, 42],
    },
    activity: [
      { time: "02:14", msg: "Сессия открыта", type: "info" },
      { time: "02:12", msg: "Конфигурация загружена", type: "info" },
      { time: "01:58", msg: "Синхронизация завершена", type: "ok" },
      { time: "01:30", msg: "Подключение установлено", type: "ok" },
      { time: "00:45", msg: "Инициализация модулей", type: "info" },
    ],
    updatedAt: now.toISOString(),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Возвращает текущее состояние сервера.
 *
 * TODO(backend): заменить на реальный источник, например:
 *   const res = await fetch(`${API_BASE}/api/status`, { headers: authHeaders(token) });
 *   return res.json();
 * или через Tauri:
 *   return invoke<ServerStatus>("get_server_status");
 *
 * Форма ServerStatus рассчитана на то, чтобы не меняться при замене.
 */
export async function fetchServerStatus(): Promise<ServerStatus> {
  // имитация сетевой задержки
  await new Promise((r) => setTimeout(r, 250));
  return mockServerStatus();
}