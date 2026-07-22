//
//  CalendarService.swift
//  Loza
//
//  Mirrors app/src/api/calendarService.ts: the event color palette and
//  the CRUD calls, now hitting the real backend directly (through
//  LozaAPIClient) instead of going through a Tauri command layer.
//

import SwiftUI

enum CalendarPalette {
    /// Same 13 colors, same order, as EVENT_COLORS in calendarService.ts.
    static let colors: [Color] = [
        Color(hexString: "#ffb6d2"), // accent pink
        Color(hexString: "#b478ff"), // accent violet
        Color(hexString: "#3ecf6e"), // status green
        Color(hexString: "#ffbd2e"), // status amber
        Color(hexString: "#4fc3f7"), // status blue
        Color(hexString: "#ff5252"), // status red
        Color(hexString: "#26a69a"), // status teal
        Color(hexString: "#ff7043"), // status orange
        Color(hexString: "#9e9e9e"), // neutral gray
        Color(hexString: "#5c6bc0"), // status indigo
        Color(hexString: "#d4e157"), // status lime
        Color(hexString: "#26c6da"), // status cyan
        Color(hexString: "#8d6e63"), // status brown
    ]
}

enum CalendarService {
    private static func credentials() async throws -> (URL, String) {
        guard let baseURL = await ServerConfig.shared.baseURL else {
            throw AuthError.noServerConfigured
        }
        guard let token = await SessionStore.shared.session?.token else {
            throw AuthError.invalidCredentials
        }
        return (baseURL, token)
    }

    static func getEvents() async throws -> [CalendarEvent] {
        let (baseURL, token) = try await credentials()
        let dtos = try await LozaAPIClient.shared.getCalendarEvents(baseURL: baseURL, token: token)
        return dtos.map(CalendarMapper.map)
    }

    static func createEvent(_ draft: CalendarEventDraft) async throws -> CalendarEvent {
        let (baseURL, token) = try await credentials()
        let dto = try await LozaAPIClient.shared.createCalendarEvent(baseURL: baseURL, token: token, draft: CalendarMapper.draftDTO(from: draft))
        return CalendarMapper.map(dto)
    }

    static func updateEvent(_ event: CalendarEvent) async throws -> CalendarEvent {
        let (baseURL, token) = try await credentials()
        let dto = try await LozaAPIClient.shared.updateCalendarEvent(baseURL: baseURL, token: token, event: CalendarMapper.dto(from: event))
        return CalendarMapper.map(dto)
    }

    static func deleteEvent(_ id: String) async throws {
        let (baseURL, token) = try await credentials()
        try await LozaAPIClient.shared.deleteCalendarEvent(baseURL: baseURL, token: token, id: id)
    }
}
