//
//  CalendarEventsStore.swift
//  Loza
//
//  SwiftUI equivalent of shared/hooks/useCalendarEvents.ts: owns the raw
//  event list + CRUD, expands recurring events into concrete occurrences
//  within the visible range (plus a month of padding either side, same as
//  the TS version), and indexes occurrences by day for O(1) day lookups.
//

import SwiftUI
import Combine

@MainActor
final class CalendarEventsStore: ObservableObject, CalendarEventPushObserver {
    @Published private(set) var events: [CalendarEvent] = []
    @Published private(set) var isLoading = true
    @Published var error: String?

    /// day (DateKey) -> occurrences of that day, split single/multi-day —
    /// mirrors eventsByDay in the TS hook.
    @Published private(set) var eventsByDay: [DateKey: (singleDay: [ExpandedCalendarEvent], multiDay: [ExpandedCalendarEvent])] = [:]
    /// event.id -> vertical slot index, for stacking multi-day lines in the grid.
    @Published private(set) var eventSlots: [String: Int] = [:]
    @Published private(set) var upcoming: [ExpandedCalendarEvent] = []

    private var visibleRangeStart: Date = Date()
    private var visibleRangeEnd: Date = Date()

    init() {
        // Subscribe to calendar push notifications from sibling client
        // connections (e.g. a desktop browser creating an event while the
        // phone's CalendarView is open). The originating connection receives
        // its own echo push, so every handler below is idempotent.
        StatusSocket.shared.addCalendarObserver(self)
    }

    func reload() async {
        isLoading = true
        do {
            events = try await CalendarService.getEvents()
            error = nil
        } catch {
            self.error = AuthError.from(error).errorDescription
        }
        isLoading = false
        recompute()
    }

    /// Call whenever the visible month range changes (e.g. user navigates
    /// months) — recomputes recurrence expansion for the new window.
    func setVisibleRange(start: Date, end: Date) {
        visibleRangeStart = start
        visibleRangeEnd = end
        recompute()
    }

    @discardableResult
    func createEvent(_ draft: CalendarEventDraft) async throws -> CalendarEvent {
        let created = try await CalendarService.createEvent(draft)
        events.append(created)
        recompute()
        return created
    }

    @discardableResult
    func updateEvent(_ event: CalendarEvent) async throws -> CalendarEvent {
        let updated = try await CalendarService.updateEvent(event)
        if let idx = events.firstIndex(where: { $0.id == updated.id }) {
            events[idx] = updated
        }
        recompute()
        return updated
    }

    func deleteEvent(_ id: String) async throws {
        try await CalendarService.deleteEvent(id)
        events.removeAll { $0.id == id }
        recompute()
    }

    // ─── CalendarEventPushObserver ─────────────────────────────────────────────
    // Reconciles local state with mutations from sibling connections. All
    // handlers are idempotent: the originating connection also receives its
    // own echo push (the server broadcasts to all of a user's sockets), so
    // a create whose event.id already exists is skipped, etc.

    func calendarEventCreated(_ event: CalendarEventDTO) {
        // The originating connection already appended the result locally in
        // createEvent; skip the echo to avoid duplicates.
        guard !events.contains(where: { $0.id == event.id }) else { return }
        events.append(CalendarMapper.map(event))
        recompute()
    }

    func calendarEventUpdated(_ event: CalendarEventDTO) {
        // Upsert: replace if present (the originating conn. did this from the
        // WS response), no-op insert otherwise (sibling update).
        let mapped = CalendarMapper.map(event)
        if let idx = events.firstIndex(where: { $0.id == event.id }) {
            events[idx] = mapped
        } else {
            events.append(mapped)
        }
        recompute()
    }

    func calendarEventDeleted(id: String) {
        events.removeAll { $0.id == id }
        recompute()
    }

    func getEventsForDay(_ date: Date) -> (singleDay: [ExpandedCalendarEvent], multiDay: [ExpandedCalendarEvent]) {
        eventsByDay[DateKeyFormat.string(from: date)] ?? (singleDay: [], multiDay: [])
    }

    func originalEvent(for expanded: ExpandedCalendarEvent) -> CalendarEvent? {
        events.first { $0.id == expanded.sourceId }
    }

    // ─── Recurrence expansion + indexing, mirrors the two useMemo blocks ───

    private func recompute() {
        let cal = Calendar.current
        let windowStart = cal.date(byAdding: .month, value: -1, to: visibleRangeStart) ?? visibleRangeStart
        let windowEnd = cal.date(byAdding: .month, value: 1, to: visibleRangeEnd) ?? visibleRangeEnd

        var expanded: [ExpandedCalendarEvent] = []

        for evt in events {
            if evt.recurrence == .none {
                expanded.append(ExpandedCalendarEvent(
                    id: evt.id, sourceId: evt.id, title: evt.title,
                    startDate: evt.startDate, endDate: evt.endDate,
                    startTime: evt.startTime, endTime: evt.endTime, color: evt.color,
                    recurrence: evt.recurrence, isMultiDay: evt.isMultiDay, isAllDay: evt.isAllDay
                ))
                continue
            }

            var currStart = DateKeyFormat.date(from: evt.startDate)
            let endDate = DateKeyFormat.date(from: evt.endDate)
            let dayOffset = cal.dateComponents([.day], from: cal.startOfDay(for: currStart), to: cal.startOfDay(for: endDate)).day ?? 0

            var iterations = 0
            while currStart < windowEnd, iterations < 2000 {
                iterations += 1
                if currStart > windowStart {
                    let occStart = currStart
                    let occEnd = cal.date(byAdding: .day, value: dayOffset, to: currStart) ?? currStart
                    let key = "\(evt.id)-\(Int(currStart.timeIntervalSince1970 * 1000))"
                    expanded.append(ExpandedCalendarEvent(
                        id: key, sourceId: evt.id, title: evt.title,
                        startDate: DateKeyFormat.string(from: occStart),
                        endDate: DateKeyFormat.string(from: occEnd),
                        startTime: evt.startTime, endTime: evt.endTime, color: evt.color,
                        recurrence: evt.recurrence, isMultiDay: evt.isMultiDay, isAllDay: evt.isAllDay
                    ))
                }
                switch evt.recurrence {
                case .daily: currStart = cal.date(byAdding: .day, value: 1, to: currStart) ?? currStart
                case .weekly: currStart = cal.date(byAdding: .day, value: 7, to: currStart) ?? currStart
                case .monthly: currStart = cal.date(byAdding: .month, value: 1, to: currStart) ?? currStart
                case .yearly: currStart = cal.date(byAdding: .year, value: 1, to: currStart) ?? currStart
                case .none: break
                }
            }
        }

        // ─── Slot assignment for multi-day lines ───
        let multiDay = expanded
            .filter(\.isMultiDay)
            .sorted { EventTime.start(date: $0.startDate, time: $0.startTime) < EventTime.start(date: $1.startDate, time: $1.startTime) }

        var slots: [String: Int] = [:]
        var assignedRanges: [(start: TimeInterval, end: TimeInterval, slot: Int)] = []
        for evt in multiDay {
            let s = cal.startOfDay(for: DateKeyFormat.date(from: evt.startDate)).timeIntervalSince1970
            let e = EventTime.end(date: evt.endDate, time: nil).timeIntervalSince1970
            var slot = 0
            while assignedRanges.contains(where: { $0.slot == slot && max(s, $0.start) <= min(e, $0.end) }) {
                slot += 1
            }
            slots[evt.id] = slot
            assignedRanges.append((s, e, slot))
        }

        // ─── Day index ───
        var byDay: [DateKey: (singleDay: [ExpandedCalendarEvent], multiDay: [ExpandedCalendarEvent])] = [:]
        for evt in expanded {
            var cursor = cal.startOfDay(for: DateKeyFormat.date(from: evt.startDate))
            let end = cal.startOfDay(for: DateKeyFormat.date(from: evt.endDate))
            var guard_ = 0
            while cursor <= end, guard_ < 400 {
                guard_ += 1
                let key = DateKeyFormat.string(from: cursor)
                var bucket = byDay[key] ?? ([], [])
                if evt.isMultiDay { bucket.multiDay.append(evt) } else { bucket.singleDay.append(evt) }
                byDay[key] = bucket
                cursor = cal.date(byAdding: .day, value: 1, to: cursor) ?? end.addingTimeInterval(1)
            }
        }

        self.eventsByDay = byDay
        self.eventSlots = slots

        // ─── Upcoming (agenda) ───
        let now = Date()
        self.upcoming = expanded
            .filter { EventTime.end(date: $0.endDate, time: $0.isAllDay ? nil : $0.endTime) > now }
            .sorted { EventTime.start(date: $0.startDate, time: $0.startTime) < EventTime.start(date: $1.startDate, time: $1.startTime) }
    }
}
