//
//  Auth.swift
//  Loza
//
//  Mirrors api/auth.ts + the Rust Tauri commands (login/get_me/logout),
//  now backed by real networking through LozaAPIClient instead of a mock.
//  Session (JWT + user info) persists in the Keychain via KeychainStore —
//  the mobile equivalent of desktop's system credential storage. There is no
//  separate native process here to hide the token behind.
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

enum AuthError: LocalizedError {
    case invalidCredentials
    case serverUnreachable
    case emptyFields
    case noServerConfigured
    case other(String)

    var errorDescription: String? {
        switch self {
        case .invalidCredentials: return "Неверный логин или пароль"
        case .serverUnreachable:  return "Сервер недоступен"
        case .emptyFields:        return "Заполните все поля"
        case .noServerConfigured: return "Сначала укажите адрес сервера"
        case .other(let msg):     return msg
        }
    }

    /// Maps an APIError from the network layer to the equivalent local
    /// case, keeping call sites (AuthView) simple.
    static func from(_ error: Error) -> AuthError {
        if let api = error as? APIError {
            switch api {
            case .noServerConfigured:
                return .noServerConfigured
            case .transport:
                return .serverUnreachable
            case .server(let code, _):
                switch code {
                case "INVALID_CREDENTIALS": return .invalidCredentials
                case "EMPTY_FIELDS": return .emptyFields
                default: return .other(api.errorDescription ?? "Ошибка сервера")
                }
            default:
                return .other(api.errorDescription ?? "Ошибка сервера")
            }
        }
        return .other(error.localizedDescription)
    }
}

// ─── Session persistence ────────────────────────────────────────────────────

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

// ─── Auth service ────────────────────────────────────────────────────────────

enum AuthService {
    /// POST /auth/login against the configured server, mirrors auth.rs::login.
    static func login(username: String, password: String) async throws -> ServerLoginResponse {
        let trimmedUser = username.trimmingCharacters(in: .whitespaces)
        guard !trimmedUser.isEmpty, !password.isEmpty else {
            throw AuthError.emptyFields
        }
        guard let baseURL = await ServerConfig.shared.baseURL else {
            throw AuthError.noServerConfigured
        }

        do {
            return try await LozaAPIClient.shared.login(baseURL: baseURL, username: trimmedUser, password: password)
        } catch {
            throw AuthError.from(error)
        }
    }

    static func logout(token: String) async {
        guard let baseURL = await ServerConfig.shared.baseURL else { return }
        await LozaAPIClient.shared.logout(baseURL: baseURL, token: token)
    }

    /// GET /auth/me — used to validate a stored session on launch, mirrors
    /// auth.rs::get_current_user (minus the "return safe UserInfo" step,
    /// since on mobile the session already lives in this process).
    static func validateCurrentSession() async -> Bool {
        guard let baseURL = await ServerConfig.shared.baseURL,
              let token = await SessionStore.shared.session?.token else {
            return false
        }
        do {
            try await LozaAPIClient.shared.fetchMe(baseURL: baseURL, token: token)
            return true
        } catch {
            return false
        }
    }

    /// POST /auth/refresh — silently renews the token at launch, mirrors
    /// auth.rs::refresh_session_silently.
    static func refreshSilently() async {
        guard let baseURL = await ServerConfig.shared.baseURL,
              let session = await SessionStore.shared.session else {
            return
        }
        do {
            let resp = try await LozaAPIClient.shared.refresh(baseURL: baseURL, token: session.token)
            await SessionStore.shared.save(AuthState(
                token: resp.token,
                username: resp.username,
                displayName: resp.displayName,
                role: resp.role,
                expiresAt: TimeInterval(resp.expiresAt)
            ))
        } catch {
            // Server unreachable or token truly invalid — leave the local
            // session as-is on network errors (matches Rust's behavior of
            // giving up quietly and trying again next launch); a hard
            // rejection is surfaced the next time get_current_user-style
            // validation runs.
        }
    }

    static func checkServerHealth(baseURL: URL) async -> Bool {
        await LozaAPIClient.shared.healthCheck(baseURL: baseURL)
    }
}
