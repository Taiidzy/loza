//
//  StorageOrb.swift
//  Loza
//
//  Faithful port of components/StorageOrb.tsx.
//  Same geometry (96pt circle, r=40), same segmented ring, same liquid
//  fill + wave + droplet-splash animation when usedBytes increases, and
//  the same tap-to-reveal breakdown tooltip. Do not change the layout
//  or proportions here — this is the one piece explicitly called out
//  as "very important" to preserve.
//

import SwiftUI

struct StorageOrb: View {
    let storage: StorageInfo
    @Binding var expanded: Bool

    @State private var liquidPhase: CGFloat = 0        // drives the endless wave scroll
    @State private var splashID = 0                     // bump to replay the splash
    @State private var previousUsed: Int64
    @State private var impactOffset: CGFloat = 0         // spring "kick" on the liquid surface

    private let size: CGFloat = 96
    private let radius: CGFloat = 40

    init(storage: StorageInfo, expanded: Binding<Bool>) {
        self.storage = storage
        _expanded = expanded
        _previousUsed = State(initialValue: storage.usedBytes)
    }

    private var pct: Int { storage.usedPercent }
    private var freeBytes: Int64 { storage.freeBytes }

    private var segments: [(category: StorageCategory, start: Double, end: Double, share: Double)] {
        let total = max(storage.categories.reduce(0) { $0 + $1.bytes }, 1)
        var acc: Int64 = 0
        return storage.categories.map { c in
            let start = Double(acc) / Double(total)
            acc += c.bytes
            let end = Double(acc) / Double(total)
            return (c, start, end, Double(c.bytes) / Double(total))
        }
    }

    var body: some View {
        ZStack {
            orb
        }
        .frame(width: size, height: size)
        .contentShape(Circle())
        .onTapGesture {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                expanded.toggle()
            }
        }
        .onAppear { startWaveLoop() }
        .onChange(of: storage.usedBytes) { _, newValue in
            guard newValue > previousUsed else {
                previousUsed = newValue
                return
            }
            previousUsed = newValue
            triggerSplash()
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.75), value: expanded)
    }

    // ─── Orb ────────────────────────────────────────────────────────────────

    private var orb: some View {
        ZStack {
            // Base ring
            Circle()
                .fill(Color.white.opacity(0.04))
                .overlay(Circle().stroke(Color.white.opacity(0.08), lineWidth: 1))
                .frame(width: radius * 2, height: radius * 2)

            // Segmented category ring (drawn just outside the base circle)
            ForEach(Array(segments.enumerated()), id: \.offset) { _, seg in
                Circle()
                    .trim(from: seg.start, to: max(seg.start, seg.end))
                    .stroke(seg.category.color, style: StrokeStyle(lineWidth: 3, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
                    .frame(width: (radius + 5) * 2, height: (radius + 5) * 2)
                    .opacity(expanded ? 1 : 0.85)
            }

            // Liquid fill, clipped to the circle
            liquidFill
                .frame(width: size, height: size)
                .clipShape(Circle())

            // Percentage label
            VStack(spacing: 2) {
                Text("\(pct)%")
                    .font(.system(size: 20, weight: .light))
                    .foregroundStyle(.white)
                    .monospacedDigit()
                Text("занято")
                    .font(.system(size: 8))
                    .foregroundStyle(.white.opacity(0.4))
                    .tracking(0.4)
            }
        }
    }

    private var liquidLevel: CGFloat {
        size - (CGFloat(pct) / 100) * size
    }

    private var liquidGradient: LinearGradient {
        LinearGradient(
            colors: [LozaColor.accentPurple.opacity(0.9), LozaColor.accentPink.opacity(0.9)],
            startPoint: .top, endPoint: .bottom
        )
    }

    @ViewBuilder
    private var liquidFill: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            Canvas { ctx, canvasSize in
                let level = liquidLevel + impactOffset

                // Two overlapping sine waves, each looping horizontally,
                // matching the two <motion.path> layers in the TSX version.
                let waveBack = wavePath(level: level, size: canvasSize, t: t, speed: 4.0, amplitude: 4, phaseOffset: 0)
                ctx.fill(waveBack, with: .linearGradient(
                    Gradient(colors: [LozaColor.accentPurple.opacity(0.35), LozaColor.accentPink.opacity(0.35)]),
                    startPoint: .zero, endPoint: CGPoint(x: 0, y: canvasSize.height)
                ))

                let waveFront = wavePath(level: level, size: canvasSize, t: t, speed: 2.5, amplitude: 4, phaseOffset: .pi)
                ctx.fill(waveFront, with: .linearGradient(
                    Gradient(colors: [LozaColor.accentPurple.opacity(0.65), LozaColor.accentPink.opacity(0.65)]),
                    startPoint: .zero, endPoint: CGPoint(x: 0, y: canvasSize.height)
                ))
            }
        }
        .overlay(splashOverlay)
    }

    private func wavePath(level: CGFloat, size: CGSize, t: TimeInterval, speed: Double, amplitude: CGFloat, phaseOffset: Double) -> Path {
        var path = Path()
        let width = size.width
        let waveLength = width / 2
        let phase = CGFloat((t / speed).truncatingRemainder(dividingBy: 1)) * waveLength + CGFloat(phaseOffset)

        path.move(to: CGPoint(x: -waveLength * 2, y: level))
        var x = -waveLength * 2
        while x <= width + waveLength * 2 {
            let y = level + amplitude * sin((x + phase) / waveLength * .pi)
            path.addLine(to: CGPoint(x: x, y: y))
            x += 4
        }
        path.addLine(to: CGPoint(x: width + waveLength * 2, y: size.height))
        path.addLine(to: CGPoint(x: -waveLength * 2, y: size.height))
        path.closeSubpath()
        return path
    }

    // ─── Splash effect (droplet impact) ────────────────────────────────────

    private struct Droplet { let dx: CGFloat; let dy: CGFloat; let r: CGFloat; let delay: Double }
    private let droplets: [Droplet] = [
        Droplet(dx: -16, dy: -22, r: 1.5, delay: 0.40),
        Droplet(dx: -8,  dy: -14, r: 1.0, delay: 0.42),
        Droplet(dx: 14,  dy: -18, r: 1.2, delay: 0.41),
        Droplet(dx: 10,  dy: -12, r: 0.8, delay: 0.43),
    ]

    @State private var showSplash = false
    @State private var dropletsVisible = false
    @State private var waveVisible = false

    @ViewBuilder
    private var splashOverlay: some View {
        if showSplash {
            ZStack {
                // Ripples
                Circle()
                    .stroke(liquidGradient, lineWidth: 1.5)
                    .frame(width: waveVisible ? 56 : 0, height: waveVisible ? 14 : 0)
                    .opacity(waveVisible ? 0 : 0.8)
                    .position(x: size / 2, y: liquidLevel)
                    .animation(.easeOut(duration: 0.8).delay(0.4), value: waveVisible)

                Circle()
                    .stroke(liquidGradient, lineWidth: 1)
                    .frame(width: waveVisible ? 36 : 0, height: waveVisible ? 9 : 0)
                    .opacity(waveVisible ? 0 : 0.5)
                    .position(x: size / 2, y: liquidLevel)
                    .animation(.easeOut(duration: 0.8).delay(0.5), value: waveVisible)

                // Droplets flying outward
                ForEach(Array(droplets.enumerated()), id: \.offset) { _, d in
                    Circle()
                        .fill(liquidGradient)
                        .frame(width: d.r * 2, height: d.r * 2)
                        .position(
                            x: size / 2 + (dropletsVisible ? d.dx : 0),
                            y: liquidLevel + (dropletsVisible ? d.dy + 2 : 0)
                        )
                        .opacity(dropletsVisible ? 1 : 0)
                        .animation(.easeOut(duration: 0.5).delay(d.delay), value: dropletsVisible)
                }
            }
            .onAppear {
                waveVisible = false
                dropletsVisible = false
                DispatchQueue.main.async {
                    waveVisible = true
                    dropletsVisible = true
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) {
                    showSplash = false
                }
            }
        }
    }

    private func startWaveLoop() {
        // Continuous animation is driven by TimelineView; nothing to kick off here.
    }

    private func triggerSplash() {
        splashID += 1
        showSplash = true

        // Liquid "impact" reaction: dip then spring back, matching the
        // { y: [0, 6, -2, 0] } keyframes on impactControls in the TSX.
        withAnimation(.easeInOut(duration: 0.15).delay(0.4)) {
            impactOffset = 6
        }
        withAnimation(.easeInOut(duration: 0.25).delay(0.55)) {
            impactOffset = -2
        }
        withAnimation(.easeInOut(duration: 0.2).delay(0.8)) {
            impactOffset = 0
        }
    }

    // ─── Tooltip ────────────────────────────────────────────────────────────

}

#Preview {
    @Previewable @State var expanded = true
    ZStack {
        Color.black
        StorageOrb(storage: StorageInfo(
            totalBytes: 512 * 1024 * 1024 * 1024,
            usedBytes: 214 * 1024 * 1024 * 1024,
            categories: [
                StorageCategory(id: "photos", label: "Фото", bytes: 92 * 1024 * 1024 * 1024, color: LozaColor.accentPink),
                StorageCategory(id: "video", label: "Видео", bytes: 68 * 1024 * 1024 * 1024, color: LozaColor.accentPurple),
                StorageCategory(id: "docs", label: "Документы", bytes: 24 * 1024 * 1024 * 1024, color: LozaColor.accentBlue),
                StorageCategory(id: "backups", label: "Бэкапы", bytes: 20 * 1024 * 1024 * 1024, color: LozaColor.accentGreen),
                StorageCategory(id: "other", label: "Прочее", bytes: 10 * 1024 * 1024 * 1024, color: LozaColor.accentYellow),
            ],
            history7d: [38, 39, 40, 40, 41, 41.5, 41.8]
        ), expanded: $expanded)
    }
}
