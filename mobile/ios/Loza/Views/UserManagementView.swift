import SwiftUI

struct UserManagementView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var users: [ManagedUserDTO] = []
    @State private var errorMessage: String?
    @State private var selectedUsername = ""
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var newUsername = ""
    @State private var newDisplayName = ""
    @State private var newUserPassword = ""
    @State private var newRole = "user"
    @State private var newQuota = "10737418240"
    @State private var deleteTarget: ManagedUserDTO?
    @State private var isWorking = false

    private let quotas: [(String, UInt64?)] = [("10 GB", 10 * 1024 * 1024 * 1024), ("50 GB", 50 * 1024 * 1024 * 1024), ("100 GB", 100 * 1024 * 1024 * 1024), ("Unlimited", nil)]

    var body: some View {
        List {
            if let errorMessage { Text(errorMessage).foregroundStyle(LozaColor.accentRed) }
            Section("Пользователи") {
                ForEach(users) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.displayName.isEmpty ? item.username : item.displayName).foregroundStyle(LozaColor.textPrimary)
                                Text("\(item.username) · \(item.role) · \(quotaLabel(item.quotaBytes))").font(.caption).foregroundStyle(LozaColor.textSecondary)
                            }
                            Spacer()
                            if item.username != session.session?.username {
                                Button(role: .destructive) { deleteTarget = item } label: { Image(systemName: "trash") }
                            }
                        }
                        Picker("Квота", selection: Binding(get: { item.quotaBytes.map(String.init) ?? "unlimited" }, set: { value in Task { await updateQuota(item.username, value) } })) {
                            ForEach(quotas, id: \.0) { label, value in Text(label).tag(value.map(String.init) ?? "unlimited") }
                        }
                        .disabled(isWorking)
                    }
                    .padding(.vertical, 4)
                }
            }

            Section("Создать пользователя") {
                TextField("Логин", text: $newUsername).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Отображаемое имя", text: $newDisplayName)
                SecureField("Пароль", text: $newUserPassword)
                Picker("Роль", selection: $newRole) { Text("User").tag("user"); Text("Admin").tag("admin") }
                Picker("Квота", selection: $newQuota) { ForEach(quotas, id: \.0) { label, value in Text(label).tag(value.map(String.init) ?? "unlimited") } }
                Button("Создать") { Task { await createUser() } }.disabled(isWorking || newUsername.isEmpty || newUserPassword.isEmpty)
            }

            Section("Смена пароля") {
                Picker("Пользователь", selection: $selectedUsername) { ForEach(users) { Text($0.username).tag($0.username) } }
                if selectedUsername == session.session?.username { SecureField("Текущий пароль", text: $currentPassword) }
                SecureField("Новый пароль", text: $newPassword)
                Button("Сменить пароль") { Task { await changePassword() } }
                    .disabled(isWorking || selectedUsername.isEmpty || newPassword.isEmpty || (selectedUsername == session.session?.username && currentPassword.isEmpty))
            }

            Section("База данных") {
                HStack { Label("Источник данных", systemImage: "cylinder"); Spacer(); Text("В разработке").foregroundStyle(LozaColor.textSecondary) }
                    .disabled(true)
            }
        }
        .scrollContentBackground(.hidden)
        .background { LozaBackgroundView() }
        .navigationTitle("Пользователи")
        .task { await load() }
        .confirmationDialog("Удалить пользователя?", isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }), titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { if let target = deleteTarget { Task { await delete(target) } } }
        }
    }

    private func quotaLabel(_ bytes: UInt64?) -> String { bytes.map { "\($0 / 1024 / 1024 / 1024) GB" } ?? "Unlimited" }
    private func quotaValue(_ value: String) -> UInt64? { value == "unlimited" ? nil : UInt64(value) }
    private func load() async { do { users = try await UserManagementService.list(); if selectedUsername.isEmpty { selectedUsername = users.first?.username ?? "" } } catch { errorMessage = error.localizedDescription } }
    private func updateQuota(_ username: String, _ value: String) async { isWorking = true; defer { isWorking = false }; do { _ = try await UserManagementService.updateQuota(username: username, quotaBytes: quotaValue(value)); await load() } catch { errorMessage = error.localizedDescription } }
    private func createUser() async { isWorking = true; defer { isWorking = false }; do { _ = try await UserManagementService.create(CreateUserBody(username: newUsername, password: newUserPassword, displayName: newDisplayName.isEmpty ? nil : newDisplayName, role: newRole, quotaBytes: quotaValue(newQuota))); newUsername = ""; newDisplayName = ""; newUserPassword = ""; await load() } catch { errorMessage = error.localizedDescription } }
    private func changePassword() async { isWorking = true; defer { isWorking = false }; do { try await UserManagementService.changePassword(username: selectedUsername, current: selectedUsername == session.session?.username ? currentPassword : nil, new: newPassword); currentPassword = ""; newPassword = "" } catch { errorMessage = error.localizedDescription } }
    private func delete(_ target: ManagedUserDTO) async { isWorking = true; defer { isWorking = false; deleteTarget = nil }; do { try await UserManagementService.delete(username: target.username); await load() } catch { errorMessage = error.localizedDescription } }
}
