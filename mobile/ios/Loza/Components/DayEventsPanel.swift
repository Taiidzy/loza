//
//  DayEventsPanel.swift
//  Loza
//
//  Vivid day events panel with gradient create button and alive rows.
//

import SwiftUI

struct DayEventsPanel: View {
    let selectedDate: Date
    let events: [CalendarEvent]
    var onCreate: (() -> Void)?
    var onEventTap: ((CalendarEvent) -> Void)?

    private var dayEvents: [CalendarEvent] {
        events.filter { ev in
            let eventDate = EventTime.start(date: ev.startDate, time: ev.startTime)
            return Calendar.current.isDate(eventDate, inSameDayAs: selectedDate)
        }
        .sorted { (EventTime.start(date: $0.startDate, time: $0.startTime) < EventTime.start(date: $1.startDate, time: $1.startTime)) }
    }

    private var hasEvents: Bool { !dayEvents.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "list.bullet")
                    .font(.system(size: 11))
                    .foregroundStyle(LozaColor.accentPink.opacity(0.8))
                Text(hasEvents ? "События" : "Нет событий")
                    .font(LozaType.subheadline)
                    .foregroundStyle(.white.opacity(0.88))

                Spacer(minLength: 4)

                if hasEvents {
                    Text("\(dayEvents.count)")
                        .font(LozaType.fieldLabel)
                        .foregroundStyle(.white.opacity(0.88))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(LozaColor.accentPink.opacity(0.3)))
                }

                Button(action: { onCreate?() }) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(LozaColor.accentPink.opacity(0.75))
                }
            }

            if hasEvents {
                ForEach(dayEvents, id: \.id) { event in
                    Button { onEventTap?(event) } label: {
                        HStack(spacing: 6) {
                            Rectangle()
                                .fill(event.color)
                                .frame(width: 3, height: 24)
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
            } else {
                HStack(spacing: 6) {
                    Image(systemName: "sun.max")
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.28))
                    Text("Свободный день")
                        .font(LozaType.body)
                        .foregroundStyle(.white.opacity(0.42))
                }
                .frame(maxWidth: .infinity, minHeight: 52)
            }
        }
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: LozaMetrics.cardRadius))
        .padding(.horizontal, 12)
    }
}

#Preview {
    DayEventsPanel(selectedDate: Date(), events: [])
        .padding()
        .background(LozaBackgroundView())
}
