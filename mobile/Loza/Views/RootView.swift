//
//  RootView.swift
//  Loza
//
//  Replaces App.tsx + ProtectedRoute.tsx's mobile branch. Auth-gating
//  works the same way (no session -> AuthView), but instead of a
//  <BrowserRouter> + hand-rolled bottom <nav>, we use a native
//  TabView. On iOS 26 TabView renders its bar with the system's
//  Liquid Glass material automatically — this is the "swap the navbar
//  for a native glass navbar" part of the ask. The five tabs mirror
//  TabItem's five entries from MainPage.tsx (Обзор / Активность /
//  Loza / Настройки / Выйти), with Выйти wired to sign out instead of
//  being a real destination.
//

import SwiftUI

struct RootView: View {
    @StateObject private var session = SessionStore.shared

    var body: some View {
        Group {
            if session.session != nil {
                MainTabView()
            } else {
                AuthView(onSuccess: {})
            }
        }
        .environmentObject(session)
        .onAppear { session.refreshValidity() }
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
            Tab_(value: .activity, label: "Активность", systemImage: "waveform.path.ecg") {
                ActivityPlaceholderView()
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

// ─── Lightweight placeholders for tabs that don't have a dedicated
//     screen in the source app yet (Активность / Loza were nav items
//     only). Keep them minimal and consistent with the visual style.

struct ActivityPlaceholderView: View {
    var body: some View {
        NavigationStack {
            ZStack {
                LozaColor.bgMobile.ignoresSafeArea()
                ContentUnavailableView(
                    "Активность",
                    systemImage: "waveform.path.ecg",
                    description: Text("Здесь появится подробная лента событий.")
                )
                .foregroundStyle(.white.opacity(0.5))
            }
            .navigationTitle("Активность")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

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
    @Binding var showLogoutConfirm: Bool

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
        }
    }
}

#Preview {
    RootView()
}
