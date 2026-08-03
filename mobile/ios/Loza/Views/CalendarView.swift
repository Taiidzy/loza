//
//  CalendarView.swift
//  Loza
//
//  Vivid calendar with gradient month header, alive event rows.
//

import SwiftUI

struct CalendarView: View {
    @EnvironmentObject private var store: CalendarEventsStore
    @EnvironmentObject private var session: SessionStore

    @State private var selectedDate = Calendar.current.startOfDay(for: Date())
    @State private var showCreateSheet = false
    @State private var showDetailsSheet: CalendarEvent?

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                CalendarMonthGrid(
                    selectedDate: $selectedDate,
                    events: store.events
                )

                DayEventsPanel(
                    selectedDate: selectedDate,
                    events: store.events,
                    onCreate: { showCreateSheet = true },
                    onEventTap: { event in showDetailsSheet = event }
                )

                if !store.events.isEmpty {
                    AgendaPanel(
                        events: store.events,
                        onEventTap: { event in showDetailsSheet = event }
                    )
                }
            }
            .padding(.vertical, 12)
        }
        .navigationTitle("Календарь")
        .task { await store.reload() }
        .sheet(isPresented: $showCreateSheet) {
            NavigationStack {
                EventFormSheet(eventDate: selectedDate, onSubmit: { draft in
                    Task {
                        try? await store.createEvent(draft)
                    }
                    showCreateSheet = false
                }, onCancel: { showCreateSheet = false })
                .background(LozaBackgroundView())
            }
        }
        .sheet(item: $showDetailsSheet) { event in
            NavigationStack {
                EventDetailsSheet(
                    event: event,
                    onEdit: { showDetailsSheet = nil },
                    onDelete: { e in
                        Task {
                            try? await store.deleteEvent(e.id)
                        }
                        showDetailsSheet = nil
                    }
                )
                .background(LozaBackgroundView())
            }
        }
    }
}

#Preview {
    CalendarView()
        .environmentObject(CalendarEventsStore())
        .environmentObject(SessionStore.shared)
}
