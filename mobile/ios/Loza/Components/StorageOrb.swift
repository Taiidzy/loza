//
//  StorageOrb.swift
//  Loza
//
//  Vivid animated orb with liquid wave, splash particles, and glow.
//

import SwiftUI

struct StorageOrbView: View {
    var usedPercent: Int
    @State private var phase: CGFloat = 0
    @State private var splashDrops: [SplashDrop] = []

    var body: some View {
        GeometryReader { geo in
            let sz = min(geo.size.width, geo.size.height)
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            gradient: Gradient(colors: [
                                LozaColor.accentPurple.opacity(0.18),
                                LozaColor.accentBlue.opacity(0.12)
                            ]),
                            center: .center,
                            startRadius: 0,
                            endRadius: sz / 2
                        )
                    )
                    .frame(width: sz, height: sz)

                waveLayer(in: sz)
                    .mask(Circle().frame(width: sz, height: sz))

                waveLayer2(in: sz)
                    .mask(Circle().frame(width: sz, height: sz))

                ForEach(splashDrops) { drop in
                    Circle()
                        .fill(drop.color)
                        .frame(width: drop.size, height: drop.size)
                        .position(x: drop.x * sz, y: drop.y * sz)
                        .opacity(drop.opacity)
                        .blur(radius: drop.blur)
                }

                percentLabel(in: sz)
            }
            .shadow(color: LozaColor.accentPurple.opacity(0.15), radius: 8)
            .onAppear {
                withAnimation(.linear(duration: 3.2).repeatForever(autoreverses: false)) {
                    phase = .pi * 2
                }
                startSplash()
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }

    private func waveLayer(in sz: CGFloat) -> some View {
        let fill = CGFloat(usedPercent) / 100.0
        return Path { p in
            let midY = sz * (1 - fill)
            p.move(to: CGPoint(x: 0, y: sz))
            p.addLine(to: CGPoint(x: 0, y: midY))
            for i in 0...Int(sz) {
                let x = CGFloat(i)
                let y = midY + cos((x / sz) * 1.7 * .pi + phase) * (sz * 0.025)
                p.addLine(to: CGPoint(x: x, y: y))
            }
            p.addLine(to: CGPoint(x: sz, y: sz))
            p.closeSubpath()
        }
        .fill(
            LinearGradient(
                colors: [
                    LozaColor.accentBlue.opacity(0.75),
                    LozaColor.accentPurple.opacity(0.65)
                ],
                startPoint: .top, endPoint: .bottom
            )
        )
    }

    private func waveLayer2(in sz: CGFloat) -> some View {
        let fill = CGFloat(usedPercent) / 100.0
        return Path { p in
            let midY = sz * (1 - fill)
            p.move(to: CGPoint(x: 0, y: sz))
            p.addLine(to: CGPoint(x: 0, y: midY + 3))
            for i in 0...Int(sz) {
                let x = CGFloat(i)
                let y = midY + 3 + sin((x / sz) * 2.4 * .pi + phase * 0.8) * (sz * 0.018)
                p.addLine(to: CGPoint(x: x, y: y))
            }
            p.addLine(to: CGPoint(x: sz, y: sz))
            p.closeSubpath()
        }
        .fill(
            LinearGradient(
                colors: [
                    LozaColor.accentPink.opacity(0.35),
                    LozaColor.accentPurple.opacity(0.25)
                ],
                startPoint: .top, endPoint: .bottom
            )
        )
    }

    private func percentLabel(in sz: CGFloat) -> some View {
        VStack(spacing: 4) {
            Text("\(usedPercent)%")
                .font(.system(size: sz * 0.18, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.92))
            Text("Использовано")
                .font(.system(size: sz * 0.05, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.42))
        }
    }

    private func startSplash() {
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            let fill = CGFloat(usedPercent) / 100.0
            let surfaceY = 1 - fill

            let drop = SplashDrop(
                x: CGFloat.random(in: 0.25...0.75),
                y: CGFloat.random(in: surfaceY - 0.02...surfaceY + 0.02),
                size: CGFloat.random(in: 1.5...3.5),
                color: Bool.random() ? LozaColor.accentBlue : LozaColor.accentPurple,
                opacity: 1,
                blur: 0
            )
            splashDrops.append(drop)

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                if let idx = splashDrops.firstIndex(where: { $0.id == drop.id }) {
                    withAnimation(.easeOut(duration: 0.5)) {
                        splashDrops[idx].opacity = 0
                        splashDrops[idx].blur = 2
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        splashDrops.removeAll { $0.id == drop.id }
                    }
                }
            }
        }
    }
}

private struct SplashDrop: Identifiable {
    let id = UUID()
    var x: CGFloat
    var y: CGFloat
    var size: CGFloat
    var color: Color
    var opacity: CGFloat
    var blur: CGFloat
}

#Preview {
    ZStack {
        LozaBackgroundView()
        StorageOrbView(usedPercent: 65)
            .frame(width: 200, height: 200)
    }
}
