//
//  CalendarView.swift
//  Loza
//
//  Port of pages/dashboard/tabs/ActivityTab.tsx: month grid on top, "День"
//  panel (selected day's events + create/edit) below, and an "Ближайшие
//  события" (agenda) section — stacked vertically for a phone instead of
//  the desktop's 70/30 two-column split, since there isn't room for
//  side-by-side panels on a phone screen. All the same data/CRUD flows
//  (CalendarEventsStore = useCalendarEvents.ts) and the same modal
//  responsibilities (details/edit/create), just presented as native sheets.
//

import SwiftUI

struct CalendarView: View {
    @StateObject private var store = CalendarEventsStore()

    @State private var currentMonth = Date()
    @State private var selectedDate: Date? = Date()

    private enum SheetState: Identifiable {
        case details(ExpandedCalendarEvent)
        case create
        case edit(ExpandedCalendarEvent)

        var id: String {
            switch self {
            case .details(let e): return "details-\(e.id)"
            case .create: return "create"
            case .edit(let e): return "edit-\(e.id)"
            }
        }
    }

    @State private var sheet: SheetState?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    CalendarMonthGrid(currentMonth: $currentMonth, selectedDate: $selectedDate, store: store)
                        .frame(height: 360)

                    dayPanel

                    agendaPanel
                }
                .padding(16)
            }
            .background { LozaBackgroundView() }
            .navigationTitle("Активность")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            recalcVisibleRange()
            await store.reload()
        }
        .onChange(of: currentMonth) { _, _ in recalcVisibleRange() }
        .sheet(item: $sheet) { state in
            switch state {
            case .details(let evt):
                EventDetailsSheet(
                    event: evt,
                    onEdit: { sheet = .edit(evt) },
                    onDelete: { Task { await handleDelete(evt) } },
                    onClose: { sheet = nil }
                )
            case .create:
                EventFormSheet(
                    selectedDate: selectedDate ?? Date(),
                    existingEvent: nil,
                    onSave: { draft in Task { await handleCreate(draft) } },
                    onClose: { sheet = nil }
                )
            case .edit(let evt):
                EventFormSheet(
                    selectedDate: selectedDate ?? Date(),
                    existingEvent: store.originalEvent(for: evt),
                    onSave: { draft in Task { await handleUpdate(draft, original: evt) } },
                    onClose: { sheet = nil }
                )
            }
        }
    }

    // ─── Panels ─────────────────────────────────────────────────────────────

    private var dayPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            CardLabel(text: "События дня\(selectedDate.map { " · " + dayLabel($0) } ?? "")")
                .padding(.bottom, 12)

            DayEventsPanel(
                selectedDate: selectedDate,
                dayEvents: selectedDayEvents,
                onSelect: { sheet = .details($0) },
                onCreate: { sheet = .create }
            )
            .frame(minHeight: 140, maxHeight: 260)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lozaCard()
    }

    private var agendaPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            CardLabel(text: "Ближайшие события")
                .padding(.bottom, 12)

            AgendaPanel(events: store.upcoming, isLoading: store.isLoading, limit: 8) { evt in
                sheet = .details(evt)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lozaCard()
    }

    // ─── Data ───────────────────────────────────────────────────────────────

    private var selectedDayEvents: [ExpandedCalendarEvent] {
        guard let selectedDate else { return [] }
        let (single, multi) = store.getEventsForDay(selectedDate)
        return multi + single
    }

    private func recalcVisibleRange() {
        let cal = Calendar.current
        guard let monthInterval = cal.dateInterval(of: .month, for: currentMonth) else { return }
        store.setVisibleRange(start: monthInterval.start, end: monthInterval.end)
    }

    private func dayLabel(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ru_RU")
        f.dateFormat = "d MMMM"
        return f.string(from: date)
    }

    // ─── Actions ────────────────────────────────────────────────────────────

    private func handleCreate(_ draft: CalendarEventDraft) async {
        try? await store.createEvent(draft)
        sheet = nil
    }

    private func handleUpdate(_ draft: CalendarEventDraft, original: ExpandedCalendarEvent) async {
        guard let source = store.originalEvent(for: original) else { sheet = nil; return }
        let updated = CalendarEvent(
            id: source.id, title: draft.title, startDate: draft.startDate, endDate: draft.endDate,
            startTime: draft.startTime, endTime: draft.endTime, color: draft.color,
            recurrence: draft.recurrence, isMultiDay: draft.isMultiDay, isAllDay: draft.isAllDay
        )
        try? await store.updateEvent(updated)
        sheet = nil
    }

    private func handleDelete(_ evt: ExpandedCalendarEvent) async {
        guard let source = store.originalEvent(for: evt) else { sheet = nil; return }
        try? await store.deleteEvent(source.id)
        sheet = nil
    }
}

#Preview {
    CalendarView()
}
