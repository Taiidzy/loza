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
        if let stored = KeychainStore.getString(key), let url = Self.normalize(stored) {
            baseURL = url
        }
    }

    /// Normalizes user input into a valid base URL:
    ///  - trims whitespace
    ///  - defaults to "http://" if no scheme was given; this is accepted only
    ///    for loopback/LAN hosts. Public servers must explicitly use HTTPS.
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

        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              let host = url.host,
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil,
              url.path.isEmpty || url.path == "/"
        else { return nil }
        guard scheme == "https" || isLocalNetworkHost(host) else { return nil }
        return url
    }

    private static func isLocalNetworkHost(_ host: String) -> Bool {
        let normalized = host.lowercased()
        if normalized == "localhost" || normalized.hasSuffix(".local") {
            return true
        }
        if normalized == "::1" || normalized.hasPrefix("fe80:")
            || normalized.hasPrefix("fc") || normalized.hasPrefix("fd") {
            return true
        }

        let octets = normalized.split(separator: ".").compactMap { UInt8($0) }
        guard octets.count == 4 else { return false }
        return octets[0] == 10
            || (octets[0] == 172 && (16...31).contains(octets[1]))
            || (octets[0] == 192 && octets[1] == 168)
            || (octets[0] == 169 && octets[1] == 254)
            || octets[0] == 127
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
