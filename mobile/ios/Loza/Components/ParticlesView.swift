//
//  ParticlesView.swift
//  Loza
//
//  Vivid animated particle background with gradient dots and slow drift.
//

import SwiftUI

struct ParticlesView: View {
    var count = 30

    @State private var particles: [Particle] = []

    struct Particle: Identifiable {
        let id = UUID()
        var x: CGFloat
        var y: CGFloat
        var size: CGFloat
        var opacity: Double
        var speed: CGFloat
        var color: Color
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                ForEach(particles) { p in
                    Circle()
                        .fill(p.color)
                        .frame(width: p.size, height: p.size)
                        .position(x: p.x * geo.size.width, y: p.y * geo.size.height)
                        .opacity(p.opacity)
                }
            }
            .onAppear {
                if particles.isEmpty {
                    particles = (0..<count).map { _ in makeParticle() }
                }
                startAnimation(in: geo.size)
            }
        }
    }

    private func makeParticle() -> Particle {
        Particle(
            x: CGFloat.random(in: 0...1),
            y: CGFloat.random(in: 0...1),
            size: CGFloat.random(in: 1.5...4),
            opacity: Double.random(in: 0.08...0.2),
            speed: CGFloat.random(in: 0.0002...0.0008),
            color: [LozaColor.accentPink, LozaColor.accentPurple, LozaColor.accentBlue].randomElement()!
        )
    }

    private func startAnimation(in size: CGSize) {
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            for i in particles.indices {
                particles[i].y -= particles[i].speed
                if particles[i].y < -0.02 {
                    particles[i].y = 1.02
                    particles[i].x = CGFloat.random(in: 0...1)
                }
                withAnimation(.easeInOut(duration: 2.0)) {
                    particles[i].opacity = Double.random(in: 0.06...0.18)
                }
            }
        }
    }
}

#Preview {
    ParticlesView()
        .background(LozaColor.bgMobile)
}
