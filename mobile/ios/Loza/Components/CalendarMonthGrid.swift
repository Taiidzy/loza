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
    @ObservedObject var store: CalendarEventsStore

    @State private var isPickerOpen = false

    private let calendar = Calendar.current
    private let weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.bottom, 16)

            HStack(spacing: 0) {
                ForEach(weekDays, id: \.self) { d in
                    Text(d)
                        .font(.system(size: 10))
                        .tracking(0.6)
                        .foregroundStyle(LozaColor.textTertiary)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 8)

            let days = daysInGrid()
            let rows = days.chunked(into: 7)

            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, week in
                    weekRow(week)
                        .padding(.vertical, 1)
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

    // ─── Week row (date cells + continuous multi-day bar overlay) ─────────

    @ViewBuilder
    private func weekRow(_ week: [Date]) -> some View {
        let weekMultiDay = multiDayEventsForWeek(week)

        ZStack(alignment: .topLeading) {
            // Date cells (date number + single-day dots)
            HStack(spacing: 0) {
                ForEach(week, id: \.self) { day in
                    dayCell(day)
                        .frame(maxWidth: .infinity)
                }
            }

            // Continuous multi-day bar overlay
            if !weekMultiDay.isEmpty {
                GeometryReader { geo in
                    let cellWidth = geo.size.width / 7
                    let barHeight: CGFloat = 3
                    let barY: CGFloat = 28

                    ForEach(weekMultiDay) { evt in
                        let (startCol, endCol) = columnRange(event: evt, week: week)
                        let x = CGFloat(startCol) * cellWidth
                        let w = CGFloat(endCol - startCol + 1) * cellWidth
                        let slot = store.eventSlots[evt.id] ?? 0
                        let y = barY + CGFloat(slot) * (barHeight + 2)

                        Capsule()
                            .fill(evt.color)
                            .frame(width: w, height: barHeight)
                            .position(x: x + w / 2, y: y + barHeight / 2)
                    }
                }
                .frame(height: 60)
            }
        }
    }

    /// Returns the unique multi-day events for this week, deduplicated by sourceId,
    /// sorted by slot then start date.
    private func multiDayEventsForWeek(_ week: [Date]) -> [ExpandedCalendarEvent] {
        guard let firstDay = week.first, let lastDay = week.last else { return [] }
        let firstKey = DateKeyFormat.string(from: firstDay)
        let lastKey = DateKeyFormat.string(from: lastDay)

        var seen = Set<String>()
        var result: [ExpandedCalendarEvent] = []

        for day in week {
            let (_, multiDay) = store.getEventsForDay(day)
            for evt in multiDay {
                guard !seen.contains(evt.id) else { continue }
                seen.insert(evt.id)
                if evt.startDate <= lastKey && evt.endDate >= firstKey {
                    result.append(evt)
                }
            }
        }

        return result.sorted { (lhs, rhs) -> Bool in
            let ls = store.eventSlots[lhs.id] ?? 0
            let rs = store.eventSlots[rhs.id] ?? 0
            if ls != rs { return ls < rs }
            return lhs.startDate < rhs.startDate
        }
    }

    /// Returns (startColumn, endColumn) for an event within a week (0-6).
    private func columnRange(event: ExpandedCalendarEvent, week: [Date]) -> (Int, Int) {
        guard let firstDay = week.first, let lastDay = week.last else { return (0, 0) }
        let firstKey = DateKeyFormat.string(from: firstDay)
        let lastKey = DateKeyFormat.string(from: lastDay)

        let startKey = max(event.startDate, firstKey)
        let endKey = min(event.endDate, lastKey)

        let startCol = calendar.dateComponents([.day], from: firstDay, to: DateKeyFormat.date(from: startKey)).day ?? 0
        let endCol = calendar.dateComponents([.day], from: firstDay, to: DateKeyFormat.date(from: endKey)).day ?? 0

        return (max(0, startCol), min(6, endCol))
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

                // Space reserved for multi-day bars (rendered at row level)
                if !multiDay.isEmpty {
                    let slotCount = min(multiDay.prefix(2).count, 2)
                    Color.clear.frame(height: CGFloat(slotCount) * 5)
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
        LozaBackgroundView()
        CalendarMonthGrid(currentMonth: .constant(Date()), selectedDate: .constant(Date()), store: CalendarEventsStore())
            .padding()
    }
}
