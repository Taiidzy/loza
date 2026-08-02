//
//  DayEventsPanel.swift
//  Loza
//
//  Port of components/Calendar/DayEventsPanel.tsx: list of events for the
//  selected day; tapping a row opens details (sheet), "Добавить" / the big
//  empty-state button open the create sheet. State for which sheet is open
//  lives in the parent CalendarView, same as ActivityTab owning DayEventsPanel's
//  modal state on desktop — this view just reports taps upward.
//

import SwiftUI

struct DayEventsPanel: View {
    let selectedDate: Date?
    let dayEvents: [ExpandedCalendarEvent]
    var onSelect: (ExpandedCalendarEvent) -> Void
    var onCreate: () -> Void

    var body: some View {
        if selectedDate == nil {
            Text("Выберите день в календаре")
                .font(.system(size: 12))
                .foregroundStyle(LozaColor.textFaint)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if dayEvents.isEmpty {
            VStack {
                Spacer()
                Button(action: onCreate) {
                    Text("+ Создать событие")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(LozaColor.accentPink.opacity(0.9))
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(LozaColor.accentPink.opacity(0.1))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(LozaColor.accentPink.opacity(0.25), lineWidth: 1)
                        )
                }
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(dayEvents) { evt in
                            Button {
                                onSelect(evt)
                            } label: {
                                HStack(spacing: 10) {
                                    Circle()
                                        .fill(evt.color)
                                        .frame(width: 7, height: 7)
                                        .shadow(color: evt.color.opacity(0.5), radius: 4)

                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(evt.title)
                                            .font(.system(size: 12.5, weight: .medium))
                                            .foregroundStyle(.white.opacity(0.85))
                                            .lineLimit(1)
                                        Text(rowSubtitle(evt))
                                            .font(.system(size: 10.5))
                                            .foregroundStyle(.white.opacity(0.32))
                                    }
                                    Spacer()
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 9)
                                .background {
                                    if #available(iOS 26.0, *) {
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .fill(Color.clear)
                                            .glassEffect(.regular)
                                    } else {
                                        RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.03))
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                Button(action: onCreate) {
                    Text("Добавить")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white.opacity(0.75))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .background {
                            if #available(iOS 26.0, *) {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(Color.clear)
                                    .glassEffect(.regular)
                            } else {
                                RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.05))
                            }
                        }
                }
                .padding(.top, 8)
            }
        }
    }

    private func rowSubtitle(_ evt: ExpandedCalendarEvent) -> String {
        var label = EventTime.label(isAllDay: evt.isAllDay, startTime: evt.startTime, endTime: evt.endTime)
        if evt.recurrence != .none { label += " · повторяется" }
        return label
    }
}
