use serde::Serialize;

/// Зеркалит `ActivityEvent` из app/src/api/serverStatus.ts.
#[derive(Clone, Debug, Serialize)]
pub struct ActivityEvent {
    pub time: String,
    pub msg: String,
    #[serde(rename = "type")]
    pub kind: String, // "info" | "ok" | "warn" | "error"
}

/// Зеркалит `ClientInfo` из app/src/api/serverStatus.ts.
#[derive(Clone, Debug, Serialize)]
pub struct ClientInfo {
    pub id: String,
    pub name: String,
    pub device: String,
    pub active: bool,
    #[serde(rename = "lastSeen")]
    pub last_seen: String, // ISO
}

/// Зеркалит `StorageCategory` из app/src/api/serverStatus.ts.
#[derive(Clone, Debug, Serialize)]
pub struct StorageCategory {
    pub id: String,
    pub label: String,
    pub bytes: u64,
    pub color: String,
}

/// Зеркалит `StorageInfo` из app/src/api/serverStatus.ts.
#[derive(Clone, Debug, Serialize)]
pub struct StorageInfo {
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    #[serde(rename = "usedBytes")]
    pub used_bytes: u64,
    pub categories: Vec<StorageCategory>,
    pub history7d: Vec<f32>, // % занятости, последние 7 суток
}

/// Зеркалит `LoadInfo` из app/src/api/serverStatus.ts.
#[derive(Clone, Debug, Serialize)]
pub struct LoadInfo {
    #[serde(rename = "cpuPercent")]
    pub cpu_percent: f32,
    #[serde(rename = "memPercent")]
    pub mem_percent: f32,
    pub history: Vec<f32>,
}

/// Зеркалит `ServerStatus` из app/src/api/serverStatus.ts.
/// Это единственная форма, которую отдаёт backend — как по HTTP (на будущее),
/// так и по WebSocket (/ws/status).
#[derive(Clone, Debug, Serialize)]
pub struct ServerStatus {
    pub clients: Vec<ClientInfo>,
    pub storage: StorageInfo,
    pub load: LoadInfo,
    pub activity: Vec<ActivityEvent>,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
