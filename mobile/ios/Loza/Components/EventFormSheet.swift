//
//  EventFormSheet.swift
//  Loza
//
//  Vivid event form with gradient header, glass fields, alive buttons.
//

import SwiftUI

struct EventFormSheet: View {
    @Environment(\.dismiss) private var dismiss

    let eventDate: Date
    var event: CalendarEvent?
    var onSubmit: ((CalendarEventDraft) -> Void)?
    var onCancel: (() -> Void)?

    @State private var title: String
    @State private var start: Date
    @State private var end: Date
    @State private var selectedColor: Color

    private let colors = CalendarPalette.colors

    init(eventDate: Date = Date(), event: CalendarEvent? = nil, onSubmit: ((CalendarEventDraft) -> Void)? = nil, onCancel: (() -> Void)? = nil) {
        self.eventDate = eventDate
        self.event = event
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _title = State(initialValue: event?.title ?? "")
        _start = State(initialValue: EventTime.start(date: event?.startDate ?? DateKeyFormat.string(from: eventDate), time: event?.startTime))
        _end = State(initialValue: EventTime.end(date: event?.endDate ?? DateKeyFormat.string(from: eventDate), time: event?.endTime))
        _selectedColor = State(initialValue: event?.color ?? colors[0])
    }

    var body: some View {
        Form {
            headerSection
            detailsSection
            colorSection
            actionsSection
        }
        .scrollContentBackground(.hidden)
        .background(LozaBackgroundView())
        .navigationTitle(event == nil ? "Новое событие" : "Редактировать")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Отмена") { onCancel?() }
                    .foregroundStyle(.white.opacity(0.55))
            }
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(selectedColor)
                        .frame(width: 10, height: 10)
                    Text(event == nil ? "Новое событие" : "Редактировать")
                        .font(LozaType.title)
                        .foregroundStyle(.white.opacity(0.92))
                }
                Text(eventDate.formatted(date: .long, time: .omitted))
                    .font(LozaType.caption)
                    .foregroundStyle(.white.opacity(0.42))
            }
            .listRowBackground(Color.clear)
        }
    }

    // MARK: - Details

    private var detailsSection: some View {
        Section {
            field("Название", text: $title, placeholder: "Название события")
        }
    }

    // MARK: - Color

    private var colorSection: some View {
        Section {
            HStack(spacing: 12) {
                ForEach(colors, id: \.self) { c in
                    Circle()
                        .fill(c)
                        .frame(width: 28, height: 28)
                        .overlay(
                            Circle().stroke(Color.white.opacity(c == selectedColor ? 0.88 : 0), lineWidth: 2)
                        )
                        .onTapGesture { withAnimation { selectedColor = c } }
                }
            }
            .listRowBackground(Color.clear)
        }
    }

    // MARK: - Actions

    private var actionsSection: some View {
        Section {
            Button {
                let draft = CalendarEventDraft(
                    title: title.trimmingCharacters(in: .whitespaces),
                    startDate: DateKeyFormat.string(from: start),
                    endDate: DateKeyFormat.string(from: end),
                    startTime: nil,
                    endTime: nil,
                    color: selectedColor,
                    recurrence: .none,
                    isMultiDay: false,
                    isAllDay: false
                )
                onSubmit?(draft)
            } label: {
                Text(event == nil ? "Создать" : "Сохранить")
                    .font(LozaType.buttonLabel)
                    .foregroundStyle(.white.opacity(0.88))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
            }
            .listRowBackground(Color.clear)
        }
    }

    // MARK: - Field

    private func field(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(LozaType.fieldLabel)
                .tracking(1.2)
                .foregroundStyle(.white.opacity(0.16))
            TextField(placeholder, text: text)
                .font(LozaType.fieldInput)
                .foregroundStyle(.white.opacity(0.88))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .listRowBackground(Color.clear)
    }
}

#Preview {
    NavigationStack {
        EventFormSheet(eventDate: Date(), onSubmit: { _ in }, onCancel: {})
            .background(LozaBackgroundView())
    }
}
