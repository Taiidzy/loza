//
//  SessionStore.swift
//  Loza
//
//  Хранилище сессии на стороне iOS.
//
//  Зеркалирует backend/src-tauri/src/session_store.rs: сохраняет AuthState
//  (токен + метаданные пользователя) в Keychain через KeychainStore, а не в
//  UserDefaults — чтобы токен был защищён системным доступом (kSecAttrAccessibleWhenUnlockedThisDeviceOnly).
//
//  SessionStore — единый источник правды для текущей сессии. SwiftUI биндится
//  на @Published session; остальные слои (LozaAPIClient, CalendarService,
//  StatusSocket, UserManagementService) читают токен через SessionStore.shared.
//

import Foundation
import Combine

struct AuthState: Codable, Equatable {
    let token: String
    let username: String
    let displayName: String
    let role: String
    let device: String
    let expiresAt: TimeInterval
}

@MainActor
final class SessionStore: ObservableObject {
    static let shared = SessionStore()

    @Published private(set) var session: AuthState?

    private let key = "loza_session"

    private init() {
        session = KeychainStore.getCodable(AuthState.self, for: key)
    }

    func save(_ state: AuthState) {
        KeychainStore.setCodable(state, for: key)
        session = state
    }

    func clear() {
        KeychainStore.delete(key)
        session = nil
    }

    /// Re-checks expiry, mirroring loadSession()'s Date.now() > expires_at check.
    func refreshValidity() {
        guard let s = session else { return }
        if Date().timeIntervalSince1970 > s.expiresAt {
            clear()
        }
    }
}
