//
//  DashboardView.swift
//  Loza
//
//  Port of DashboardTab.tsx (mobile layout): status error banner, stat
//  cards row, activity panel, and the greeting banner. Navigation chrome
//  (header + tab bar) lives in RootView / MainTabView using native Liquid
//  Glass instead of the hand-built header + bottom nav — this view only
//  owns the content.
//
//  Note: there is no "service status" card here, matching the real
//  backend (backend/src/models/status.rs) — ServerStatus only carries
//  clients/storage/load/activity, there's no separate services list.
//  An earlier mocked version of this screen had invented one; dropped
//  when wiring up real networking to stay faithful to the server.
//
//  Live updates now come from StatusSocket over the unified /ws/app WebSocket
//  (same source and cadence as the desktop app's status::spawn_status_listener,
//  now multiplexed onto /ws/app alongside calendar requests). One GET /status
//  for the first paint (matches Tauri's get_server_status command, used before
//  the WS stream has connected), then the socket takes over.
//

import SwiftUI
import Combine

struct DashboardView: View {
    @EnvironmentObject private var session: SessionStore
    @ObservedObject private var socket = StatusSocket.shared

    @State private var initialStatus: ServerStatus?
    @State private var statusLoading = true
    @State private var now = Date()

    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    /// Prefers the live WS status once connected; falls back to the
    /// one-shot GET /status snapshot until the socket delivers its first
    /// tick (mirrors Tauri's get_server_status-then-WS handoff).
    private var status: ServerStatus? { socket.status ?? initialStatus }
    private var statusError: String? { socket.status == nil ? socket.connectionError : nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let statusError {
                        errorBanner(statusError)
                    }

                    statsRow

                    activityCard

                    greetingBanner
                }
                .padding(16)
            }
            .lozaBackground()
            .navigationTitle("Обзор системы")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text("Обзор системы")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.white.opacity(0.82))
                        Text(dateStr)
                            .font(.system(size: 11))
                            .foregroundStyle(.white.opacity(0.24))
                            .textCase(.lowercase)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Text(timeStr)
                        .font(.system(size: 13, weight: .light))
                        .monospacedDigit()
                        .foregroundStyle(.white.opacity(0.4))
                        .tracking(0.6)
                }
            }
        }
        .task {
            await loadInitialStatus()
        }
        .onReceive(timer) { now = $0 }
    }

    // ─── Pieces ─────────────────────────────────────────────────────────────

    private func errorBanner(_ message: String) -> some View {
        HStack {
            Text("Не удалось обновить состояние сервера: \(message)")
                .font(.system(size: 12))
                .foregroundStyle(Color(hex: 0xFF8C8C, alpha: 0.9))
            Spacer()
            Button("Повторить") { retry() }
                .font(.system(size: 11))
                .foregroundStyle(Color(hex: 0xFF8C8C, alpha: 0.9))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color(hex: 0xFF8C8C, alpha: 0.3), lineWidth: 1)
                )
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color(hex: 0xFF6464, alpha: 0.08))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color(hex: 0xFF6464, alpha: 0.2), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private var statsRow: some View {
        VStack(spacing: 12) {
            if statusLoading && status == nil {
                CardSkeleton(delay: 0.18)
                CardSkeleton(delay: 0.22)
                CardSkeleton(delay: 0.26)
            } else if let status {
                ClientsCard(clients: status.clients, delay: 0.18)
                StorageCard(storage: status.storage, delay: 0.22)
                LoadCard(load: status.load, delay: 0.26)
            }
        }
    }

    private var activityCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            CardLabel(text: "Последние события")
                .padding(.bottom, 14)

            if statusLoading && status == nil {
                Text("Загрузка…")
                    .font(.system(size: 11))
                    .foregroundStyle(LozaColor.textFaint)
            } else if (status?.activity ?? []).isEmpty {
                Text("Пока нет событий")
                    .font(.system(size: 11))
                    .foregroundStyle(LozaColor.textFaint)
            } else {
                VStack(spacing: 0) {
                    ForEach(status?.activity ?? []) { a in
                        HStack(spacing: 10) {
                            Circle()
                                .fill(a.type.color)
                                .frame(width: 5, height: 5)
                            Text(a.msg)
                                .font(.system(size: 11))
                                .foregroundStyle(.white.opacity(0.5))
                            Spacer()
                            Text(a.time)
                                .font(.system(size: 10))
                                .foregroundStyle(.white.opacity(0.18))
                                .monospacedDigit()
                        }
                        .padding(.vertical, 7)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(Color.white.opacity(0.04)).frame(height: 1)
                        }
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lozaCard()
    }

    private var greetingBanner: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 10)
                .fill(LinearGradient(colors: [LozaColor.accentPink.opacity(0.3), LozaColor.accentPurple.opacity(0.3)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 36, height: 36)
                .overlay(Image(systemName: "leaf").foregroundStyle(LozaColor.accentPink.opacity(0.8)))

            VStack(alignment: .leading, spacing: 3) {
                Text("Привет, \(session.session?.displayName ?? session.session?.username ?? "") 👋")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.75))
                    .lineLimit(1)
                Text(greetingSubtitle)
                    .font(.system(size: 11))
                    .foregroundStyle(LozaColor.textFaint)
            }
            Spacer()
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
        .background(
            LinearGradient(colors: [LozaColor.accentPink.opacity(0.07), LozaColor.accentPurple.opacity(0.05)], startPoint: .topLeading, endPoint: .bottomTrailing)
        )
        .overlay(
            RoundedRectangle(cornerRadius: LozaMetrics.cardRadius)
                .stroke(LozaColor.accentPink.opacity(0.12), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: LozaMetrics.cardRadius))
    }

    private var greetingSubtitle: String {
        if statusError != nil {
            return "Добро пожаловать в Loza. Не удалось связаться с сервером."
        }
        return "Добро пожаловать в Loza. Всё работает штатно."
    }

    // ─── Data ───────────────────────────────────────────────────────────────

    private func loadInitialStatus() async {
        do {
            initialStatus = try await ServerStatusService.fetch()
        } catch {
            // Swallow — the WS connection (started right after this) will
            // surface its own connectionError if the server is truly
            // unreachable; no need to show two competing error banners
            // for what's ultimately the same failure.
        }
        statusLoading = false
    }

    private func retry() {
        Task { await loadInitialStatus() }
        socket.stop()
        socket.start()
    }

    private var timeStr: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ru_RU")
        f.dateFormat = "HH:mm:ss"
        return f.string(from: now)
    }

    private var dateStr: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ru_RU")
        f.dateFormat = "EEEE, d MMMM"
        return f.string(from: now)
    }
}
