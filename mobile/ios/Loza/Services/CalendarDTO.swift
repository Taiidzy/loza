//
//  CalendarDTO.swift
//  Loza
//
//  Wire types mirroring backend/src/models/event.rs field-for-field.
//  `Recurrence` is serialized lowercase by serde(rename_all = "lowercase"),
//  matched here by RecurrenceDTO's raw values.
//

import Foundation

enum RecurrenceDTO: String, Codable, CaseIterable {
    case none, daily, weekly, monthly, yearly
}

/// Mirrors CalendarEvent (has `id`). Used for GET responses and as the
/// PUT body (server-side `update_event` takes the full event back).
struct CalendarEventDTO: Codable, Identifiable, Equatable {
    let id: String
    var title: String
    var startDate: String   // "YYYY-MM-DD"
    var endDate: String     // "YYYY-MM-DD"
    var startTime: String?  // "HH:mm" or nil
    var endTime: String?    // "HH:mm" or nil
    var color: String       // "#rrggbb"
    var recurrence: RecurrenceDTO
    var isMultiDay: Bool
    var isAllDay: Bool
}

/// Mirrors CalendarEventDraft (no `id` — server assigns one on create).
struct CalendarEventDraftDTO: Codable {
    var title: String
    var startDate: String
    var endDate: String
    var startTime: String?
    var endTime: String?
    var color: String
    var recurrence: RecurrenceDTO
    var isMultiDay: Bool
    var isAllDay: Bool
}
