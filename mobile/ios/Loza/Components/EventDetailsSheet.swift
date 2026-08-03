//
//  EventDetailsSheet.swift
//  Loza
//
//  Vivid event detail sheet with icon-accented rows, gradient buttons, glass.
//

import SwiftUI

struct EventDetailsSheet: View {
    let event: CalendarEvent
    var onEdit: () -> Void
    var onDelete: ((CalendarEvent) -> Void)?
    @Environment(\.dismiss) private var dismiss

    @State private var showEditSheet = false
    @State private var showDeleteConfirmation = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                detailsSection
                actionsSection
            }
            .padding(.vertical, 20)
            .padding(.horizontal, 16)
        }
        .navigationTitle("Событие")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Закрыть") { dismiss() }
                    .foregroundStyle(.white.opacity(0.55))
            }
        }
        .sheet(isPresented: $showEditSheet) {
            NavigationStack {
                EventFormSheet(event: event, onSubmit: { _ in
                    showEditSheet = false
                    onEdit()
                }, onCancel: { showEditSheet = false })
                .background(LozaBackgroundView())
            }
        }
        .confirmationDialog("Удалить событие?", isPresented: $showDeleteConfirmation, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { onDelete?(event) }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle()
                    .fill(event.color)
                    .frame(width: 10, height: 10)
                    .shadow(color: event.color.opacity(0.4), radius: 3)
                Text(event.title)
                    .font(LozaType.title)
                    .foregroundStyle(.white.opacity(0.92))
                    .lineLimit(2)
            }
            let start = EventTime.start(date: event.startDate, time: event.startTime)
            Text(start.formatted(date: .long, time: .shortened))
                .font(LozaType.caption)
                .foregroundStyle(.white.opacity(0.42))
        }
    }

    // MARK: - Details

    private var detailsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            let start = EventTime.start(date: event.startDate, time: event.startTime)
            let end = EventTime.end(date: event.endDate, time: event.endTime)

            row(icon: "clock", label: "Начало", value: start.formatted(date: .abbreviated, time: .shortened))
            row(icon: "clock.badge.checkmark", label: "Конец", value: end.formatted(date: .abbreviated, time: .shortened))
            row(icon: "repeat", label: "Повторение", value: event.recurrence.detailLabel)
            row(icon: "calendar.badge.clock", label: "Время", value: EventTime.label(isAllDay: event.isAllDay, startTime: event.startTime, endTime: event.endTime))
        }
        .glassEffect(.regular, in: .rect(cornerRadius: LozaMetrics.cardRadius))
    }

    // MARK: - Actions

    private var actionsSection: some View {
        VStack(spacing: 8) {
            Button {
                showEditSheet = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "pencil")
                        .font(.system(size: 12))
                    Text("Редактировать")
                        .font(LozaType.buttonLabel)
                }
                .foregroundStyle(.white.opacity(0.88))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
            }
            .glassEffect(.regular.tint(LozaColor.accentPink.opacity(0.25)), in: .rect(cornerRadius: 14))

            Button {
                showDeleteConfirmation = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "trash")
                        .font(.system(size: 12))
                    Text("Удалить")
                        .font(LozaType.buttonLabel)
                }
                .foregroundStyle(LozaColor.accentRed.opacity(0.85))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
            }
            .glassEffect(.regular.tint(LozaColor.accentRed.opacity(0.15)), in: .rect(cornerRadius: 14))
        }
    }

    private func row(icon: String, label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.28))
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(LozaType.caption)
                    .foregroundStyle(.white.opacity(0.42))
                Text(value)
                    .font(LozaType.body)
                    .foregroundStyle(.white.opacity(0.78))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 14)
    }
}

#Preview {
    EventDetailsSheet(
        event: CalendarEvent(
            id: "", title: "Встреча", startDate: DateKeyFormat.string(from: Date()),
            endDate: DateKeyFormat.string(from: Date()), startTime: "09:00", endTime: "10:00",
            color: LozaColor.accentPink, recurrence: .none, isMultiDay: false, isAllDay: false
        ),
        onEdit: {},
        onDelete: { _ in }
    )
    .background(LozaBackgroundView())
}
