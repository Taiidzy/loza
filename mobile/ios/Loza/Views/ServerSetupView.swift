//
//  ServerSetupView.swift
//  Loza
//
//  Vivid server address screen with gradient blob, alive button states.
//

import SwiftUI

enum SetupState {
    case idle, checking, verified, error
}

struct ServerSetupView: View {
    @EnvironmentObject private var serverConfig: ServerConfig
    var onSuccess: () -> Void

    @State private var hostInput = ""
    @State private var setupState: SetupState = .idle
    @State private var errorMsg = ""
    @FocusState private var focusedHost: Bool

    private let httpsURL = "https://"
    private let httpURL = "http://"
    private var trimmedHost: String {
        let s = hostInput.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix(httpsURL) { return String(s.dropFirst(httpsURL.count).trimmingCharacters(in: .whitespacesAndNewlines)) }
        if s.hasPrefix(httpURL) { return String(s.dropFirst(httpURL.count).trimmingCharacters(in: .whitespacesAndNewlines)) }
        return s
    }

    var body: some View {
        ZStack {
            LozaBackgroundView()
            ParticlesView().ignoresSafeArea()

            Circle()
                .fill(RadialGradient(colors: [LozaColor.accentPurple.opacity(0.2), .clear], center: .center, startRadius: 0, endRadius: 180))
                .frame(width: 360, height: 360)
                .blur(radius: 50)
                .offset(x: 100, y: -200)
                .allowsHitTesting(false)

            Circle()
                .fill(RadialGradient(colors: [LozaColor.accentPink.opacity(0.15), .clear], center: .center, startRadius: 0, endRadius: 150))
                .frame(width: 300, height: 300)
                .blur(radius: 50)
                .offset(x: -80, y: 200)
                .allowsHitTesting(false)

            VStack(spacing: 14) {
                setupCard
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: 368)
        }
        .preferredColorScheme(.dark)
    }

    private var setupCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Loza")
                    .font(LozaType.largeTitle)
                    .foregroundStyle(.white.opacity(0.92))
                Text("Адрес сервера")
                    .font(LozaType.caption)
                    .foregroundStyle(.white.opacity(0.32))
                    .tracking(0.4)
            }
            .padding(.bottom, 28)

            hostField

            if setupState == .error, !errorMsg.isEmpty {
                Text(errorMsg)
                    .font(LozaType.caption)
                    .foregroundStyle(Color(hex: 0xFF7878, alpha: 0.85))
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            checkButton
                .padding(.top, 16)
        }
        .padding(.horizontal, 22)
        .padding(.top, 26)
        .padding(.bottom, 22)
        .glassEffect(.regular, in: .rect(cornerRadius: LozaMetrics.sheetRadius))
        .overlay(
            RoundedRectangle(cornerRadius: LozaMetrics.sheetRadius)
                .stroke(
                    LinearGradient(
                        colors: [LozaColor.accentBlue.opacity(0.25), LozaColor.accentPurple.opacity(0.15), LozaColor.accentPink.opacity(0.1)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
    }

    private var hostField: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("ХОСТ")
                .font(LozaType.fieldLabel)
                .tracking(1.2)
                .foregroundStyle(.white.opacity(0.16))

            HStack {
                TextField("", text: $hostInput, prompt: Text("example.com:8787").foregroundStyle(.white.opacity(0.2)))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(LozaType.fieldInput)
                    .foregroundStyle(.white.opacity(0.88))
                    .focused($focusedHost)
                    .submitLabel(.go)
                    .onSubmit { startCheck() }

                Button {
                    hostInput = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(.white.opacity(0.16))
                        .opacity(hostInput.trimmingCharacters(in: .whitespaces).isEmpty ? 0 : 0.5)
                }
                .disabled(hostInput.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 9)
        .padding(.bottom, 8)
        .background {
            if #available(iOS 26.0, *) {
                Capsule().fill(Color.clear).glassEffect(.regular)
            } else {
                Capsule().fill(Color.white.opacity(0.04))
            }
        }
        .overlay(
            Capsule().stroke(focusedHost ? LozaColor.accentBlue.opacity(0.5) : Color.white.opacity(0.09), lineWidth: 1)
        )
        .shadow(color: focusedHost ? LozaColor.accentBlue.opacity(0.12) : .clear, radius: 6)
        .animation(.easeOut(duration: 0.2), value: focusedHost)
    }

    private var checkButton: some View {
        Button(action: startCheck) {
            HStack(spacing: 8) {
                switch setupState {
                case .verified:
                    Image(systemName: "checkmark.shield.fill")
                    Text("Сервер найден")
                case .checking:
                    ProgressView().controlSize(.small).tint(.white.opacity(0.78))
                    Text("Проверка").foregroundStyle(.white.opacity(0.5))
                case .error:
                    Text("Проверить снова")
                default:
                    Text("Проверить")
                }
            }
            .font(LozaType.buttonLabel)
            .tracking(0.8)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
        }
        .foregroundStyle(checkForeground)
        .glassEffect(.regular.tint(checkTint).interactive(), in: .rect(cornerRadius: 14))
        .disabled(trimmedHost.isEmpty || setupState == .checking)
    }

    private var checkTint: Color {
        switch setupState {
        case .verified: return LozaColor.accentGreen.opacity(0.35)
        case .error:    return Color(hex: 0xFF5050, alpha: 0.25)
        default:        return .white.opacity(0.12)
        }
    }

    private var checkForeground: Color {
        switch setupState {
        case .verified: return LozaColor.accentGreen.opacity(0.9)
        case .error:    return Color(hex: 0xFF7878, alpha: 0.85)
        default:        return .white.opacity(0.88)
        }
    }

    private func startCheck() {
        guard setupState != .checking else { return }
        let host = trimmedHost

        if host.isEmpty {
            showError("Введите хост и порт")
            return
        }
        if host.contains(" ") || !host.contains(".") {
            showError("Хост должен содержать точку")
            return
        }
        if host.count < 4 {
            showError("Введите корректный адрес")
            return
        }

        let normalized: String = {
            if host.hasPrefix("localhost") { return host }
            let parts = host.split(separator: ":")
            if parts.count == 2 {
                let port = parts[1]
                if port == "80" || port == "443" { return String(parts[0]) }
            }
            return host
        }()

        setupState = .checking
        errorMsg = ""

        Task {
            do {
                // Build URL from host
                let urlString: String = {
                    if normalized.hasPrefix("localhost") || normalized.contains(":") {
                        return "http://\(normalized)"
                    }
                    return "http://\(normalized)"
                }()

                guard let url = URL(string: urlString) else {
                    showError("Некорректный адрес", duration: 3)
                    return
                }

                // Health check
                let ok = await LozaAPIClient.shared.healthCheck(baseURL: url)
                guard ok else {
                    showError("Сервер не отвечает", duration: 3)
                    return
                }

                serverConfig.save(url)
                withAnimation { setupState = .verified }
                try? await Task.sleep(nanoseconds: 500_000_000)
                onSuccess()
            } catch {
                let msg = (error as NSError).localizedDescription
                let cleaned = msg.hasPrefix("URLSession") ? "Не удалось найти сервер" : msg
                showError(cleaned, duration: 3)
            }
        }
    }

    private func showError(_ message: String, duration: Double = 2) {
        errorMsg = message
        withAnimation { setupState = .error }
        Task {
            try? await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000))
            withAnimation { setupState = .idle }
        }
    }
}

#Preview {
    ServerSetupView(onSuccess: {})
        .environmentObject(SessionStore.shared)
        .environmentObject(ServerConfig.shared)
}
