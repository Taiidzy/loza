//
//  CalendarMonthGrid.swift
//  Loza
//
//  Vivid month grid with pink accents, gradient nav arrows, alive selected state.
//

import SwiftUI

struct CalendarMonthGrid: View {
    @Binding var selectedDate: Date
    var events: [CalendarEvent]

    @State private var currentMonth: Date
    @State private var direction: CalendarViewDirection = .none
    @State private var weekOf: Date?

    private let calendar = Calendar.current
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)

    enum CalendarViewDirection { case left, right, none }

    init(selectedDate: Binding<Date>, events: [CalendarEvent]) {
        self._selectedDate = selectedDate
        self.events = events
        self._currentMonth = State(initialValue: Calendar.current.startOfMonth(for: selectedDate.wrappedValue))
    }

    var body: some View {
        VStack(spacing: 0) {
            monthHeader
                .padding(.top, 2)
                .padding(.horizontal, 4)
                .padding(.bottom, 4)

            weekdayHeader
                .padding(.horizontal, 4)
                .padding(.bottom, 6)

            daysGrid
        }
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: LozaMetrics.cardRadius))
        .padding(.horizontal, 12)
        .gesture(swipeGesture)
    }

    // MARK: - Month Header

    private var monthHeader: some View {
        let monthTitle = currentMonth.formatted(.dateTime.year().month(.wide))
        return HStack {
            Button {
                withAnimation { currentMonth = calendar.date(byAdding: .month, value: -1, to: currentMonth)! }
                UIImpactFeedbackGenerator(style: .soft).impactOccurred()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(LozaColor.accentPink.opacity(0.7))
                    .frame(width: 32, height: 32)
            }
            Spacer()
            Text(monthTitle)
                .font(LozaType.title)
                .foregroundStyle(.white.opacity(0.88))
                .id(monthTitle + "\(currentMonth)")
                .transition(.asymmetric(
                    insertion: .move(edge: direction == .left ? .trailing : .leading).combined(with: .opacity),
                    removal: .move(edge: direction == .left ? .leading : .trailing).combined(with: .opacity)
                ))
            Spacer()
            Button {
                withAnimation { currentMonth = calendar.date(byAdding: .month, value: 1, to: currentMonth)! }
                UIImpactFeedbackGenerator(style: .soft).impactOccurred()
            } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(LozaColor.accentPink.opacity(0.7))
                    .frame(width: 32, height: 32)
            }
        }
    }

    // MARK: - Weekday Header

    private var weekdayHeader: some View {
        let symbols = calendar.veryShortWeekdaySymbols
        return HStack {
            ForEach(symbols, id: \.self) { sym in
                Text(sym)
                    .font(LozaType.fieldLabel)
                    .foregroundStyle(.white.opacity(0.42))
                    .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - Days Grid

    private var daysGrid: some View {
        let days = generateDays()
        return LazyVGrid(columns: columns, spacing: 0) {
            ForEach(days, id: \.self) { date in
                DayCell(
                    date: date,
                    isCurrentMonth: calendar.isDate(date, equalTo: currentMonth, toGranularity: .month),
                    isToday: calendar.isDateInToday(date),
                    isSelected: calendar.isDate(date, inSameDayAs: selectedDate),
                    hasEvents: events.contains { ev in
                        let eventDate = EventTime.start(date: ev.startDate, time: ev.startTime)
                        return calendar.isDate(eventDate, inSameDayAs: date)
                    },
                    weekOf: weekOf,
                    onSelect: {
                        withAnimation(.easeInOut(duration: 0.15)) { selectedDate = date }
                        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
                    }
                )
            }
        }
        .animation(.easeInOut(duration: 0.25), value: currentMonth)
    }

    // MARK: - Swipe

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 20, coordinateSpace: .local)
            .onEnded { value in
                let threshold: CGFloat = 30
                if value.translation.width < -threshold {
                    direction = .left
                    withAnimation { currentMonth = calendar.date(byAdding: .month, value: 1, to: currentMonth)! }
                } else if value.translation.width > threshold {
                    direction = .right
                    withAnimation { currentMonth = calendar.date(byAdding: .month, value: -1, to: currentMonth)! }
                }
            }
    }

    private func generateDays() -> [Date] {
        guard let monthInterval = calendar.dateInterval(of: .month, for: currentMonth),
              let monthFirstWeek = calendar.dateInterval(of: .weekOfMonth, for: monthInterval.start) else { return [] }
        let startDay = monthFirstWeek.start
        var days: [Date] = []
        var current = startDay
        for _ in 0..<42 {
            days.append(current)
            current = calendar.date(byAdding: .day, value: 1, to: current)!
        }
        return days
    }
}

// MARK: - Day Cell

private struct DayCell: View {
    let date: Date
    let isCurrentMonth: Bool
    let isToday: Bool
    let isSelected: Bool
    let hasEvents: Bool
    let weekOf: Date?
    let onSelect: () -> Void

    private var dayNumber: String {
        let f = DateFormatter()
        f.dateFormat = "d"
        return f.string(from: date)
    }

    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: 2) {
                Text(dayNumber)
                    .font(.system(size: 16, weight: isSelected ? .bold : .regular))
                    .foregroundStyle(
                        isSelected ? .white.opacity(0.92)
                        : isToday ? LozaColor.accentPink
                        : isCurrentMonth ? .white.opacity(0.65) : .white.opacity(0.18)
                    )
                    .frame(width: 34, height: 34)
                    .background(
                        Group {
                            if isSelected {
                                Circle().fill(LozaColor.accentPink.opacity(0.85))
                            }
                        }
                    )

                if hasEvents {
                    Circle()
                        .fill(isCurrentMonth ? LozaColor.accentPink.opacity(0.7) : .white.opacity(0.2))
                        .frame(width: 3, height: 3)
                } else {
                    Circle().fill(.clear).frame(width: 3, height: 3)
            }
            }
            .padding(.vertical, 1)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Calendar helpers

extension Calendar {
    func startOfMonth(for date: Date) -> Date {
        let components = self.dateComponents([.year, .month], from: date)
        return self.date(from: components) ?? date
    }
}

#Preview {
    CalendarMonthGrid(selectedDate: .constant(Date()), events: [])
        .padding()
        .background(LozaBackgroundView())
}
