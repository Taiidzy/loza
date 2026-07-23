//
//  StatusSocket.swift
//  Loza
//
//  Native equivalent of app/src-tauri/src/status.rs::spawn_status_listener.
//  On desktop, Rust holds the WS connection to /ws/status and proxies each
//  message to React as a "server-status" event — React never touches the
//  socket directly. On mobile there's no separate native process to hide
//  the socket behind, so this ObservableObject plays that role instead:
//  it's the only thing that opens the WS connection, and views just
//  observe `status`.
//
//  Protocol mirrors backend/src/handlers/status.rs::handle_ws_status
//  exactly: server ticks immediately on connect, then every ~2s, sending
//  a full ServerStatus JSON payload each time; on disconnect, this client
//  reconnects after a 3s delay, same backoff as the Tauri listener.
//
//  Scheme handling: the server URL the user enters is http(s) (see
//  ServerConfig), but a WS connection needs ws/wss. ServerConfig.webSocketURL
//  does that mapping — http -> ws, https -> wss — so this file never has
//  to think about schemes itself.
//

import Foundation
import Combine

@MainActor
final class StatusSocket: ObservableObject {
    @Published private(set) var status: ServerStatus?
    @Published private(set) var connectionError: String?
    @Published private(set) var isConnected = false

    private var task: URLSessionWebSocketTask?
    private var listenTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var shouldRun = false

    private let decoder = JSONDecoder()

    /// Starts (or restarts) the connection loop. Safe to call repeatedly —
    /// e.g. from a view's .task, or after the server URL changes.
    func start() {
        guard !shouldRun else { return }
        shouldRun = true
        connectLoop()
    }

    func stop() {
        shouldRun = false
        reconnectTask?.cancel()
        listenTask?.cancel()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        isConnected = false
    }

    // ─── Connection loop, mirrors run_status_stream's outer `loop` ─────────

    private func connectLoop() {
        listenTask?.cancel()
        listenTask = Task { [weak self] in
            await self?.runOnce()
            guard let self, self.shouldRun else { return }
            self.isConnected = false
            // 3s backoff before retrying, same as spawn_status_listener.
            self.reconnectTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard let self, self.shouldRun else { return }
                self.connectLoop()
            }
        }
    }

    private func runOnce() async {
        guard let baseURL = await ServerConfig.shared.baseURL,
              let token = await SessionStore.shared.session?.token,
              let wsURL = ServerConfig.webSocketURL(base: baseURL, path: "/ws/status") else {
            connectionError = "Требуется авторизация"
            return
        }

        let session = URLSession(configuration: .default)
        var request = URLRequest(url: wsURL)
        request.setValue(token, forHTTPHeaderField: "x-session-token")
        let socket = session.webSocketTask(with: request)
        task = socket
        socket.resume()
        isConnected = true
        connectionError = nil

        while shouldRun {
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
                connectionError = "Сервер недоступен"
                break
            }
        }

        socket.cancel(with: .goingAway, reason: nil)
        isConnected = false
    }

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let dto = try? decoder.decode(ServerStatusDTO.self, from: data) else {
            return
        }
        status = StatusMapper.map(dto)
        connectionError = nil
    }
}
