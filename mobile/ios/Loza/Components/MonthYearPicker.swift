//
//  MonthYearPicker.swift
//  Loza
//
//  Port of components/Calendar/MonthYearPicker.tsx: a 12-month grid for the
//  currently viewed year, plus year prev/next and a "Сегодня" shortcut.
//  Opened by tapping the month title in CalendarMonthGrid's header.
//

import SwiftUI

struct MonthYearPicker: View {
    let currentDate: Date
    var onSelect: (Date) -> Void
    var onClose: () -> Void

    @State private var viewYear: Int

    private let calendar = Calendar.current
    private let monthLabels = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"]

    init(currentDate: Date, onSelect: @escaping (Date) -> Void, onClose: @escaping () -> Void) {
        self.currentDate = currentDate
        self.onSelect = onSelect
        self.onClose = onClose
        _viewYear = State(initialValue: Calendar.current.component(.year, from: currentDate))
    }

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                Button { viewYear -= 1 } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.5))
                }
                Spacer()
                Text("\(viewYear)")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white.opacity(0.9))
                Spacer()
                Button { viewYear += 1 } label: {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.5))
                }
            }

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 4), spacing: 6) {
                ForEach(Array(monthLabels.enumerated()), id: \.offset) { idx, label in
                    let isActive = viewYear == calendar.component(.year, from: currentDate) && idx == calendar.component(.month, from: currentDate) - 1
                    let isRealMonth = viewYear == calendar.component(.year, from: Date()) && idx == calendar.component(.month, from: Date()) - 1

                    Button {
                        var comps = DateComponents()
                        comps.year = viewYear
                        comps.month = idx + 1
                        comps.day = 1
                        if let date = calendar.date(from: comps) {
                            onSelect(date)
                        }
                    } label: {
                        VStack(spacing: 2) {
                            Text(label)
                            if isRealMonth && !isActive {
                                Circle().fill(LozaColor.accentPink).frame(width: 3, height: 3)
                            }
                        }
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(isActive ? .white : .white.opacity(0.6))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .background(
                            if #available(iOS 26.0, *) {
                                if isActive {
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .fill(LozaColor.accentPink.opacity(0.25))
                                } else {
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .fill(Color.clear)
                                        .glassEffect(.regular)
                                }
                            } else {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(isActive ? LozaColor.accentPink.opacity(0.25) : Color.white.opacity(0.04))
                            }
                        )
                    }
                    .buttonStyle(.plain)
                }
            }

            Button {
                onSelect(Date())
            } label: {
                Text("Сегодня")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(LozaColor.accentPink.opacity(0.9))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                }
                .background(
                    if #available(iOS 26.0, *) {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(Color.clear)
                            .glassEffect(.regular)
                    } else {
                        RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.04))
                    }
                )
        }
        .padding(16)
        .frame(width: 260)
        .glassEffect(.regular, in: .rect(cornerRadius: 18))
        .overlay(
            if #available(iOS 26.0, *) {
                /* No stroke on iOS 26 — Liquid Glass handles borders */
                EmptyView()
            } else {
                RoundedRectangle(cornerRadius: 18)
                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
            }
        )
        .onChange(of: currentDate) { _, newValue in
            viewYear = calendar.component(.year, from: newValue)
        }
    }
}
