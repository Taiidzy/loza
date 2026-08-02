//
//  StatusSocket.swift
//  Loza
//
//  Unified WebSocket client for iOS. Mirrors the Tauri desktop app's
//  ws_client.rs: connects to /ws/app (single connection for both
//  request-response and server-initiated push), replacing the old
//  /ws/status-only listener.
//
//  Responsibilities:
//  - Live status updates (status.update push, ~2s cadence, same as desktop)
//  - Calendar CRUD request-response (calendar.get/create/update/delete)
//  - Calendar broadcast push (calendar.event.created/updated/deleted) so
//    DashboardView and CalendarView stay in sync across client connections.
//
//  Auth: x-session-token header on the WS handshake, same as /ws/status and
//  all HTTP endpoints.
//
//  Reconnection: 3s backoff on disconnect, matching the desktop client.
//
//  Wire protocol (backend/src/handlers/ws.rs):
//    Request:   {"id":"<uuid>","method":"calendar.get","params":{}}
//    Response:  {"id":"<uuid>","result":{...}} | {"id":"<uuid>","error":{...}}
//    Push:      {"type":"push","method":"status.update","params":{...}}
//               {"type":"push","method":"calendar.event.created","params":{...}}

import Combine
import Foundation
import OSLog

/// Observes calendar event push notifications from sibling connections.
/// The originating connection of a mutation also receives its own echo push,
/// so all observer handlers are idempotent (id-based dedup/upsert/remove).
protocol CalendarEventPushObserver: AnyObject {
    func calendarEventCreated(_ event: CalendarEventDTO)
    func calendarEventUpdated(_ event: CalendarEventDTO)
    func calendarEventDeleted(id: String)
}

/// Stored while a request awaits its response. The `Data?` is the raw
/// `result` JSON (or `nil` for JSON `null`), re-decoded by the caller.
/// Keeping the continuation inside a closure prevents
/// `CheckedContinuation` from escaping its creating `async` scope.
private struct PendingRequest {
    let resolve: (Result<Data?, Error>) -> Void
}

/// 10s request timeout, matches ws_client.rs's REQUEST_TIMEOUT_SECS.
private let REQUEST_TIMEOUT_NANOS: UInt64 = 10 * 1_000_000_000

@MainActor
final class StatusSocket: ObservableObject {
    static let shared = StatusSocket()

    @Published private(set) var status: ServerStatus?
    @Published private(set) var connectionError: String?
    @Published private(set) var isConnected = false

    private var urlSession: URLSession
    private var socket: URLSessionWebSocketTask?
    private var listenTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var shouldRun = false

    private let decoder = JSONDecoder()
    private var pendingRequests: [String: PendingRequest] = [:]

    private var calendarObservers: [CalendarObserverRef] = []

    private let logger = Logger(subsystem: "Loza", category: "websocket")

    init() {
        // Long-lived session; the receive loop is driven by repeated
        // socket.receive() calls in runOnce.
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        urlSession = URLSession(configuration: config)
    }

    // MARK: - Calendar push observers

    func addCalendarObserver(_ observer: CalendarEventPushObserver) {
        calendarObservers.append(CalendarObserverRef(observer))
        calendarObservers.removeAll { $0.observer == nil }
    }

    // MARK: - Lifecycle

    func start() {
        guard !shouldRun else { return }
        shouldRun = true
        connectLoop()
    }

    func stop() {
        shouldRun = false
        reconnectTask?.cancel()
        listenTask?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        isConnected = false
        for (_, req) in pendingRequests {
            req.resolve(.failure(APIError.transport(
                NSError(domain: "WS", code: 0, userInfo: [NSLocalizedDescriptionKey: "WebSocket disconnected"])
            )))
        }
        pendingRequests.removeAll()
    }

    // MARK: - Request-response (mirrors ws_client.rs run_ws_session)

    /// Sends a method request over /ws/app, returns the raw `result` JSON
    /// data (`nil` when the server returns JSON `null`, e.g. calendar.delete),
    /// and throws on WS errors or server-side `error` envelopes.
    func sendRequestRaw(
        method: String,
        paramsData: Data? = nil
    ) async throws -> Data? {
        let resolvedParams: Data
        if let paramsData {
            resolvedParams = paramsData
        } else {
            resolvedParams = try JSONEncoder().encode(EmptyParams())
        }

        let id = UUID().uuidString
        let paramsJSON = try JSONSerialization.jsonObject(with: resolvedParams)
        let requestJSON: [String: Any] = [
            "id": id,
            "method": method,
            "params": paramsJSON,
        ]
        guard let raw = try? JSONSerialization.data(withJSONObject: requestJSON),
              let requestText = String(data: raw, encoding: .utf8) else {
            throw APIError.invalidResponse
        }

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data?, Error>) -> Void in
            pendingRequests[id] = PendingRequest { result in
                continuation.resume(with: result)
            }
            // Can't await inside this sync closure, so dispatch the send on a
            // task. dispatchRequest is @MainActor-isolated (same as this
            // class), so it accesses pendingRequests safely on the main actor
            // while this continuation stays suspended.
            Task { [weak self] in
                await self?.dispatchRequest(id: id, text: requestText)
            }
            // 10s timeout guard: if no response arrives (and the send didn't
            // already fail), resolve with a timeout error. The removeValue
            // is atomic on the main actor — whichever resolves first
            // (response/error/timeout) wins; the others find nil and no-op.
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: REQUEST_TIMEOUT_NANOS)
                await self?.expireRequest(id: id)
            }
        }
    }

    /// Sends a single WS text message on the main actor. On failure this
    /// resolves the pending request's continuation with a transport error
    /// (so the caller's `sendRequestRaw` doesn't hang forever).
    private func dispatchRequest(id: String, text: String) async {
        do {
            try await sendText(text)
        } catch {
            pendingRequests[id]?.resolve(.failure(APIError.transport(error)))
            pendingRequests.removeValue(forKey: id)
        }
    }

    /// Resolves a timed-out pending request with a timeout error (no-op if
    /// the response/error already arrived, since removeValue is idempotent).
    /// Runs on the main actor via an explicit await hop from the timeout Task.
    private func expireRequest(id: String) {
        if let req = pendingRequests.removeValue(forKey: id) {
            req.resolve(.failure(APIError.server(code: "TIMEOUT", message: "Request timed out after 10s")))
        }
    }

    /// Typed wrapper: decodes the `result` as `T` (inferred from call site).
    /// Use sendRequestRaw for methods whose result is JSON null.
    func sendRequest<T: Decodable>(
        method: String,
        paramsData: Data? = nil
    ) async throws -> T {
        let data = try await sendRequestRaw(method: method, paramsData: paramsData)
        guard let data else { throw APIError.invalidResponse }
        return try decoder.decode(T.self, from: data)
    }

    // MARK: - WebSocket send

    private func sendText(_ text: String) async throws {
        guard let socket, socket.state == .running else {
            throw APIError.transport(NSError(domain: "WS", code: 0, userInfo: [NSLocalizedDescriptionKey: "Socket not connected"]))
        }
        try await socket.send(.string(text))
    }

    // MARK: - Connection loop (3s backoff, matches desktop)

    private func connectLoop() {
        listenTask?.cancel()
        listenTask = Task { [weak self] in
            await self?.runOnce()
            await self?.scheduleReconnect()
        }
    }

    /// Called after runOnce returns (disconnected); schedules a 3s backoff
    /// reconnect if the socket should still be running.
    private func scheduleReconnect() {
        guard shouldRun else { return }
        isConnected = false
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            await self?.retryConnect()
        }
    }

    /// 3s backoff elapsed — re-enter connectLoop if still active.
    private func retryConnect() {
        guard shouldRun else { return }
        connectLoop()
    }

    private func runOnce() async {
        guard let baseURL = await ServerConfig.shared.baseURL,
              let token = await SessionStore.shared.session?.token,
              let wsURL = ServerConfig.webSocketURL(base: baseURL, path: "/ws/app") else {
            connectionError = "Требуется авторизация"
            return
        }

        var request = URLRequest(url: wsURL)
        request.setValue(token, forHTTPHeaderField: "x-session-token")

        let socket = urlSession.webSocketTask(with: request)
        self.socket = socket
        socket.resume()
        isConnected = true
        connectionError = nil
        logger.info("WS /ws/app connected")

        while shouldRun, socket.state == .running {
            do {
                let message = try await socket.receive()
                switch message {
                case .string(let text):
                    handle(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        handle(text)
                    }
                @unknown default:
                    break
                }
            } catch {
                connectionError = "Соединение разорвано"
                logger.warning("WS receive error: \(error.localizedDescription, privacy: .public)")
                break
            }
        }

        socket.cancel(with: .goingAway, reason: nil)
        isConnected = false
        logger.info("WS /ws/app disconnected")
    }

    // MARK: - Message demux (response vs push)

    private func handle(_ text: String) {
        guard let json = try? JSONSerialization.jsonObject(with: text.data(using: .utf8)!) as? [String: Any] else {
            logger.warning("WS unparseable message: \(text, privacy: .public)")
            return
        }

        if let id = json["id"] as? String {
            handleResponse(id: id, json: json)
        } else if (json["type"] as? String) == "push" {
            handlePush(json: json)
        }
    }

    // MARK: - Response dispatch

    private func handleResponse(id: String, json: [String: Any]) {
        guard let req = pendingRequests.removeValue(forKey: id) else { return }

        if let errDict = json["error"] as? [String: Any],
           let code = errDict["code"] as? String,
           let message = errDict["message"] as? String {
            req.resolve(.failure(APIError.server(code: code, message: message)))
            return
        }

        if let result = json["result"] {
            if result is NSNull {
                req.resolve(.success(nil))  // JSON null → discard (e.g. calendar.delete)
            } else {
                let data = try? JSONSerialization.data(withJSONObject: result)
                req.resolve(.success(data))
            }
        } else {
            // Missing "result" key — shouldn't happen per protocol.
            req.resolve(.failure(APIError.invalidResponse))
        }
    }

    // MARK: - Push dispatch

    private func handlePush(json: [String: Any]) {
        calendarObservers.removeAll { $0.observer == nil }
        guard let method = json["method"] as? String,
              let params = json["params"], !(params is NSNull) else { return }

        let paramsData = try? JSONSerialization.data(withJSONObject: params as Any)
        switch method {
        case "status.update":
            if let data = paramsData,
               let dto = try? decoder.decode(ServerStatusDTO.self, from: data) {
                status = StatusMapper.map(dto)
                connectionError = nil
            }
        case "calendar.event.created", "calendar.event.updated":
            if let data = paramsData,
               let dto = try? decoder.decode(CalendarEventDTO.self, from: data) {
                for obs in calendarObservers.compactMap({ $0.observer }) {
                    if method == "calendar.event.created" {
                        obs.calendarEventCreated(dto)
                    } else {
                        obs.calendarEventUpdated(dto)
                    }
                }
            }
        case "calendar.event.deleted":
            if let data = paramsData,
               let dto = try? decoder.decode(DeleteParamsDTO.self, from: data) {
                for obs in calendarObservers.compactMap({ $0.observer }) {
                    obs.calendarEventDeleted(id: dto.id)
                }
            }
        default:
            logger.debug("WS unknown push method: \(method, privacy: .public)")
        }
    }

    // MARK: - Typed calendar request helpers

    /// calendar.get over WS → [CalendarEventDTO].
    func wsGetCalendarEvents() async throws -> [CalendarEventDTO] {
        try await sendRequest(method: "calendar.get")
    }

    /// calendar.create over WS → CalendarEventDTO.
    func wsCreateCalendarEvent(draft: CalendarEventDraftDTO) async throws -> CalendarEventDTO {
        try await sendRequest(method: "calendar.create", paramsData: JSONEncoder().encode(draft))
    }

    /// calendar.update over WS → CalendarEventDTO.
    func wsUpdateCalendarEvent(event: CalendarEventDTO) async throws -> CalendarEventDTO {
        try await sendRequest(method: "calendar.update", paramsData: JSONEncoder().encode(event))
    }

    /// calendar.delete over WS (returns null, so we use sendRequestRaw).
    func wsDeleteCalendarEvent(id: String) async throws {
        struct DeleteReq: Encodable { let id: String }
        _ = try await sendRequestRaw(method: "calendar.delete", paramsData: JSONEncoder().encode(DeleteReq(id: id)))
    }
}

// ─── Wire DTOs ────────────────────────────────────────────────────────────────

struct EmptyParams: Encodable {}

/// Only the `id` field is needed for delete push notifications.
private struct DeleteParamsDTO: Decodable {
    let id: String
}

// ─── Weak wrapper (prevents retain cycles for observers) ──────────────────────

private final class CalendarObserverRef {
    private weak var _observer: AnyObject?
    init(_ observer: CalendarEventPushObserver) { _observer = observer }
    var observer: (any CalendarEventPushObserver)? { _observer as? any CalendarEventPushObserver }
}
