//
//  AgendaPanel.swift
//  Loza
//
//  Port of components/Calendar/AgendaPanel.tsx: list of upcoming events
//  ("Сегодня" / "Завтра" / "12 июля" date labels), tapping a row opens
//  details — same as DayEventsPanel, owner of modal state is the parent.
//

import SwiftUI

struct AgendaPanel: View {
    let events: [ExpandedCalendarEvent]
    var isLoading: Bool = false
    var limit: Int = 8
    var onSelect: (ExpandedCalendarEvent) -> Void

    var body: some View {
        let items = Array(events.prefix(limit))

        if isLoading {
            Text("Загрузка…")
                .font(.system(size: 11))
                .foregroundStyle(LozaColor.textFaint)
        } else if items.isEmpty {
            Text("Нет предстоящих событий")
                .font(.system(size: 11))
                .foregroundStyle(LozaColor.textFaint)
        } else {
            VStack(spacing: 6) {
                ForEach(items) { evt in
                    Button { onSelect(evt) } label: {
                        HStack(spacing: 10) {
                            Circle()
                                .fill(evt.color)
                                .frame(width: 7, height: 7)
                                .shadow(color: evt.color.opacity(0.5), radius: 4)

                            VStack(alignment: .leading, spacing: 1) {
                                Text(evt.title)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(.white.opacity(0.8))
                                    .lineLimit(1)
                                Text(subtitle(evt))
                                    .font(.system(size: 10.5))
                                    .foregroundStyle(.white.opacity(0.3))
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.03)))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func subtitle(_ evt: ExpandedCalendarEvent) -> String {
        var s = dayLabel(DateKeyFormat.date(from: evt.startDate))
        if evt.isMultiDay {
            s += " – \(dayLabel(DateKeyFormat.date(from: evt.endDate)))"
        }
        s += " · " + EventTime.label(isAllDay: evt.isAllDay, startTime: evt.startTime, endTime: evt.endTime)
        return s
    }

    private func dayLabel(_ date: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(date) { return "Сегодня" }
        if cal.isDateInTomorrow(date) { return "Завтра" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "ru_RU")
        f.dateFormat = "d MMMM"
        return f.string(from: date)
    }
}
