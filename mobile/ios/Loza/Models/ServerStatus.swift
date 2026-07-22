//
//  ServerStatus.swift
//  Loza
//
//  Mirrors app/src/types/serverStatus.ts + backend/src/models/status.rs.
//  View-facing types live here (SwiftUI-friendly: Color, Date, Identifiable);
//  StatusMapper converts the wire DTOs (Services/StatusDTO.swift) into these.
//
//  Note: the real backend has no "services" concept — ServerStatus is only
//  clients/storage/load/activity/updatedAt. There is no separate service
//  health list to show, so the dashboard doesn't render one.
//

import SwiftUI

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

    init(rawValue: String) {
        switch rawValue {
        case "ok": self = .ok
        case "error": self = .error
        case "warn": self = .warn
        default: self = .info
        }
    }
}

struct ActivityEvent: Identifiable, Equatable {
    let id = UUID()
    let time: String
    let msg: String
    let type: ActivityType

    static func == (lhs: ActivityEvent, rhs: ActivityEvent) -> Bool {
        lhs.time == rhs.time && lhs.msg == rhs.msg && lhs.type == rhs.type
    }
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
    let clients: [ClientInfo]
    let storage: StorageInfo
    let load: LoadInfo
    let activity: [ActivityEvent]
    let updatedAt: Date
}

// ─── DTO -> view model mapping ──────────────────────────────────────────────

enum StatusMapper {
    static func map(_ dto: ServerStatusDTO) -> ServerStatus {
        ServerStatus(
            clients: dto.clients.map { c in
                ClientInfo(
                    id: c.id,
                    name: c.name,
                    device: c.device,
                    active: c.active,
                    lastSeen: ISO8601DateFormatter().date(from: c.lastSeen) ?? Date()
                )
            },
            storage: StorageInfo(
                totalBytes: Int64(dto.storage.totalBytes),
                usedBytes: Int64(dto.storage.usedBytes),
                categories: dto.storage.categories.map { cat in
                    StorageCategory(id: cat.id, label: cat.label, bytes: Int64(cat.bytes), color: Color(hexString: cat.color))
                },
                history7d: dto.storage.history7d
            ),
            load: LoadInfo(
                cpuPercent: Int(dto.load.cpuPercent.rounded()),
                memPercent: Int(dto.load.memPercent.rounded()),
                history: dto.load.history
            ),
            activity: dto.activity.map { a in
                ActivityEvent(time: a.time, msg: a.msg, type: ActivityType(rawValue: a.type))
            },
            updatedAt: ISO8601DateFormatter().date(from: dto.updatedAt) ?? Date()
        )
    }
}

// ─── Networked status service ───────────────────────────────────────────────

enum ServerStatusService {
    /// GET /status, mirrors app/src/api/serverStatus.ts::fetchServerStatus.
    /// The desktop app also has a WS push stream proxied through Tauri;
    /// on mobile we simply poll (see DashboardView's pollTimer), which is
    /// simpler and battery-friendlier for a foregrounded screen.
    static func fetch() async throws -> ServerStatus {
        guard let baseURL = await ServerConfig.shared.baseURL else {
            throw AuthError.noServerConfigured
        }
        guard let token = await SessionStore.shared.session?.token else {
            throw AuthError.invalidCredentials
        }
        let dto = try await LozaAPIClient.shared.fetchStatus(baseURL: baseURL, token: token)
        return StatusMapper.map(dto)
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
