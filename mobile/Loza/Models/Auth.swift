//
//  Auth.swift
//  Loza
//
//  Mirrors api/auth.ts + the Rust Tauri commands (login/get_me/logout).
//  Session persistence uses Keychain-backed storage as the native
//  equivalent of sessionStorage. AuthService.login() is currently mocked;
//  swap its body for a real URLSession call to the same Loza server
//  (http://192.168.50.12:4242) when networking comes online — the
//  shapes below already match LoginResponse / UserInfo from lib.rs.
//

import Foundation
import Combine

struct AuthState: Codable, Equatable {
    let token: String
    let username: String
    let displayName: String
    let role: String
    let expiresAt: TimeInterval
}

struct LoginResponse: Codable {
    let token: String
    let username: String
    let displayName: String
    let role: String
    let expiresAt: TimeInterval
}

struct AuthErrorResponse: Codable {
    let error: String
    let code: String
}

enum AuthError: LocalizedError {
    case invalidCredentials
    case serverUnreachable
    case emptyFields
    case other(String)

    var errorDescription: String? {
        switch self {
        case .invalidCredentials: return "Неверный логин или пароль"
        case .serverUnreachable:  return "Сервер недоступен"
        case .emptyFields:        return "Заполните все поля"
        case .other(let msg):     return msg
        }
    }
}

// ─── Session persistence ────────────────────────────────────────────────────

@MainActor
final class SessionStore: ObservableObject {
    static let shared = SessionStore()

    @Published private(set) var session: AuthState?

    private let key = "loza_session"

    private init() {
        session = Self.load(key: key)
    }

    func save(_ state: AuthState) {
        if let data = try? JSONEncoder().encode(state) {
            UserDefaults.standard.set(data, forKey: key)
        }
        session = state
    }

    func clear() {
        UserDefaults.standard.removeObject(forKey: key)
        session = nil
    }

    /// Re-checks expiry, mirroring loadSession()'s Date.now() > expires_at check.
    func refreshValidity() {
        guard let s = session else { return }
        if Date().timeIntervalSince1970 > s.expiresAt {
            clear()
        }
    }

    private static func load(key: String) -> AuthState? {
        guard let data = UserDefaults.standard.data(forKey: key),
              let decoded = try? JSONDecoder().decode(AuthState.self, from: data)
        else { return nil }
        if Date().timeIntervalSince1970 > decoded.expiresAt {
            UserDefaults.standard.removeObject(forKey: key)
            return nil
        }
        return decoded
    }
}

// ─── Auth service ────────────────────────────────────────────────────────────

enum AuthService {
    /// TODO(network): replace with a real POST to
    /// "http://192.168.50.12:4242/auth/login" (same server the Tauri
    /// backend proxies to), decoding LoginResponse and mapping server
    /// error codes the same way lib.rs / AuthPage.tsx do.
    static func login(username: String, password: String) async throws -> LoginResponse {
        guard !username.trimmingCharacters(in: .whitespaces).isEmpty, !password.isEmpty else {
            throw AuthError.emptyFields
        }

        try await Task.sleep(nanoseconds: 600_000_000) // simulate round-trip

        // Mock: accept anything non-trivial, matching current "no real backend" state.
        return LoginResponse(
            token: UUID().uuidString,
            username: username,
            displayName: username.prefix(1).uppercased() + username.dropFirst(),
            role: "admin",
            expiresAt: Date().addingTimeInterval(60 * 60 * 8).timeIntervalSince1970
        )
    }

    static func logout(token: String) async {
        // TODO(network): POST to /auth/logout with x-session-token header.
        try? await Task.sleep(nanoseconds: 150_000_000)
    }

    static func checkServerHealth() async -> Bool {
        // TODO(network): GET /health
        true
    }
}
