//
//  EventDetailsSheet.swift
//  Loza
//
//  Port of components/Calendar/EventDetailsModal.tsx as a native sheet
//  instead of a custom overlay+card (SwiftUI sheets already give us the
//  dim backdrop, drag-to-dismiss, and safe-area handling for free).
//

import SwiftUI

struct EventDetailsSheet: View {
    let event: ExpandedCalendarEvent
    var onEdit: () -> Void
    var onDelete: () -> Void
    var onClose: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Capsule()
                    .fill(event.color)
                    .frame(height: 4)
                    .shadow(color: event.color.opacity(0.5), radius: 6)

                detailRow(icon: "calendar", text: dateRangeLabel)
                detailRow(icon: "clock", text: EventTime.label(isAllDay: event.isAllDay, startTime: event.startTime, endTime: event.endTime))

                if event.recurrence != .none {
                    Text(event.recurrence.detailLabel)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(LozaColor.accentPink.opacity(0.85))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(LozaColor.accentPink.opacity(0.1)))
                }

                Spacer()

                HStack(spacing: 10) {
                    Button(role: .destructive, action: onDelete) {
                        Text("Удалить")
                            .font(.system(size: 13, weight: .medium))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                    }
                    .foregroundStyle(LozaColor.accentRed.opacity(0.9))
                    .background(RoundedRectangle(cornerRadius: 12).fill(LozaColor.accentRed.opacity(0.1)))

                    Button(action: onEdit) {
                        Text("Редактировать")
                            .font(.system(size: 13, weight: .medium))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                    }
                    .foregroundStyle(.white.opacity(0.9))
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.08)))
                }
            }
            .padding(20)
            .background(LozaColor.bgMobile.ignoresSafeArea())
            .navigationTitle(event.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Готово", action: onClose)
                        .foregroundStyle(LozaColor.accentPink)
                }
            }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium])
    }

    private func detailRow(icon: String, text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.4))
                .frame(width: 20)
            Text(text)
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.75))
        }
    }

    private var dateRangeLabel: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ru_RU")
        f.dateFormat = "d MMMM"
        let start = f.string(from: DateKeyFormat.date(from: event.startDate))
        guard event.isMultiDay else { return start }
        let end = f.string(from: DateKeyFormat.date(from: event.endDate))
        return "\(start) – \(end)"
    }
}
