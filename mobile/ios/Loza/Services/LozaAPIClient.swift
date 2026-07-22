//
//  LozaAPIClient.swift
//  Loza
//
//  Thin HTTP layer talking directly to the Loza backend (backend/src/main.rs),
//  the same server the Tauri desktop app proxies through Rust. On desktop,
//  React never touches the network directly — Rust does it and keeps the
//  token. On mobile there is no separate native process to hide the token
//  behind, so this layer plays that role instead: it's the only place that
//  reads the token (from KeychainStore, via SessionStore) and attaches it
//  as `x-session-token`, mirroring auth.rs/calendar.rs's `require_username`.
//
//  Routes mirrored 1:1 from backend/src/main.rs:
//    POST /auth/login        (body: LoginRequest, no auth header)
//    GET  /auth/me           (header: x-session-token)
//    POST /auth/logout       (header: x-session-token)
//    POST /auth/refresh      (header: x-session-token)
//    GET  /health            (no auth)
//    GET  /status            (no auth — server-wide, not per-user)
//    GET  /calendar/events               (header: x-session-token)
//    POST /calendar/events               (header: x-session-token, body: CalendarEventDraft)
//    PUT  /calendar/events/:id           (header: x-session-token, body: CalendarEvent)
//    DELETE /calendar/events/:id         (header: x-session-token)
//

import Foundation

enum APIError: LocalizedError {
    case noServerConfigured
    case invalidResponse
    case server(code: String, message: String)
    case http(status: Int)
    case transport(Error)

    var errorDescription: String? {
        switch self {
        case .noServerConfigured:
            return "Сервер не настроен"
        case .invalidResponse:
            return "Некорректный ответ сервера"
        case .server(let code, let message):
            switch code {
            case "INVALID_CREDENTIALS": return "Неверный логин или пароль"
            case "EMPTY_FIELDS": return "Заполните все поля"
            case "NO_TOKEN", "INVALID_TOKEN": return "Сессия истекла, войдите снова"
            default: return message
            }
        case .http(let status):
            return "Сервер вернул ошибку (\(status))"
        case .transport:
            return "Сервер недоступен"
        }
    }

    var code: String? {
        if case .server(let code, _) = self { return code }
        return nil
    }
}

private struct ServerErrorBody: Decodable {
    let error: String
    let code: String
}

/// Human-readable client description, mirrored from auth.rs's `device_label()`
/// (there: `"{os} · Loza Desktop"`).
func deviceLabel() -> String {
    "\(UIDeviceModelName()) · Loza Mobile"
}

private func UIDeviceModelName() -> String {
    #if canImport(UIKit)
    return "iOS"
    #else
    return "Unknown"
    #endif
}

actor LozaAPIClient {
    static let shared = LozaAPIClient()

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 12
        config.timeoutIntervalForResource = 20
        return URLSession(configuration: config)
    }()

    private let decoder: JSONDecoder = JSONDecoder()
    private let encoder: JSONEncoder = JSONEncoder()

    // ─── Low-level request helper ──────────────────────────────────────────

    private func request(
        path: String,
        method: String,
        baseURL: URL,
        token: String? = nil,
        body: Data? = nil
    ) async throws -> Data {
        var url = baseURL
        url.append(path: path)

        var req = URLRequest(url: url)
        req.httpMethod = method
        if let token {
            req.setValue(token, forHTTPHeaderField: "x-session-token")
        }
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.transport(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard (200..<300).contains(http.statusCode) else {
            if let err = try? decoder.decode(ServerErrorBody.self, from: data) {
                throw APIError.server(code: err.code, message: err.error)
            }
            throw APIError.http(status: http.statusCode)
        }

        return data
    }

    // ─── Health ─────────────────────────────────────────────────────────────

    func healthCheck(baseURL: URL) async -> Bool {
        guard let data = try? await request(path: "/health", method: "GET", baseURL: baseURL) else {
            return false
        }
        return (try? decoder.decode(HealthResponse.self, from: data)) != nil
    }

    // ─── Auth ───────────────────────────────────────────────────────────────

    func login(baseURL: URL, username: String, password: String) async throws -> ServerLoginResponse {
        let body = try encoder.encode(LoginRequestBody(username: username, password: password, device: deviceLabel()))
        let data = try await request(path: "/auth/login", method: "POST", baseURL: baseURL, body: body)
        guard let decoded = try? decoder.decode(ServerLoginResponse.self, from: data) else {
            throw APIError.invalidResponse
        }
        return decoded
    }

    /// GET /auth/me — validates the token is still accepted server-side.
    func fetchMe(baseURL: URL, token: String) async throws {
        _ = try await request(path: "/auth/me", method: "GET", baseURL: baseURL, token: token)
    }

    func logout(baseURL: URL, token: String) async {
        _ = try? await request(path: "/auth/logout", method: "POST", baseURL: baseURL, token: token)
    }

    /// POST /auth/refresh — silently renews the token, mirrors
    /// auth.rs::refresh_session_silently, called once at launch.
    func refresh(baseURL: URL, token: String) async throws -> ServerLoginResponse {
        let data = try await request(path: "/auth/refresh", method: "POST", baseURL: baseURL, token: token)
        guard let decoded = try? decoder.decode(ServerLoginResponse.self, from: data) else {
            throw APIError.invalidResponse
        }
        return decoded
    }

    // ─── Status ─────────────────────────────────────────────────────────────

    /// GET /status — matches models/status.rs's ServerStatus shape exactly
    /// (clients/storage/load/activity/updatedAt — no "services" field).
    func fetchStatus(baseURL: URL, token: String) async throws -> ServerStatusDTO {
        let data = try await request(path: "/status", method: "GET", baseURL: baseURL, token: token)
        guard let decoded = try? decoder.decode(ServerStatusDTO.self, from: data) else {
            throw APIError.invalidResponse
        }
        return decoded
    }

    // ─── Calendar ───────────────────────────────────────────────────────────

    func getCalendarEvents(baseURL: URL, token: String) async throws -> [CalendarEventDTO] {
        let data = try await request(path: "/calendar/events", method: "GET", baseURL: baseURL, token: token)
        guard let decoded = try? decoder.decode([CalendarEventDTO].self, from: data) else {
            throw APIError.invalidResponse
        }
        return decoded
    }

    func createCalendarEvent(baseURL: URL, token: String, draft: CalendarEventDraftDTO) async throws -> CalendarEventDTO {
        let body = try encoder.encode(draft)
        let data = try await request(path: "/calendar/events", method: "POST", baseURL: baseURL, token: token, body: body)
        guard let decoded = try? decoder.decode(CalendarEventDTO.self, from: data) else {
            throw APIError.invalidResponse
        }
        return decoded
    }

    func updateCalendarEvent(baseURL: URL, token: String, event: CalendarEventDTO) async throws -> CalendarEventDTO {
        let body = try encoder.encode(event)
        let data = try await request(path: "/calendar/events/\(event.id)", method: "PUT", baseURL: baseURL, token: token, body: body)
        guard let decoded = try? decoder.decode(CalendarEventDTO.self, from: data) else {
            throw APIError.invalidResponse
        }
        return decoded
    }

    func deleteCalendarEvent(baseURL: URL, token: String, id: String) async throws {
        _ = try await request(path: "/calendar/events/\(id)", method: "DELETE", baseURL: baseURL, token: token)
    }
}

// ─── Wire types (mirror backend/src/handlers + backend/src/models) ─────────

private struct HealthResponse: Decodable {
    let status: String
}

private struct LoginRequestBody: Encodable {
    let username: String
    let password: String
    let device: String
}

/// Mirrors backend/src/handlers/auth.rs::LoginResponse.
struct ServerLoginResponse: Decodable {
    let token: String
    let username: String
    let displayName: String
    let role: String
    let expiresAt: UInt64

    enum CodingKeys: String, CodingKey {
        case token, username, role
        case displayName = "display_name"
        case expiresAt = "expires_at"
    }
}
