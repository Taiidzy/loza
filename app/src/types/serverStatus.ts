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
  clients: ClientInfo[];
  storage: StorageInfo;
  load: LoadInfo;
  activity: ActivityEvent[];
  updatedAt: string;
}