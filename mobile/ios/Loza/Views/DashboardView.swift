//
//  DashboardView.swift
//  Loza
//
//  Vivid dashboard with gradient cards, alive stat rows, animated sparklines.
//

import SwiftUI
import Combine

struct DashboardView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var calendarStore: CalendarEventsStore

    @State private var status: ServerStatus?
    @State private var isLoading = false
    @State private var serverError: String?
    @State private var lastUpdated: Date?
    @State private var currentTime = Date()

    @Environment(\.scenePhase) private var scenePhase

    private let timer = Timer.publish(every: 10, on: .main, in: .common).autoconnect()
    private let clockTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            LozaBackgroundView()

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let status {
                        statusOverviewCard(status)
                        systemInfoCard(status)
                        greetingCard
                        activityCard
                    } else if isLoading {
                        DashboardCardSkeleton()
                            .redacted(reason: .placeholder)
                            .padding(.horizontal, 12)
                    } else if let serverError {
                        errorBanner(serverError)
                            .padding(.horizontal, 12)
                    }
                }
                .padding(.vertical, 12)
            }
        }
        .navigationTitle("Обзор")
        .toolbar {
            if let status {
                ToolbarItem(placement: .topBarLeading) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color(hex: 0x3ECF6E))
                            .frame(width: 6, height: 6)
                        Text(status.updatedAt, style: .time)
                            .font(LozaType.caption)
                            .foregroundStyle(.white.opacity(0.4))
                    }
                }
            }
        }
        .onAppear {
            refresh()
            updateNow()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            refresh()
            updateNow()
        }
        .onReceive(timer) { _ in
            refresh()
        }
        .onReceive(clockTimer) { _ in
            currentTime = Date()
        }
    }

    private func updateNow() {
        currentTime = Date()
    }

    // MARK: - Status Overview

    private func statusOverviewCard(_ status: ServerStatus) -> some View {
        VStack(spacing: 8) {
            HStack {
                Circle()
                    .fill(LozaColor.accentGreen)
                    .frame(width: 6, height: 6)
                    .shadow(color: LozaColor.accentGreen.opacity(0.4), radius: 3)
                Text("Сервер онлайн")
                    .font(LozaType.subheadline)
                    .foregroundStyle(.white.opacity(0.88))
                Spacer()
                HStack(spacing: 4) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 9))
                        .foregroundStyle(LozaColor.accentGreen.opacity(0.6))
                    Text(status.updatedAt, style: .time)
                        .font(LozaType.fieldLabel)
                        .foregroundStyle(.white.opacity(0.4))
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
        .glassEffect(.regular, in: .rect(cornerRadius: LozaMetrics.cardRadius))
        .padding(.horizontal, 12)
    }

    // MARK: - System Info

    private func systemInfoCard(_ status: ServerStatus) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "server.rack")
                    .font(.system(size: 11))
                    .foregroundStyle(LozaColor.accentPurple.opacity(0.8))
                Text("Система")
                    .font(LozaType.subheadline)
                    .foregroundStyle(.white.opacity(0.88))
            }

            gridRow(icon: "cpu", label: "Процессор", value: "\(status.load.cpuPercent)%")
            gridRow(icon: "memorychip", label: "Память", value: "\(status.load.memPercent)%")
            gridRow(icon: "internaldrive", label: "Хранилище", value: "\(status.storage.usedPercent)%")
            gridRow(icon: "person.2", label: "Клиенты", value: "\(status.clients.count)")
        }
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: LozaMetrics.cardRadius))
        .padding(.horizontal, 12)
    }

    private func gridRow(icon: String, label: String, value: String) -> some View {
        HStack {
            Image(systemName: icon)
                .font(.system(size: 11))
                .foregroundStyle(.white.opacity(0.35))
                .frame(width: 20)
            Text(label)
                .font(LozaType.body)
                .foregroundStyle(.white.opacity(0.55))
            Spacer(minLength: 4)
            Text(value)
                .font(LozaType.subheadline)
                .foregroundStyle(.white.opacity(0.78))
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 3)
    }

    // MARK: - Greeting

    private var greetingCard: some View {
        let hour = Calendar.current.component(.hour, from: Date())
        let greeting: String
        if hour < 6 { greeting = "Доброй ночи" }
        else if hour < 12 { greeting = "Доброе утро" }
        else if hour < 17 { greeting = "Добрый день" }
        else { greeting = "Добрый вечер" }
        let name = session.session?.displayName ?? "Пользователь"
        return VStack(alignment: .leading, spacing: 2) {
            Text("\(greeting), \(name)")
                .font(LozaType.title)
                .foregroundStyle(.white.opacity(0.88))
            Text("Ваши системы в норме")
                .font(LozaType.caption)
                .foregroundStyle(.white.opacity(0.42))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: LozaMetrics.cardRadius))
        .padding(.horizontal, 12)
    }

    // MARK: - Activity

    private var activityCard: some View {
        let events = calendarStore.events.filter { ev in
            let eventDate = EventTime.start(date: ev.startDate, time: ev.startTime)
            return eventDate >= Calendar.current.startOfDay(for: currentTime) && eventDate <= Calendar.current.startOfDay(for: currentTime).addingTimeInterval(86400)
        }

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "calendar.badge.clock")
                    .font(.system(size: 11))
                    .foregroundStyle(LozaColor.accentPink.opacity(0.8))
                Text("Сегодня")
                    .font(LozaType.subheadline)
                    .foregroundStyle(.white.opacity(0.88))
                Spacer()
                if !events.isEmpty {
                    Text("\(events.count)")
                        .font(LozaType.fieldLabel)
                        .foregroundStyle(.white.opacity(0.88))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            Capsule().fill(LozaColor.accentPink.opacity(0.3))
                        )
                }
            }

            if events.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "sun.max")
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.28))
                    Text("Свободный день")
                        .font(LozaType.body)
                        .foregroundStyle(.white.opacity(0.42))
                }
                .frame(maxWidth: .infinity, minHeight: 52)
            } else {
                ForEach(events.prefix(5), id: \.id) { event in
                    HStack(spacing: 6) {
                        Rectangle()
                            .fill(event.color)
                            .frame(width: 3, height: 20)
                            .clipShape(Capsule())

                        VStack(alignment: .leading, spacing: 1) {
                            Text(event.title)
                                .font(LozaType.body)
                                .foregroundStyle(.white.opacity(0.88))
                                .lineLimit(1)

                            let start = EventTime.start(date: event.startDate, time: event.startTime)
                            let end = EventTime.end(date: event.endDate, time: event.endTime)
                            Text("\(start.timeString) — \(end.timeString)")
                                .font(LozaType.fieldLabel)
                                .foregroundStyle(.white.opacity(0.42))
                        }

                        Spacer(minLength: 4)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 9))
                            .foregroundStyle(.white.opacity(0.15))
                    }
                    .padding(8)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.white.opacity(0.04))
                    )
                }
            }
        }
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: LozaMetrics.cardRadius))
        .padding(.horizontal, 12)
    }

    // MARK: - Error

    private func errorBanner(_ message: String) -> some View {
        Button { refresh() } label: {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(LozaColor.accentYellow.opacity(0.8))
                Text(message)
                    .font(LozaType.subheadline)
                    .foregroundStyle(.white.opacity(0.88))
                    .lineLimit(2)
                Spacer()
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.4))
            }
            .padding(12)
            .glassEffect(.regular.tint(Color(hex: 0x505050, alpha: 0.3)), in: .rect(cornerRadius: LozaMetrics.cardRadius))
        }
    }

    private func refresh() {
        guard !isLoading else { return }
        isLoading = true
        serverError = nil

        Task {
            do {
                let s = try await ServerStatusService.fetch()
                status = s
                lastUpdated = Date()
                serverError = nil
            } catch {
                serverError = AuthError.from(error).errorDescription ?? "Не удалось загрузить данные"
            }
            isLoading = false
        }
    }
}

// MARK: - Helpers

extension Date {
    var timeString: String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: self)
    }
}


#Preview {
    DashboardView()
        .environmentObject(SessionStore.shared)
        .environmentObject(CalendarEventsStore())
}
