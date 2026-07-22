//
//  KeychainStore.swift
//  Loza
//
//  Minimal Keychain wrapper used to persist the session (JWT + user info)
//  and the server URL on-device. Replaces the UserDefaults-backed storage
//  from the original mocked SessionStore — same shape, safer storage.
//  No third-party dependency: just the Security framework's C API,
//  wrapped in a small Codable-friendly interface.
//

import Foundation
import Security

enum KeychainStore {
    private static let service = "com.loza.app"

    /// Saves `value` under `key`, replacing any existing item.
    @discardableResult
    static func set(_ value: Data, for key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)

        var attributes = query
        attributes[kSecValueData as String] = value
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let status = SecItemAdd(attributes as CFDictionary, nil)
        return status == errSecSuccess
    }

    static func get(_ key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    @discardableResult
    static func delete(_ key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    // ─── Codable convenience ────────────────────────────────────────────────

    static func setCodable<T: Encodable>(_ value: T, for key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        set(data, for: key)
    }

    static func getCodable<T: Decodable>(_ type: T.Type, for key: String) -> T? {
        guard let data = get(key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    // ─── String convenience (server URL) ───────────────────────────────────

    static func setString(_ value: String, for key: String) {
        set(Data(value.utf8), for: key)
    }

    static func getString(_ key: String) -> String? {
        guard let data = get(key) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
