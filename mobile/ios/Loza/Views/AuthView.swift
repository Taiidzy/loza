//
//  AuthView.swift
//  Loza
//
//  Port of AuthPage.tsx (mobile layout only, per the desktop staying
//  on Tauri). The glass login card now uses the real Liquid Glass
//  material via .glassEffect instead of a hand-rolled blur, but the
//  copy, field layout, states (idle/loading/success/error) and error
//  message mapping are all preserved 1:1. Second step of the mobile
//  auth flow (after ServerSetupView) — POSTs to /auth/login on the
//  server configured there via AuthService/LozaAPIClient.
//

import SwiftUI

enum LoginState {
    case idle, loading, success, error
}

struct AuthView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var serverConfig: ServerConfig
    var onSuccess: () -> Void

    @State private var username = ""
    @State private var password = ""
    @State private var showPassword = false
    @State private var loginState: LoginState = .idle
    @State private var errorMsg = ""
    @FocusState private var focusedField: Field?

    private enum Field { case login, password }

    var body: some View {
        ZStack {
            LozaColor.bgMobile.ignoresSafeArea()

            ParticlesView()
                .ignoresSafeArea()

            // Decorative blobs, matching the two radial gradients in AuthPage.tsx
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

            VStack(spacing: 14) {
                loginCard

                if let host = serverConfig.baseURL?.host {
                    Button {
                        serverConfig.clear()
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "server.rack")
                                .font(.system(size: 10))
                            Text(host)
                                .font(.system(size: 11))
                        }
                        .foregroundStyle(.white.opacity(0.28))
                    }
                }
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: 368)
        }
        .preferredColorScheme(.dark)
    }

    private var loginCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Brand
            VStack(alignment: .leading, spacing: 3) {
                Text("Loza")
                    .font(.system(size: 22, weight: .light))
                    .foregroundStyle(.white.opacity(0.92))
                Text("С возвращением")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.32))
                    .tracking(0.4)
            }
            .padding(.bottom, 28)

            // Fields
            VStack(spacing: 8) {
                field(
                    label: "логин", placeholder: "Loza", text: $username,
                    isSecure: false, focus: .login
                )
                field(
                    label: "пароль", placeholder: "••••••••", text: $password,
                    isSecure: !showPassword, focus: .password, hasEye: true
                )
            }

            if loginState == .error, !errorMsg.isEmpty {
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

    @ViewBuilder
    private func field(label: String, placeholder: String, text: Binding<String>, isSecure: Bool, focus: Field, hasEye: Bool = false) -> some View {
        let isFocused = focusedField == focus

        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.system(size: 9))
                .tracking(1.2)
                .foregroundStyle(.white.opacity(0.16))

            HStack {
                Group {
                    if isSecure {
                        SecureField("", text: text, prompt: Text(placeholder).foregroundStyle(.white.opacity(0.2)))
                    } else {
                        TextField("", text: text, prompt: Text(placeholder).foregroundStyle(.white.opacity(0.2)))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                }
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.88))
                .focused($focusedField, equals: focus)
                .submitLabel(.go)
                .onSubmit(handleSubmit)

                if hasEye {
                    Button {
                        showPassword.toggle()
                    } label: {
                        Image(systemName: showPassword ? "eye" : "eye.slash")
                            .font(.system(size: 13))
                            .foregroundStyle(showPassword ? LozaColor.accentPink.opacity(0.45) : .white.opacity(0.22))
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 9)
        .padding(.bottom, 8)
        .background(
            RoundedRectangle(cornerRadius: LozaMetrics.fieldRadius, style: .continuous)
                .fill(Color.white.opacity(0.04))
        )
        .overlay(
            RoundedRectangle(cornerRadius: LozaMetrics.fieldRadius, style: .continuous)
                .stroke(
                    isFocused ? LozaColor.accentPink.opacity(0.5)
                        : loginState == .error ? Color(hex: 0xFF6464, alpha: 0.4)
                        : Color.white.opacity(0.09),
                    lineWidth: 1
                )
        )
        .shadow(color: isFocused ? LozaColor.accentPink.opacity(0.12) : .clear, radius: 6)
        .animation(.easeOut(duration: 0.2), value: isFocused)
    }

    private var submitButton: some View {
        Button(action: handleSubmit) {
            HStack(spacing: 8) {
                switch loginState {
                case .success:
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                    Text("Добро пожаловать")
                case .loading:
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white.opacity(0.78))
                    Text("Вход").foregroundStyle(.white.opacity(0.5))
                default:
                    Text("Войти")
                }
            }
            .font(.system(size: 13, weight: .medium))
            .tracking(0.8)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
        }
        .foregroundStyle(submitForeground)
        .glassEffect(.regular.tint(submitTint).interactive(), in: .rect(cornerRadius: 14))
        .disabled(loginState == .loading)
    }

    private var submitTint: Color {
        switch loginState {
        case .success: return LozaColor.accentGreen.opacity(0.35)
        case .error:   return Color(hex: 0xFF5050, alpha: 0.25)
        default:       return .white.opacity(0.12)
        }
    }

    private var submitForeground: Color {
        switch loginState {
        case .success: return LozaColor.accentGreen.opacity(0.9)
        case .error:   return Color(hex: 0xFF7878, alpha: 0.85)
        default:       return .white.opacity(0.88)
        }
    }

    // ─── Actions ────────────────────────────────────────────────────────────

    private func handleSubmit() {
        guard loginState != .loading else { return }

        if username.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty {
            showError("Заполните все поля")
            return
        }

        loginState = .loading
        errorMsg = ""

        Task {
            do {
                let resp = try await AuthService.login(username: username.trimmingCharacters(in: .whitespaces), password: password)
                session.save(AuthState(
                    token: resp.token,
                    username: resp.username,
                    displayName: resp.displayName,
                    role: resp.role,
                    expiresAt: TimeInterval(resp.expiresAt)
                ))
                withAnimation { loginState = .success }
                try? await Task.sleep(nanoseconds: 800_000_000)
                onSuccess()
            } catch let err as AuthError {
                showError(err.errorDescription ?? "Ошибка сервера", duration: 3)
            } catch {
                showError(AuthError.from(error).errorDescription ?? "Ошибка сервера", duration: 3)
            }
        }
    }

    private func showError(_ message: String, duration: Double = 2) {
        errorMsg = message
        withAnimation { loginState = .error }
        Task {
            try? await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000))
            withAnimation { loginState = .idle }
        }
    }
}

#Preview {
    AuthView(onSuccess: {})
        .environmentObject(SessionStore.shared)
        .environmentObject(ServerConfig.shared)
}
