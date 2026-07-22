//
//  StatusDTO.swift
//  Loza
//
//  Wire types mirroring backend/src/models/status.rs field-for-field
//  (including the `#[serde(rename = ...)]` camelCase overrides). Kept
//  separate from the SwiftUI-facing ServerStatus/StorageInfo/etc. in
//  Models/ServerStatus.swift so the view layer isn't coupled to JSON
//  shape — StatusMapper below converts DTO -> view model.
//
//  Note there is intentionally no "services" field here: the real backend
//  only ever returns clients/storage/load/activity/updatedAt. An earlier
//  mock had invented a services list; that's dropped in the network-backed
//  version to stay faithful to the server.
//

import Foundation

struct ActivityEventDTO: Decodable {
    let time: String
    let msg: String
    let type: String // "info" | "ok" | "warn" | "error"
}

struct ClientInfoDTO: Decodable {
    let id: String
    let name: String
    let device: String
    let active: Bool
    let lastSeen: String // ISO8601
}

struct StorageCategoryDTO: Decodable {
    let id: String
    let label: String
    let bytes: UInt64
    let color: String // "#rrggbb"
}

struct StorageInfoDTO: Decodable {
    let totalBytes: UInt64
    let usedBytes: UInt64
    let categories: [StorageCategoryDTO]
    let history7d: [Double]
}

struct LoadInfoDTO: Decodable {
    let cpuPercent: Double
    let memPercent: Double
    let history: [Double]
}

struct ServerStatusDTO: Decodable {
    let clients: [ClientInfoDTO]
    let storage: StorageInfoDTO
    let load: LoadInfoDTO
    let activity: [ActivityEventDTO]
    let updatedAt: String
}
