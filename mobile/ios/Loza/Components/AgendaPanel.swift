//
//  AgendaPanel.swift
//  Loza
//
//  Vivid upcoming events panel with gradient header and alive rows.
//

import SwiftUI

struct AgendaPanel: View {
    let events: [CalendarEvent]
    var onEventTap: ((CalendarEvent) -> Void)?

    private var upcoming: [CalendarEvent] {
        let today = Calendar.current.startOfDay(for: Date())
        return events
            .filter { ev in
                let eventStart = EventTime.start(date: ev.startDate, time: ev.startTime)
                return eventStart >= today
            }
            .sorted { (EventTime.start(date: $0.startDate, time: $0.startTime) < EventTime.start(date: $1.startDate, time: $1.startTime)) }
            .prefix(5)
            .map { $0 }
    }

    var body: some View {
        if !upcoming.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up.circle")
                        .font(.system(size: 11))
                        .foregroundStyle(LozaColor.accentBlue.opacity(0.8))
                    Text("Ближайшие")
                        .font(LozaType.subheadline)
                        .foregroundStyle(.white.opacity(0.88))
                    Spacer(minLength: 4)
                    Text("\(upcoming.count)")
                        .font(LozaType.fieldLabel)
                        .foregroundStyle(.white.opacity(0.88))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(LozaColor.accentBlue.opacity(0.3)))
                }

                ForEach(upcoming, id: \.id) { event in
                    Button { onEventTap?(event) } label: {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(event.color)
                                .frame(width: 6, height: 6)
                                .shadow(color: event.color.opacity(0.3), radius: 2)

                            VStack(alignment: .leading, spacing: 1) {
                                Text(event.title)
                                    .font(LozaType.body)
                                    .foregroundStyle(.white.opacity(0.88))
                                    .lineLimit(1)

                                let start = EventTime.start(date: event.startDate, time: event.startTime)
                                Text(start.formatted(date: .abbreviated, time: .shortened))
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
    }
}

#Preview {
    AgendaPanel(events: [])
        .padding()
        .background(LozaBackgroundView())
}
