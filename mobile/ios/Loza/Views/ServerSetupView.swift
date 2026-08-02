//
//  ServerSetupView.swift
//  Loza
//
//  First screen of the mobile auth flow: enter the Loza server address.
//  Desktop never needs this (SERVER_URL is compiled in, see auth.rs), but
//  a phone can point at any Loza server, so it's asked once here and
//  persisted in the Keychain via ServerConfig. Visually a sibling of
//  AuthView's login card — same glass card, particles, and blob background
//  — so the two steps read as one continuous flow, not two different apps.
//
//  On success, calls onConfigured() — RootView decides what to show next
//  (AuthView, since there still won't be a session yet).
//

import SwiftUI

struct ServerSetupView: View {
    @EnvironmentObject private var serverConfig: ServerConfig
    var onConfigured: () -> Void

    @State private var input = ""
    @State private var state: LoginState = .idle
    @State private var errorMsg = ""
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            .lozaBackground()

            ParticlesView()
                .ignoresSafeArea()

            Circle()
                .fill(RadialGradient(colors: [LozaColor.accentPurple.opacity(0.18), .clear], center: .center, startRadius: 0, endRadius: 210))
                .frame(width: 420, height: 420)
                .blur(radius: 40)
                .offset(x: 140, y: -280)
                .allowsHitTesting(false)

            Circle()
                .fill(RadialGradient(colors: [LozaColor.accentPink.opacity(0.14), .clear], center: .center, startRadius: 0, endRadius: 160))
                .frame(width: 320, height: 320)
                .blur(radius: 40)
                .offset(x: -120, y: 300)
                .allowsHitTesting(false)

            card
                .padding(.horizontal, 20)
                .frame(maxWidth: 368)
        }
        .preferredColorScheme(.dark)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Loza")
                    .font(.system(size: 22, weight: .light))
                    .foregroundStyle(.white.opacity(0.92))
                Text("Подключение к серверу")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.32))
                    .tracking(0.4)
            }
            .padding(.bottom, 28)

            VStack(alignment: .leading, spacing: 2) {
                Text("АДРЕС СЕРВЕРА")
                    .font(.system(size: 9))
                    .tracking(1.2)
                    .foregroundStyle(.white.opacity(0.16))

                TextField("", text: $input, prompt: Text("192.168.1.10:4242").foregroundStyle(.white.opacity(0.2)))
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.88))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .submitLabel(.go)
                    .onSubmit(handleSubmit)
            }
            .padding(.horizontal, 14)
            .padding(.top, 9)
            .padding(.bottom, 8)
            .background(
                if #available(iOS 26.0, *) {
                    RoundedRectangle(cornerRadius: LozaMetrics.fieldRadius, style: .continuous)
                        .fill(Color.clear)
                        .glassEffect(.regular)
                } else {
                    RoundedRectangle(cornerRadius: LozaMetrics.fieldRadius, style: .continuous)
                        .fill(Color.white.opacity(0.04))
                }
            )
            .overlay(
                RoundedRectangle(cornerRadius: LozaMetrics.fieldRadius, style: .continuous)
                    .stroke(
                        focused ? LozaColor.accentPink.opacity(0.5)
                            : state == .error ? Color(hex: 0xFF6464, alpha: 0.4)
                            : Color.white.opacity(0.09),
                        lineWidth: 1
                    )
            )
            .shadow(color: focused ? LozaColor.accentPink.opacity(0.12) : .clear, radius: 6)
            .animation(.easeOut(duration: 0.2), value: focused)

            Text("HTTP: 192.168.1.10:4242 или loza.мойдом.local · публичный сервер: https://cloud.example.com")
                .font(.system(size: 10.5))
                .foregroundStyle(.white.opacity(0.22))
                .padding(.top, 8)

            if state == .error, !errorMsg.isEmpty {
                Text(errorMsg)
                    .font(.system(size: 11))
                    .foregroundStyle(Color(hex: 0xFF7878, alpha: 0.85))
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            submitButton
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
                        colors: [LozaColor.accentPink.opacity(0.2), LozaColor.accentPurple.opacity(0.12), LozaColor.accentBlue.opacity(0.08)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
    }

    private var submitButton: some View {
        Button(action: handleSubmit) {
            HStack(spacing: 8) {
                switch state {
                case .success:
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                    Text("Готово")
                case .loading:
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white.opacity(0.78))
                    Text("Проверка").foregroundStyle(.white.opacity(0.5))
                default:
                    Text("Продолжить")
                }
            }
            .font(.system(size: 13, weight: .medium))
            .tracking(0.8)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
        }
        .foregroundStyle(submitForeground)
        .glassEffect(.regular.tint(submitTint).interactive(), in: .rect(cornerRadius: 14))
        .disabled(state == .loading)
    }

    private var submitTint: Color {
        switch state {
        case .success: return LozaColor.accentGreen.opacity(0.35)
        case .error:   return Color(hex: 0xFF5050, alpha: 0.25)
        default:       return .white.opacity(0.12)
        }
    }

    private var submitForeground: Color {
        switch state {
        case .success: return LozaColor.accentGreen.opacity(0.9)
        case .error:   return Color(hex: 0xFF7878, alpha: 0.85)
        default:       return .white.opacity(0.88)
        }
    }

    // ─── Actions ────────────────────────────────────────────────────────────

    private func handleSubmit() {
        guard state != .loading else { return }

        guard let url = ServerConfig.normalize(input) else {
            showError("Введите корректный адрес сервера")
            return
        }

        state = .loading
        errorMsg = ""

        Task {
            let reachable = await AuthService.checkServerHealth(baseURL: url)
            if reachable {
                serverConfig.save(url)
                withAnimation { state = .success }
                try? await Task.sleep(nanoseconds: 500_000_000)
                onConfigured()
            } else {
                // Still let the user proceed — the server might be briefly
                // unreachable (e.g. sleeping NAS) even though the address
                // is correct; login itself will fail clearly if it's really wrong.
                serverConfig.save(url)
                withAnimation { state = .success }
                try? await Task.sleep(nanoseconds: 500_000_000)
                onConfigured()
            }
        }
    }

    private func showError(_ message: String) {
        errorMsg = message
        withAnimation { state = .error }
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            withAnimation { state = .idle }
        }
    }
}

#Preview {
    ServerSetupView(onConfigured: {})
        .environmentObject(ServerConfig.shared)
}
