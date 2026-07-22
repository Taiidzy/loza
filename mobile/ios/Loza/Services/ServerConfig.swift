//
//  ServerConfig.swift
//  Loza
//
//  Native equivalent of the hardcoded `SERVER_URL` constant in
//  app/src-tauri/src/auth.rs. On desktop the server address is baked into
//  the Rust binary (http://localhost:4242) because desktop always talks to
//  a server on the same machine/network the app was built for. On mobile
//  the phone could be pointed at any Loza server, so the address is
//  user-entered once (first screen of the auth flow) and persisted here,
//  in the Keychain alongside the session token.
//
//  Editable later from Settings, same as any other stored credential.
//

import Foundation
import Combine

@MainActor
final class ServerConfig: ObservableObject {
    static let shared = ServerConfig()

    @Published private(set) var baseURL: URL?

    private let key = "loza_server_url"

    private init() {
        if let stored = KeychainStore.getString(key), let url = URL(string: stored) {
            baseURL = url
        }
    }

    /// Normalizes user input into a valid base URL:
    ///  - trims whitespace
    ///  - defaults to "http://" if no scheme was given (LAN servers are
    ///    typically plain HTTP, matching the desktop default of
    ///    http://localhost:4242)
    ///  - strips any trailing slash so `"\(baseURL)/auth/login"` composes cleanly
    static func normalize(_ input: String) -> URL? {
        var trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if !trimmed.contains("://") {
            trimmed = "http://" + trimmed
        }
        while trimmed.hasSuffix("/") {
            trimmed.removeLast()
        }

        guard let url = URL(string: trimmed), url.host != nil else { return nil }
        return url
    }

    /// Derives the WebSocket URL for a given HTTP(S) endpoint path, mapping
    /// scheme http -> ws and https -> wss (mirrors the scheme pairing every
    /// browser/URLSession enforces: a wss:// socket can't be opened from a
    /// plain http:// origin, and there's no reason to run ws:// over an
    /// https-fronted server). Falls back to "ws" for any other/missing
    /// scheme rather than crashing on a malformed stored URL.
    static func webSocketURL(base: URL, path: String) -> URL? {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        switch base.scheme?.lowercased() {
        case "https":
            components?.scheme = "wss"
        default:
            components?.scheme = "ws"
        }
        components?.path = path
        return components?.url
    }

    func save(_ url: URL) {
        KeychainStore.setString(url.absoluteString, for: key)
        baseURL = url
    }

    func clear() {
        KeychainStore.delete(key)
        baseURL = nil
    }
}
