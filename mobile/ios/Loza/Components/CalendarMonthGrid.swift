//
//  CalendarMonthGrid.swift
//  Loza
//
//  Port of components/Calendar/CalendarCard.tsx: month grid, day cells with
//  multi-day event "lines" (stacked by slot) and single-day event dots,
//  today/selected highlighting, and a tap-to-open month/year picker in the
//  header. Presentational only — selection, month, and event data all come
//  from the parent (CalendarView), same relationship as CustomCalendar/
//  ActivityTab on desktop.
//

import SwiftUI

struct CalendarMonthGrid: View {
    @Binding var currentMonth: Date
    @Binding var selectedDate: Date?
    let store: CalendarEventsStore

    @State private var isPickerOpen = false

    private let calendar = Calendar.current
    private let weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.bottom, 16)

            HStack(spacing: 6) {
                ForEach(weekDays, id: \.self) { d in
                    Text(d)
                        .font(.system(size: 10))
                        .tracking(0.6)
                        .foregroundStyle(LozaColor.textTertiary)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.bottom, 8)

            let days = daysInGrid()
            let rows = days.chunked(into: 7)

            VStack(spacing: 4) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, week in
                    HStack(spacing: 4) {
                        ForEach(week, id: \.self) { day in
                            dayCell(day)
                        }
                    }
                }
            }
        }
        .padding(16)
        .lozaCard()
        .overlay(alignment: .top) {
            if isPickerOpen {
                MonthYearPicker(currentDate: currentMonth, onSelect: { date in
                    currentMonth = date
                    isPickerOpen = false
                }, onClose: { isPickerOpen = false })
                .padding(.top, 52)
                .zIndex(20)
            }
        }
    }

    // ─── Header ─────────────────────────────────────────────────────────────

    private var header: some View {
        HStack {
            Button {
                withAnimation(.easeOut(duration: 0.25)) {
                    currentMonth = calendar.date(byAdding: .month, value: -1, to: currentMonth) ?? currentMonth
                }
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.4))
                    .frame(width: 30, height: 30)
            }

            Spacer()

            Button {
                withAnimation(.easeOut(duration: 0.15)) { isPickerOpen.toggle() }
            } label: {
                HStack(spacing: 4) {
                    Text(monthYearLabel)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.9))
                        .textCase(.lowercase)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.3))
                        .rotationEffect(.degrees(isPickerOpen ? 180 : 0))
                }
            }

            Spacer()

            Button {
                withAnimation(.easeOut(duration: 0.25)) {
                    currentMonth = calendar.date(byAdding: .month, value: 1, to: currentMonth) ?? currentMonth
                }
            } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.4))
                    .frame(width: 30, height: 30)
            }
        }
    }

    private var monthYearLabel: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ru_RU")
        f.dateFormat = "LLLL yyyy"
        return f.string(from: currentMonth)
    }

    // ─── Day cell ───────────────────────────────────────────────────────────

    @ViewBuilder
    private func dayCell(_ day: Date) -> some View {
        let isCurrentMonth = calendar.isDate(day, equalTo: currentMonth, toGranularity: .month)
        let isSelected = selectedDate.map { calendar.isDate($0, inSameDayAs: day) } ?? false
        let isToday = calendar.isDateInToday(day)
        let (singleDay, multiDay) = store.getEventsForDay(day)

        Button {
            withAnimation(.easeOut(duration: 0.15)) { selectedDate = day }
        } label: {
            VStack(spacing: 3) {
                Text("\(calendar.component(.day, from: day))")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(
                        isSelected ? LozaColor.accentPink
                            : isToday ? LozaColor.accentPink.opacity(0.85)
                            : isCurrentMonth ? .white.opacity(0.75)
                            : .white.opacity(0.2)
                    )

                // Multi-day lines (stacked)
                if !multiDay.isEmpty {
                    VStack(spacing: 2) {
                        ForEach(multiDay.prefix(2)) { evt in
                            Capsule()
                                .fill(evt.color)
                                .frame(height: 3)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 2)
                }

                // Single-day dots
                if !singleDay.isEmpty {
                    HStack(spacing: 2) {
                        ForEach(singleDay.prefix(3)) { evt in
                            Circle()
                                .fill(evt.color)
                                .frame(width: 4, height: 4)
                        }
                    }
                } else if multiDay.isEmpty {
                    // Reserve vertical space so rows don't jump in height
                    Color.clear.frame(height: 4)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(isSelected ? LozaColor.accentPink.opacity(0.12) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(isSelected ? LozaColor.accentPink.opacity(0.35) : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // ─── Grid math ──────────────────────────────────────────────────────────

    private func daysInGrid() -> [Date] {
        guard let monthInterval = calendar.dateInterval(of: .month, for: currentMonth) else { return [] }
        let firstOfMonth = monthInterval.start

        // ISO-style week starting Monday, matches weekDays order above.
        let weekday = calendar.component(.weekday, from: firstOfMonth) // 1 = Sunday
        let mondayOffset = (weekday + 5) % 7
        guard let gridStart = calendar.date(byAdding: .day, value: -mondayOffset, to: firstOfMonth) else { return [] }

        var days: [Date] = []
        var cursor = gridStart
        for _ in 0..<42 {
            days.append(cursor)
            cursor = calendar.date(byAdding: .day, value: 1, to: cursor) ?? cursor
        }
        return days
    }
}

extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}

#Preview {
    ZStack {
        LozaColor.bgMobile.ignoresSafeArea()
        CalendarMonthGrid(currentMonth: .constant(Date()), selectedDate: .constant(Date()), store: CalendarEventsStore())
            .padding()
    }
}
