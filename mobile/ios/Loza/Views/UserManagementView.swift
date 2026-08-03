//
//  UserManagementView.swift
//  Loza
//
//  Vivid user management with avatar circles, gradient buttons, glass card.
//

import SwiftUI

struct UserManagementView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var users: [ManagedUserDTO] = []
    @State private var isLoading = false
    @State private var showCreate = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                ForEach(users) { user in
                    userCard(user)
                }

                if users.isEmpty && !isLoading {
                    emptyState
                }

                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                }
            }
            .padding(.vertical, 12)
        }
        .navigationTitle("Пользователи")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showCreate = true
                } label: {
                    Image(systemName: "person.badge.plus")
                        .foregroundStyle(LozaColor.accentPink.opacity(0.85))
                }
            }
        }
        .sheet(isPresented: $showCreate) {
            NavigationStack {
                CreateUserView(onCreated: {
                    showCreate = false
                    Task { await fetchUsers() }
                })
                .background(LozaBackgroundView())
            }
        }
        .task { await fetchUsers() }
    }

    private func fetchUsers() async {
        isLoading = true
        do {
            users = try await UserManagementService.list()
        } catch {
            // silently handle
        }
        isLoading = false
    }

    private func userCard(_ user: ManagedUserDTO) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(LozaColor.accentGradient)
                    .frame(width: 40, height: 40)
                Text(String(user.displayName.prefix(1)).uppercased())
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.white)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(user.displayName)
                    .font(LozaType.subheadline)
                    .foregroundStyle(.white.opacity(0.88))
                Text(user.role)
                    .font(LozaType.caption)
                    .foregroundStyle(.white.opacity(0.42))
            }

            Spacer()

            if user.role != "admin" {
                Button {
                    Task {
                        try? await UserManagementService.delete(username: user.username)
                        await fetchUsers()
                    }
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 12))
                        .foregroundStyle(LozaColor.accentRed.opacity(0.65))
                }
            }
        }
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: LozaMetrics.cardRadius))
        .padding(.horizontal, 12)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "person.2.slash")
                .font(.system(size: 28))
                .foregroundStyle(.white.opacity(0.2))
            Text("Нет пользователей")
                .font(LozaType.subheadline)
                .foregroundStyle(.white.opacity(0.55))
        }
        .frame(maxWidth: .infinity, minHeight: 100)
    }
}

// MARK: - Create User

struct CreateUserView: View {
    @EnvironmentObject private var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    var onCreated: (() -> Void)?

    @State private var username = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var role = "user"

    var body: some View {
        Form {
            Section("Новый пользователь") {
                field("Логин", text: $username)
                field("Пароль", text: $password)
                field("Имя", text: $displayName)

                Picker("Роль", selection: $role) {
                    Text("user").tag("user")
                    Text("admin").tag("admin")
                }
            }

            Section {
                Button {
                    Task {
                        let body = CreateUserBody(
                            username: username.trimmingCharacters(in: .whitespaces),
                            password: password,
                            displayName: displayName.trimmingCharacters(in: .whitespaces),
                            role: role,
                            quotaBytes: nil
                        )
                        _ = try? await UserManagementService.create(body)
                        onCreated?()
                    }
                } label: {
                    Text("Создать")
                        .font(LozaType.buttonLabel)
                        .foregroundStyle(.white.opacity(0.88))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                }
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .background(LozaBackgroundView())
        .navigationTitle("Новый пользователь")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Отмена") { dismiss() }
                    .foregroundStyle(.white.opacity(0.55))
            }
        }
    }

    private func field(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(LozaType.fieldLabel)
                .tracking(1.2)
                .foregroundStyle(.white.opacity(0.16))
            TextField("", text: text)
                .font(LozaType.fieldInput)
                .foregroundStyle(.white.opacity(0.88))
        }
        .listRowBackground(Color.clear)
    }
}

#Preview {
    UserManagementView()
        .environmentObject(SessionStore.shared)
}
