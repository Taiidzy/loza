//
//  MonthYearPicker.swift
//  Loza
//
//  Vivid month/year grid picker with pink accents and alive selection.
//

import SwiftUI

struct MonthYearPicker: View {
    @Binding var selectedDate: Date
    @State private var currentYear: Int
    @Environment(\.dismiss) private var dismiss

    private let months = Calendar.current.monthSymbols

    init(selectedDate: Binding<Date>) {
        self._selectedDate = selectedDate
        _currentYear = State(initialValue: Calendar.current.component(.year, from: selectedDate.wrappedValue))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    yearHeader
                    monthsGrid
                }
                .padding(.vertical, 16)
            }
            .background(LozaBackgroundView())
            .navigationTitle("Выбор даты")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Готово") { dismiss() }
                        .foregroundStyle(LozaColor.accentPink.opacity(0.85))
                }
            }
        }
    }

    private var yearHeader: some View {
        HStack {
            Button {
                withAnimation { currentYear -= 1 }
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(LozaColor.accentPink.opacity(0.7))
                    .frame(width: 32, height: 32)
            }
            Spacer()
            Text("\(currentYear)")
                .font(LozaType.title)
                .foregroundStyle(.white.opacity(0.88))
            Spacer()
            Button {
                withAnimation { currentYear += 1 }
            } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(LozaColor.accentPink.opacity(0.7))
                    .frame(width: 32, height: 32)
            }
        }
        .padding(.horizontal, 16)
    }

    private var monthsGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
            ForEach(0..<12, id: \.self) { idx in
                let monthIndex = idx + 1
                let isSelected = Calendar.current.component(.month, from: selectedDate) == monthIndex
                    && Calendar.current.component(.year, from: selectedDate) == currentYear

                Button {
                    var comps = DateComponents()
                    comps.year = currentYear
                    comps.month = monthIndex
                    comps.day = 1
                    if let date = Calendar.current.date(from: comps) {
                        withAnimation { selectedDate = date }
                    }
                    dismiss()
                } label: {
                    Text(months[idx])
                        .font(LozaType.subheadline)
                        .foregroundStyle(isSelected ? .white.opacity(0.92) : .white.opacity(0.55))
                        .frame(maxWidth: .infinity)
                        .frame(height: 40)
                        .background(
                            RoundedRectangle(cornerRadius: 10)
                                .fill(isSelected ? LozaColor.accentPink.opacity(0.85) : Color.white.opacity(0.04))
                        )
                }
            }
        }
        .padding(.horizontal, 16)
    }
}

#Preview {
    MonthYearPicker(selectedDate: .constant(Date()))
}
