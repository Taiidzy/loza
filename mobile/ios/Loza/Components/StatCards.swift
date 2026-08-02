//
//  StatCards.swift
//  Loza
//
//  Ports of ClientsCard / StorageCard / LoadCard from MainPage.tsx.
//

import SwiftUI

struct ClientsCard: View {
    let clients: [ClientInfo]
    var delay: Double = 0

    private var activeCount: Int { clients.filter(\.active).count }

    var body: some View {
        DashboardCard(delay: delay) {
            VStack(alignment: .leading, spacing: 0) {
                CardLabel(text: "Клиенты")
                    .padding(.bottom, 12)

                HStack(alignment: .lastTextBaseline, spacing: 8) {
                    Text("\(activeCount)")
                        .font(.system(size: 28, weight: .light))
                        .foregroundStyle(.white)
                    Text("активно из \(clients.count)")
                        .font(.system(size: 11))
                        .foregroundStyle(LozaColor.textTertiary)
                }
                .padding(.bottom, 14)

                if clients.isEmpty {
                    Text("Нет подключённых устройств")
                        .font(.system(size: 11))
                        .foregroundStyle(LozaColor.textFaint)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(clients) { c in
                            HStack(spacing: 8) {
                                Circle()
                                    .fill(c.active ? LozaColor.accentGreen : Color.white.opacity(0.2))
                                    .frame(width: 6, height: 6)
                                    .shadow(color: c.active ? LozaColor.accentGreen.opacity(0.5) : .clear, radius: 4)

                                VStack(alignment: .leading, spacing: 1) {
                                    Text(c.name)
                                        .font(.system(size: 12))
                                        .foregroundStyle(.white.opacity(0.7))
                                        .lineLimit(1)
                                    Text(c.device)
                                        .font(.system(size: 10))
                                        .foregroundStyle(.white.opacity(0.28))
                                        .lineLimit(1)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

struct StorageCard: View {
    let storage: StorageInfo
    var delay: Double = 0
    @State private var detailsExpanded = false

    var body: some View {
        DashboardCard(delay: delay) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 18) {
                    StorageOrb(storage: storage, expanded: $detailsExpanded)

                    VStack(alignment: .leading, spacing: 4) {
                        CardLabel(text: "Хранилище")
                        Text("\(storage.usedPercent)%")
                            .font(.system(size: 22, weight: .light))
                            .foregroundStyle(.white)
                        Text("свободно \(ByteFormat.gbInt(storage.freeBytes)) ГБ")
                            .font(.system(size: 11))
                            .foregroundStyle(LozaColor.textTertiary)
                    }
                    Spacer(minLength: 0)
                }

                if detailsExpanded {
                    StorageBreakdownPanel(storage: storage)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
    }
}

private struct StorageBreakdownPanel: View {
    let storage: StorageInfo

    private var segments: [(category: StorageCategory, share: Double)] {
        let total = max(storage.categories.reduce(0) { $0 + $1.bytes }, 1)
        return storage.categories.map { ($0, Double($0.bytes) / Double(total)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(ByteFormat.gb(storage.usedBytes)) ГБ из \(ByteFormat.gb(storage.totalBytes)) ГБ")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.85))
                Spacer()
                Text("\(ByteFormat.gb(storage.freeBytes)) ГБ свободно")
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.35))
            }

            GeometryReader { geo in
                HStack(spacing: 1) {
                    ForEach(segments, id: \.category.id) { seg in
                        RoundedRectangle(cornerRadius: 0)
                            .fill(seg.category.color)
                            .frame(width: max(1, geo.size.width * seg.share))
                    }
                }
            }
            .frame(height: 7)
            .background(Color.white.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 4))

            VStack(spacing: 8) {
                ForEach(segments, id: \.category.id) { seg in
                    HStack(spacing: 8) {
                        Circle()
                            .fill(seg.category.color)
                            .frame(width: 7, height: 7)
                        Text(seg.category.label)
                            .font(.system(size: 11.5))
                            .foregroundStyle(.white.opacity(0.6))
                        Spacer()
                        Text("\(ByteFormat.gb(seg.category.bytes)) ГБ")
                            .font(.system(size: 11))
                            .foregroundStyle(.white.opacity(0.35))
                            .monospacedDigit()
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 14)
        .frame(maxWidth: .infinity)
        .lozaCard(radius: 14)
    }
}

struct LoadCard: View {
    let load: LoadInfo
    var delay: Double = 0

    var body: some View {
        DashboardCard(delay: delay) {
            VStack(alignment: .leading, spacing: 12) {
                CardLabel(text: "Нагрузка")

                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .lastTextBaseline, spacing: 6) {
                            Text("\(load.cpuPercent)%")
                                .font(.system(size: 24, weight: .light))
                                .foregroundStyle(.white)
                            Text("CPU")
                                .font(.system(size: 10))
                                .foregroundStyle(LozaColor.textTertiary)
                        }
                        Text("RAM \(load.memPercent)%")
                            .font(.system(size: 11))
                            .foregroundStyle(LozaColor.textTertiary)
                    }
                    Spacer()
                    Sparkline(values: load.history, color: LozaColor.accentPurple.opacity(0.8))
                }

                VStack(spacing: 6) {
                    LoadBar(label: "CPU", pct: load.cpuPercent, color: LozaColor.accentPurple.opacity(0.75))
                    LoadBar(label: "RAM", pct: load.memPercent, color: LozaColor.accentPink.opacity(0.75))
                }
            }
        }
    }
}

private struct LoadBar: View {
    let label: String
    let pct: Int
    let color: Color

    @State private var animatedPct: Double = 0

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 9))
                .foregroundStyle(.white.opacity(0.25))
                .frame(width: 26, alignment: .leading)

            GeometryReader { geo in
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color.white.opacity(0.06))
                    .overlay(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(color)
                            .frame(width: geo.size.width * (animatedPct / 100))
                    }
            }
            .frame(height: 4)
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.6)) { animatedPct = Double(pct) }
        }
        .onChange(of: pct) { _, newValue in
            withAnimation(.easeOut(duration: 0.6)) { animatedPct = Double(newValue) }
        }
    }
}
