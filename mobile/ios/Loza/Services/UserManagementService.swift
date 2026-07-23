import Foundation

enum UserManagementService {
    private static func credentials() async throws -> (URL, String) {
        guard let baseURL = await ServerConfig.shared.baseURL else { throw AuthError.noServerConfigured }
        guard let token = await SessionStore.shared.session?.token else { throw AuthError.invalidCredentials }
        return (baseURL, token)
    }

    static func list() async throws -> [ManagedUserDTO] {
        let (url, token) = try await credentials()
        return try await LozaAPIClient.shared.listUsers(baseURL: url, token: token)
    }
    static func create(_ body: CreateUserBody) async throws -> ManagedUserDTO {
        let (url, token) = try await credentials()
        return try await LozaAPIClient.shared.createUser(baseURL: url, token: token, body: body)
    }
    static func updateQuota(username: String, quotaBytes: UInt64?) async throws -> ManagedUserDTO {
        let (url, token) = try await credentials()
        return try await LozaAPIClient.shared.updateQuota(baseURL: url, token: token, username: username, quotaBytes: quotaBytes)
    }
    static func delete(username: String) async throws {
        let (url, token) = try await credentials()
        try await LozaAPIClient.shared.deleteUser(baseURL: url, token: token, username: username)
    }
    static func changePassword(username: String, current: String?, new: String) async throws {
        let (url, token) = try await credentials()
        try await LozaAPIClient.shared.changePassword(baseURL: url, token: token, username: username, body: ChangePasswordBody(currentPassword: current, newPassword: new))
    }
}
