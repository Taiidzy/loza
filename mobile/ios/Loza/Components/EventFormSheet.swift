//
//  EventFormSheet.swift
//  Loza
//
//  Port of components/Calendar/EventFormModal.tsx as a native sheet with
//  a Form instead of a hand-rolled modal card — native date/time pickers
//  and a native Picker for recurrence replace CustomSelect.tsx (that
//  component only existed to work around Tauri/webview <select> styling,
//  which doesn't apply here).
//
//  "Многодневное" (isMultiDay) and "Весь день" (isAllDay) stay independent
//  toggles, same semantics as the TS version: an event can span multiple
//  days AND have a specific time each day (e.g. a 3-day conference,
//  10:00–18:00), or be single-day with no time (e.g. a birthday).
//

import SwiftUI

struct EventFormSheet: View {
    let selectedDate: Date
    let existingEvent: CalendarEvent?
    var onSave: (CalendarEventDraft) -> Void
    var onClose: () -> Void

    @State private var title: String
    @State private var startDate: Date
    @State private var endDate: Date
    @State private var isMultiDay: Bool
    @State private var isAllDay: Bool
    @State private var startTime: Date
    @State private var endTime: Date
    @State private var recurrence: Recurrence
    @State private var color: Color

    init(selectedDate: Date, existingEvent: CalendarEvent?, onSave: @escaping (CalendarEventDraft) -> Void, onClose: @escaping () -> Void) {
        self.selectedDate = selectedDate
        self.existingEvent = existingEvent
        self.onSave = onSave
        self.onClose = onClose

        let cal = Calendar.current
        _title = State(initialValue: existingEvent?.title ?? "")
        _startDate = State(initialValue: existingEvent.map { DateKeyFormat.date(from: $0.startDate) } ?? selectedDate)
        _endDate = State(initialValue: existingEvent.map { DateKeyFormat.date(from: $0.endDate) } ?? selectedDate)
        _isMultiDay = State(initialValue: existingEvent?.isMultiDay ?? false)
        _isAllDay = State(initialValue: existingEvent?.isAllDay ?? true)
        _startTime = State(initialValue: Self.parseTime(existingEvent?.startTime ?? "09:00", on: selectedDate, cal: cal))
        _endTime = State(initialValue: Self.parseTime(existingEvent?.endTime ?? "10:00", on: selectedDate, cal: cal))
        _recurrence = State(initialValue: existingEvent?.recurrence ?? .none)
        _color = State(initialValue: existingEvent?.color ?? CalendarPalette.colors[0])
    }

    private static func parseTime(_ hm: String, on date: Date, cal: Calendar) -> Date {
        let parts = hm.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return date }
        return cal.date(bySettingHour: h, minute: m, second: 0, of: date) ?? date
    }

    private var canSave: Bool { !title.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Название события", text: $title)
                }

                Section {
                    Toggle("Многодневное", isOn: $isMultiDay.animation())
                    Toggle("Весь день", isOn: $isAllDay.animation())
                }

                Section(isMultiDay ? "Дата начала" : "Дата") {
                    DatePicker("Начало", selection: $startDate, displayedComponents: .date)
                    if isMultiDay {
                        DatePicker("Конец", selection: $endDate, in: startDate..., displayedComponents: .date)
                    }
                }

                if !isAllDay {
                    Section("Время") {
                        DatePicker("Начало", selection: $startTime, displayedComponents: .hourAndMinute)
                        DatePicker("Конец", selection: $endTime, displayedComponents: .hourAndMinute)
                    }
                }

                Section("Повторение") {
                    Picker("Повторение", selection: $recurrence) {
                        ForEach(Recurrence.allCases, id: \.self) { r in
                            Text(r.label).tag(r)
                        }
                    }
                    .pickerStyle(.menu)
                }

                Section("Цвет") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 7), spacing: 10) {
                        ForEach(Array(CalendarPalette.colors.enumerated()), id: \.offset) { _, c in
                            Button {
                                color = c
                            } label: {
                                Circle()
                                    .fill(c)
                                    .frame(width: 26, height: 26)
                                    .overlay(
                                        Circle().stroke(Color.white.opacity(colorsMatch(c, color) ? 0.9 : 0), lineWidth: 2)
                                    )
                                    .shadow(color: colorsMatch(c, color) ? c.opacity(0.6) : .clear, radius: 6)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .scrollContentBackground(.hidden)
            .lozaBackground()
            .navigationTitle(existingEvent != nil ? "Редактировать событие" : "Новое событие")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена", action: onClose)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить", action: handleSave)
                        .disabled(!canSave)
                        .fontWeight(.semibold)
                }
            }
        }
        .preferredColorScheme(.dark)
        .tint(LozaColor.accentPink)
    }

    private func colorsMatch(_ a: Color, _ b: Color) -> Bool {
        a.hexString == b.hexString
    }

    private func handleSave() {
        guard canSave else { return }
        let cal = Calendar.current
        let startKey = DateKeyFormat.string(from: startDate)
        let endKey = isMultiDay ? DateKeyFormat.string(from: endDate) : startKey

        let startTimeStr: String? = isAllDay ? nil : String(format: "%02d:%02d", cal.component(.hour, from: startTime), cal.component(.minute, from: startTime))
        let endTimeStr: String? = isAllDay ? nil : String(format: "%02d:%02d", cal.component(.hour, from: endTime), cal.component(.minute, from: endTime))

        onSave(CalendarEventDraft(
            title: title.trimmingCharacters(in: .whitespaces),
            startDate: startKey,
            endDate: endKey,
            startTime: startTimeStr,
            endTime: endTimeStr,
            color: color,
            recurrence: recurrence,
            isMultiDay: isMultiDay,
            isAllDay: isAllDay
        ))
    }
}
