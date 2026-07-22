//
//  Calendar.swift
//  Loza
//
//  Mirrors app/src/types/calendar.ts. View-facing types (Color instead of
//  hex string) — CalendarMapper converts to/from the wire DTOs in
//  Services/CalendarDTO.swift.
//

import SwiftUI

enum Recurrence: String, CaseIterable, Equatable {
    case none, daily, weekly, monthly, yearly

    var label: String {
        switch self {
        case .none: return "Один раз"
        case .daily: return "Каждый день"
        case .weekly: return "Раз в неделю"
        case .monthly: return "Раз в месяц"
        case .yearly: return "Раз в год"
        }
    }

    /// Longer form used in EventDetailsView, mirrors RECURRENCE_LABELS
    /// in EventDetailsModal.tsx.
    var detailLabel: String {
        switch self {
        case .none: return "Не повторяется"
        case .daily: return "Повторяется каждый день"
        case .weekly: return "Повторяется раз в неделю"
        case .monthly: return "Повторяется раз в месяц"
        case .yearly: return "Повторяется раз в год"
        }
    }

    fileprivate var dto: RecurrenceDTO {
        switch self {
        case .none: return .none
        case .daily: return .daily
        case .weekly: return .weekly
        case .monthly: return .monthly
        case .yearly: return .yearly
        }
    }

    fileprivate init(dto: RecurrenceDTO) {
        switch dto {
        case .none: self = .none
        case .daily: self = .daily
        case .weekly: self = .weekly
        case .monthly: self = .monthly
        case .yearly: self = .yearly
        }
    }
}

/// "YYYY-MM-DD", matches the backend's date-only string format so encoding
/// stays trivial (no timezone ambiguity from Date <-> ISO date conversion).
typealias DateKey = String

enum DateKeyFormat {
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func string(from date: Date) -> DateKey { formatter.string(from: date) }

    static func date(from key: DateKey) -> Date {
        formatter.date(from: key) ?? Date()
    }
}

struct CalendarEvent: Identifiable, Equatable {
    var id: String
    var title: String
    var startDate: DateKey
    var endDate: DateKey
    var startTime: String?
    var endTime: String?
    var color: Color
    var recurrence: Recurrence
    var isMultiDay: Bool
    var isAllDay: Bool
}

struct CalendarEventDraft: Equatable {
    var title: String
    var startDate: DateKey
    var endDate: DateKey
    var startTime: String?
    var endTime: String?
    var color: Color
    var recurrence: Recurrence
    var isMultiDay: Bool
    var isAllDay: Bool
}

/// A materialized occurrence of a (possibly recurring) event, mirrors
/// ExpandedCalendarEvent in types/calendar.ts.
struct ExpandedCalendarEvent: Identifiable, Equatable {
    var id: String
    var sourceId: String
    var title: String
    var startDate: DateKey
    var endDate: DateKey
    var startTime: String?
    var endTime: String?
    var color: Color
    var recurrence: Recurrence
    var isMultiDay: Bool
    var isAllDay: Bool
}

// ─── Time helpers, mirrors shared/utils/calendarDateUtils.ts ───────────────

enum EventTime {
    static func start(date: DateKey, time: String?) -> Date {
        let base = Calendar.current.startOfDay(for: DateKeyFormat.date(from: date))
        guard let time, let (h, m) = parseHM(time) else { return base }
        return Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: base) ?? base
    }

    static func end(date: DateKey, time: String?) -> Date {
        let base = DateKeyFormat.date(from: date)
        guard let time, let (h, m) = parseHM(time) else {
            // endOf('day') equivalent
            let startOfNext = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: base)) ?? base
            return Calendar.current.date(byAdding: .second, value: -1, to: startOfNext) ?? base
        }
        return Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: base) ?? base
    }

    private static func parseHM(_ s: String) -> (Int, Int)? {
        let parts = s.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return (h, m)
    }

    /// Short time label for UI: "весь день" or "9:00–18:00", mirrors eventTimeLabel().
    static func label(isAllDay: Bool, startTime: String?, endTime: String?) -> String {
        if isAllDay || startTime == nil { return "Весь день" }
        if let endTime { return "\(startTime!)–\(endTime)" }
        return startTime!
    }
}

// ─── DTO <-> domain mapping ──────────────────────────────────────────────────

enum CalendarMapper {
    static func map(_ dto: CalendarEventDTO) -> CalendarEvent {
        CalendarEvent(
            id: dto.id, title: dto.title, startDate: dto.startDate, endDate: dto.endDate,
            startTime: dto.startTime, endTime: dto.endTime, color: Color(hexString: dto.color),
            recurrence: Recurrence(dto: dto.recurrence), isMultiDay: dto.isMultiDay, isAllDay: dto.isAllDay
        )
    }

    static func dto(from event: CalendarEvent) -> CalendarEventDTO {
        CalendarEventDTO(
            id: event.id, title: event.title, startDate: event.startDate, endDate: event.endDate,
            startTime: event.startTime, endTime: event.endTime, color: event.color.hexString,
            recurrence: event.recurrence.dto, isMultiDay: event.isMultiDay, isAllDay: event.isAllDay
        )
    }

    static func draftDTO(from draft: CalendarEventDraft) -> CalendarEventDraftDTO {
        CalendarEventDraftDTO(
            title: draft.title, startDate: draft.startDate, endDate: draft.endDate,
            startTime: draft.startTime, endTime: draft.endTime, color: draft.color.hexString,
            recurrence: draft.recurrence.dto, isMultiDay: draft.isMultiDay, isAllDay: draft.isAllDay
        )
    }
}

extension Color {
    /// Best-effort "#rrggbb" serialization for sending event colors back to
    /// the server. Falls back to the first event palette color if the
    /// component resolution fails (shouldn't happen for the fixed palette
    /// this app offers, see CalendarPalette.colors).
    var hexString: String {
        #if canImport(UIKit)
        let ui = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard ui.getRed(&r, green: &g, blue: &b, alpha: &a) else { return "#ffb6d2" }
        return String(format: "#%02x%02x%02x", Int(r * 255), Int(g * 255), Int(b * 255))
        #else
        return "#ffb6d2"
        #endif
    }
}
