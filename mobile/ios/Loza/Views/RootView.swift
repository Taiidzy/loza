//
//  RootView.swift
//  Loza
//
//  Vivid TabView with gradient profile card, alive settings, glass tab bar.
//

import SwiftUI

struct RootView: View {
    @StateObject private var serverConfig = ServerConfig.shared
    @StateObject private var session = SessionStore.shared

    var body: some View {
        Group {
            if serverConfig.baseURL == nil {
                ServerSetupView(onSuccess: {})
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
    @StateObject private var calendarStore = CalendarEventsStore()
    @State private var selection: Tab = .dashboard
    @State private var showLogoutConfirm = false

    private enum Tab: Hashable {
        case dashboard, calendar, loza, settings
    }

    var body: some View {
        TabView(selection: $selection) {
            Tab_(value: .dashboard, label: "Обзор", systemImage: "square.grid.2x2") {
                DashboardView()
            }
            Tab_(value: .calendar, label: "Календарь", systemImage: "calendar") {
                CalendarView()
            }
            Tab_(value: .loza, label: "Loza", systemImage: "leaf") {
                LozaView()
            }
            Tab_(value: .settings, label: "Настройки", systemImage: "gearshape") {
                SettingsView(showLogoutConfirm: $showLogoutConfirm)
            }
        }
        .tint(LozaColor.accentPink)
        .preferredColorScheme(.dark)
        .environmentObject(calendarStore)
        .confirmationDialog("Выйти из аккаунта?", isPresented: $showLogoutConfirm, titleVisibility: .visible) {
            Button("Выйти", role: .destructive) { Task { await logout() } }
            Button("Отмена", role: .cancel) {}
        }
        .task {
            StatusSocket.shared.start()
        }
    }

    private func logout() async {
        if let token = session.session?.token {
            await AuthService.logout(token: token)
        }
        StatusSocket.shared.stop()
        session.clear()
    }

    @ViewBuilder
    private func Tab_<Content: View>(value: Tab, label: String, systemImage: String, @ViewBuilder content: () -> Content) -> some View {
        content()
            .tabItem { Label(label, systemImage: systemImage) }
            .tag(value)
    }
}

// MARK: - Settings

struct SettingsView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var serverConfig: ServerConfig
    @Binding var showLogoutConfirm: Bool
    @State private var showServerChange = false

    var body: some View {
        NavigationStack {
            ZStack {
                LozaBackgroundView()

                List {
                    Section {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle()
                                    .fill(LozaColor.accentGradient)
                                    .frame(width: 44, height: 44)
                                Image(systemName: "person.fill")
                                    .font(.system(size: 18))
                                    .foregroundStyle(.white)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(session.session?.displayName ?? "Пользователь")
                                    .font(LozaType.title)
                                    .foregroundStyle(.white.opacity(0.88))
                                Text(session.session?.role ?? "")
                                    .font(LozaType.caption)
                                    .foregroundStyle(.white.opacity(0.42))
                            }
                        }
                        .listRowBackground(lozaListRowBackground())
                    }

                    Section {
                        HStack {
                            Image(systemName: "link")
                                .foregroundStyle(.white.opacity(0.28))
                            Text("Сервер")
                                .foregroundStyle(.white.opacity(0.55))
                            Spacer()
                            Text(serverConfig.baseURL?.host ?? "—")
                                .foregroundStyle(.secondary)
                        }
                        .listRowBackground(lozaListRowBackground())
                    } header: {
                        Text("Подключение")
                    }

                    Section {
                        Button(role: .destructive) {
                            showLogoutConfirm = true
                        } label: {
                            Label("Выйти", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                        .listRowBackground(lozaListRowBackground())
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Настройки")
        }
    }

    private func lozaListRowBackground() -> some View {
        if #available(iOS 26.0, *) {
            return AnyView(Color.clear)
        } else {
            return AnyView(Color.white.opacity(0.04))
        }
    }
}

#Preview {
    RootView()
}
