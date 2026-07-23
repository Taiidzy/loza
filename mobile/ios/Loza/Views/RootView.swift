//
//  RootView.swift
//  Loza
//
//  Replaces App.tsx + ProtectedRoute.tsx's mobile branch. Auth-gating
//  now has two levels instead of one: no server configured -> ServerSetupView,
//  server configured but no session -> AuthView, both present -> MainTabView.
//  Desktop only ever needs the second gate (SERVER_URL is compiled in);
//  mobile needs the first because the phone can point at any Loza server.
//
//  Navigation chrome uses a native TabView instead of a hand-rolled bottom
//  <nav> — on iOS 26 it renders with the system's Liquid Glass material
//  automatically. The five tabs mirror TabItem's five entries from
//  MainPage.tsx (Обзор / Активность / Loza / Настройки / Выйти), with
//  Выйти wired to sign out instead of being a real destination. Активность
//  is now the real calendar module (CalendarView), not a placeholder.
//

import SwiftUI

struct RootView: View {
    @StateObject private var serverConfig = ServerConfig.shared
    @StateObject private var session = SessionStore.shared

    var body: some View {
        Group {
            if serverConfig.baseURL == nil {
                ServerSetupView(onConfigured: {})
            } else if session.session != nil {
                MainTabView()
            } else {
                AuthView(onSuccess: {})
            }
        }
        .environmentObject(serverConfig)
        .environmentObject(session)
        .task {
            session.refreshValidity()
            guard serverConfig.baseURL != nil, session.session != nil else { return }
            // Silently renew the token at launch (mirrors auth.rs::
            // refresh_session_silently), then confirm the server still
            // accepts it — if not, drop back to the login screen.
            await AuthService.refreshSilently()
            let stillValid = await AuthService.validateCurrentSession()
            if !stillValid {
                session.clear()
            }
        }
    }
}

struct MainTabView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var selection: Tab = .dashboard
    @State private var showLogoutConfirm = false

    private enum Tab: Hashable {
        case dashboard, activity, loza, settings
    }

    var body: some View {
        TabView(selection: $selection) {
            Tab_(value: .dashboard, label: "Обзор", systemImage: "square.grid.2x2") {
                DashboardView()
            }
            Tab_(value: .activity, label: "Активность", systemImage: "calendar") {
                CalendarView()
            }
            Tab_(value: .loza, label: "Loza", systemImage: "leaf") {
                LozaPlaceholderView()
            }
            Tab_(value: .settings, label: "Настройки", systemImage: "gearshape") {
                SettingsView(showLogoutConfirm: $showLogoutConfirm)
            }
        }
        .tint(LozaColor.accentPink)
        .preferredColorScheme(.dark)
        .confirmationDialog("Выйти из аккаунта?", isPresented: $showLogoutConfirm, titleVisibility: .visible) {
            Button("Выйти", role: .destructive) { Task { await logout() } }
            Button("Отмена", role: .cancel) {}
        }
    }

    private func logout() async {
        if let token = session.session?.token {
            await AuthService.logout(token: token)
        }
        session.clear()
    }

    /// Small helper so each tab reads as one line above, matching the
    /// five-item TabItem row from the TSX bottom bar.
    @ViewBuilder
    private func Tab_<Content: View>(value: Tab, label: String, systemImage: String, @ViewBuilder content: () -> Content) -> some View {
        content()
            .tabItem { Label(label, systemImage: systemImage) }
            .tag(value)
    }
}

// ─── Lightweight placeholder for the one tab that has no dedicated screen
//     in the source app (Loza is a nav item without a page yet). ──────────

struct LozaPlaceholderView: View {
    var body: some View {
        NavigationStack {
            ZStack {
                LozaColor.bgMobile.ignoresSafeArea()
                ContentUnavailableView(
                    "Loza",
                    systemImage: "leaf",
                    description: Text("Раздел в разработке.")
                )
                .foregroundStyle(.white.opacity(0.5))
            }
            .navigationTitle("Loza")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var serverConfig: ServerConfig
    @Binding var showLogoutConfirm: Bool
    @State private var showChangeServerConfirm = false

    var body: some View {
        NavigationStack {
            ZStack {
                LozaColor.bgMobile.ignoresSafeArea()

                List {
                    Section {
                        HStack(spacing: 12) {
                            Circle()
                                .fill(LozaColor.accentGradient)
                                .frame(width: 40, height: 40)
                                .overlay(
                                    Text(String((session.session?.displayName ?? session.session?.username ?? "U").prefix(1)).uppercased())
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(.white)
                                )
                            VStack(alignment: .leading, spacing: 2) {
                                Text(session.session?.displayName ?? session.session?.username ?? "")
                                    .font(.system(size: 14, weight: .medium))
                                Text((session.session?.role ?? "").uppercased())
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .listRowBackground(Color.white.opacity(0.04))
                    }

                    Section {
                        HStack {
                            Label("Сервер", systemImage: "server.rack")
                            Spacer()
                            Text(serverConfig.baseURL?.host ?? "—")
                                .foregroundStyle(.secondary)
                        }
                        .listRowBackground(Color.white.opacity(0.04))

                        Button {
                            showChangeServerConfirm = true
                        } label: {
                            Label("Сменить сервер", systemImage: "arrow.triangle.2.circlepath")
                        }
                        .listRowBackground(Color.white.opacity(0.04))
                    } header: {
                        Text("Подключение")
                    }

                    if session.session?.role == "admin" {
                        Section {
                            NavigationLink {
                                UserManagementView()
                            } label: {
                                Label("Управление пользователями", systemImage: "person.2")
                            }
                            .listRowBackground(Color.white.opacity(0.04))
                        } header: {
                            Text("Администрирование")
                        }
                    }

                    Section {
                        HStack {
                            Label("База данных", systemImage: "cylinder")
                            Spacer()
                            Text("В разработке")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .disabled(true)
                        .listRowBackground(Color.white.opacity(0.04))
                    }

                    Section {
                        Button(role: .destructive) {
                            showLogoutConfirm = true
                        } label: {
                            Label("Выйти", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                        .listRowBackground(Color.white.opacity(0.04))
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Настройки")
            .navigationBarTitleDisplayMode(.inline)
            .confirmationDialog(
                "Сменить сервер? Потребуется войти заново.",
                isPresented: $showChangeServerConfirm,
                titleVisibility: .visible
            ) {
                Button("Сменить сервер", role: .destructive) {
                    Task {
                        if let token = session.session?.token {
                            await AuthService.logout(token: token)
                        }
                        session.clear()
                        serverConfig.clear()
                    }
                }
                Button("Отмена", role: .cancel) {}
            }
        }
    }
}

#Preview {
    RootView()
}
