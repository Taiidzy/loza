//
//  CalendarService.swift
//  Loza
//
//  Mirrors app/src/api/calendarService.ts: the event color palette and
//  the CRUD calls, now hitting the real backend directly (through
//  LozaAPIClient) instead of going through a Tauri command layer.
//
//  On iOS, calendar mutations prefer the live WebSocket (/ws/app) so the
//  server can broadcast create/update/delete pushes to sibling connections
//  (e.g. a desktop client of the same user). If the socket isn't connected
//  (backgrounded, not yet authenticated, etc.), we transparently fall back to
//  a plain HTTP round-trip — identical to how the Tauri client's ws_client.rs
//  falls back to direct HTTP when the socket is down.

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

    // ─── Event read ────────────────────────────────────────────────────────────

    static func getEvents() async throws -> [CalendarEvent] {
        // WS-first: calendar.get over /ws/app. Falls back to HTTP GET for a
        // quick initial load or when the socket is still connecting.
        if StatusSocket.shared.isConnected {
            do {
                let dtos = try await StatusSocket.shared.wsGetCalendarEvents()
                return dtos.map(CalendarMapper.map)
            } catch {
                // Fall through to HTTP if the WS request failed for any reason
                // (timeout, parse error, server reject). HTTP is the source of
                // truth and always returns the current state.
            }
        }
        let (baseURL, token) = try await credentials()
        let dtos = try await LozaAPIClient.shared.getCalendarEvents(baseURL: baseURL, token: token)
        return dtos.map(CalendarMapper.map)
    }

    // ─── Event write ───────────────────────────────────────────────────────────

    static func createEvent(_ draft: CalendarEventDraft) async throws -> CalendarEvent {
        let dto = CalendarMapper.draftDTO(from: draft)
        if StatusSocket.shared.isConnected {
            do {
                let created = try await StatusSocket.shared.wsCreateCalendarEvent(draft: dto)
                return CalendarMapper.map(created)
            } catch {
                // Fall back to HTTP.
            }
        }
        let (baseURL, token) = try await credentials()
        let created = try await LozaAPIClient.shared.createCalendarEvent(baseURL: baseURL, token: token, draft: dto)
        return CalendarMapper.map(created)
    }

    static func updateEvent(_ event: CalendarEvent) async throws -> CalendarEvent {
        let dto = CalendarMapper.dto(from: event)
        if StatusSocket.shared.isConnected {
            do {
                let updated = try await StatusSocket.shared.wsUpdateCalendarEvent(event: dto)
                return CalendarMapper.map(updated)
            } catch {
                // Fall back to HTTP.
            }
        }
        let (baseURL, token) = try await credentials()
        let updated = try await LozaAPIClient.shared.updateCalendarEvent(baseURL: baseURL, token: token, event: dto)
        return CalendarMapper.map(updated)
    }

    static func deleteEvent(_ id: String) async throws {
        if StatusSocket.shared.isConnected {
            do {
                try await StatusSocket.shared.wsDeleteCalendarEvent(id: id)
                return
            } catch {
                // Fall back to HTTP.
            }
        }
        let (baseURL, token) = try await credentials()
        try await LozaAPIClient.shared.deleteCalendarEvent(baseURL: baseURL, token: token, id: id)
    }
}
