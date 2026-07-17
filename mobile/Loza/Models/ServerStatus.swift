//
//  ServerStatus.swift
//  Loza
//
//  Mirrors api/serverStatus.ts. `ServerStatusService.fetch()` currently
//  returns a mock, exactly like the TS version — swap its body for a
//  real network/Tauri-equivalent call later; the shape shouldn't need
//  to change.
//

import SwiftUI

struct ServiceState: Identifiable, Equatable {
    let id: String
    let label: String
    let ok: Bool
}

enum ActivityType: String {
    case info, ok, warn, error

    var color: Color {
        switch self {
        case .ok:    return LozaColor.accentGreen
        case .error: return LozaColor.accentRed
        case .warn:  return LozaColor.accentYellow
        case .info:  return LozaColor.accentPink.opacity(0.6)
        }
    }
}

struct ActivityEvent: Identifiable, Equatable {
    let id = UUID()
    let time: String
    let msg: String
    let type: ActivityType
}

struct ClientInfo: Identifiable, Equatable {
    let id: String
    let name: String
    let device: String
    let active: Bool
    let lastSeen: Date
}

struct StorageCategory: Identifiable, Equatable {
    let id: String
    let label: String
    let bytes: Int64
    let color: Color
}

struct StorageInfo: Equatable {
    let totalBytes: Int64
    let usedBytes: Int64
    let categories: [StorageCategory]
    let history7d: [Double]

    var usedFraction: Double {
        guard totalBytes > 0 else { return 0 }
        return Double(usedBytes) / Double(totalBytes)
    }

    var usedPercent: Int {
        Int((min(1.0, usedFraction) * 100).rounded())
    }

    var freeBytes: Int64 { totalBytes - usedBytes }
}

struct LoadInfo: Equatable {
    let cpuPercent: Int
    let memPercent: Int
    let history: [Double]
}

struct ServerStatus: Equatable {
    let services: [ServiceState]
    let clients: [ClientInfo]
    let storage: StorageInfo
    let load: LoadInfo
    let activity: [ActivityEvent]
    let updatedAt: Date
}

// ─── Mock service ───────────────────────────────────────────────────────────

enum ServerStatusService {
    private static let GB: Int64 = 1024 * 1024 * 1024

    /// TODO(backend): replace body with a real fetch, e.g.
    ///   URLSession.shared.data(from: URL(string: "\(baseURL)/api/status")...)
    /// The `ServerStatus` shape is designed not to change when you do.
    static func fetch() async throws -> ServerStatus {
        try await Task.sleep(nanoseconds: 250_000_000) // simulate latency
        let now = Date()

        return ServerStatus(
            services: [
                ServiceState(id: "loza-server", label: "Loza Server", ok: true),
                ServiceState(id: "tauri-backend", label: "Tauri Backend", ok: true),
                ServiceState(id: "session-store", label: "Session Store", ok: true),
            ],
            clients: [
                ClientInfo(id: "c1", name: "MacBook Pro Ани", device: "macOS · Loza Desktop", active: true, lastSeen: now),
                ClientInfo(id: "c2", name: "iPhone 15", device: "iOS · Loza Mobile", active: false, lastSeen: now.addingTimeInterval(-3 * 3600)),
            ],
            storage: StorageInfo(
                totalBytes: 512 * GB,
                usedBytes: 214 * GB,
                categories: [
                    StorageCategory(id: "photos", label: "Фото", bytes: 92 * GB, color: LozaColor.accentPink),
                    StorageCategory(id: "video", label: "Видео", bytes: 68 * GB, color: LozaColor.accentPurple),
                    StorageCategory(id: "docs", label: "Документы", bytes: 24 * GB, color: LozaColor.accentBlue),
                    StorageCategory(id: "backups", label: "Бэкапы", bytes: 20 * GB, color: LozaColor.accentGreen),
                    StorageCategory(id: "other", label: "Прочее", bytes: 10 * GB, color: LozaColor.accentYellow),
                ],
                history7d: [38, 39, 40, 40, 41, 41.5, 41.8]
            ),
            load: LoadInfo(
                cpuPercent: 42,
                memPercent: 58,
                history: [30, 45, 38, 55, 48, 40, 42, 50, 44, 42]
            ),
            activity: [
                ActivityEvent(time: "02:14", msg: "Сессия открыта", type: .info),
                ActivityEvent(time: "02:12", msg: "Конфигурация загружена", type: .info),
                ActivityEvent(time: "01:58", msg: "Синхронизация завершена", type: .ok),
                ActivityEvent(time: "01:30", msg: "Подключение установлено", type: .ok),
                ActivityEvent(time: "00:45", msg: "Инициализация модулей", type: .info),
            ],
            updatedAt: now
        )
    }
}

// Shared byte formatter matching formatGB() in StorageOrb.tsx
enum ByteFormat {
    static func gb(_ bytes: Int64) -> String {
        let gb = Double(bytes) / pow(1024, 3)
        if gb >= 100 {
            return String(Int(gb.rounded()))
        }
        return String(format: "%.1f", gb)
    }

    static func gbInt(_ bytes: Int64) -> Int {
        Int((Double(bytes) / pow(1024, 3)).rounded())
    }
}
