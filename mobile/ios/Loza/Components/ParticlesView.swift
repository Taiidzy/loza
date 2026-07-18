//
//  ParticlesView.swift
//  Loza
//
//  Port of the <Particles /> canvas from AuthPage.tsx: drifting dots
//  with connecting lines when close together.
//

import SwiftUI

struct ParticlesView: View {
    private struct Dot {
        var x: CGFloat
        var y: CGFloat
        var r: CGFloat
        var vx: CGFloat
        var vy: CGFloat
        var o: Double
    }

    @State private var dots: [Dot] = []

    var body: some View {
        TimelineView(.animation) { _ in
            Canvas { ctx, size in
                if dots.isEmpty { return }

                for i in dots.indices {
                    dots[i].x += dots[i].vx
                    dots[i].y += dots[i].vy
                    if dots[i].x < 0 { dots[i].x = size.width }
                    if dots[i].x > size.width { dots[i].x = 0 }
                    if dots[i].y < 0 { dots[i].y = size.height }
                    if dots[i].y > size.height { dots[i].y = 0 }
                }

                for i in dots.indices {
                    let d = dots[i]
                    let rect = CGRect(x: d.x - d.r, y: d.y - d.r, width: d.r * 2, height: d.r * 2)
                    ctx.fill(Path(ellipseIn: rect), with: .color(LozaColor.accentPink.opacity(d.o)))
                }

                for i in 0..<dots.count {
                    for j in (i + 1)..<dots.count {
                        let dx = dots[i].x - dots[j].x
                        let dy = dots[i].y - dots[j].y
                        let dist = (dx * dx + dy * dy).squareRoot()
                        if dist < 90 {
                            var path = Path()
                            path.move(to: CGPoint(x: dots[i].x, y: dots[i].y))
                            path.addLine(to: CGPoint(x: dots[j].x, y: dots[j].y))
                            ctx.stroke(path, with: .color(LozaColor.accentPurple.opacity(0.12 * (1 - dist / 90))), lineWidth: 0.5)
                        }
                    }
                }
            }
        }
        .allowsHitTesting(false)
        .onAppear {
            guard dots.isEmpty else { return }
            dots = (0..<55).map { _ in
                Dot(
                    x: CGFloat.random(in: 0...400),
                    y: CGFloat.random(in: 0...800),
                    r: CGFloat.random(in: 0.4...2.0),
                    vx: CGFloat.random(in: -0.35...0.35),
                    vy: CGFloat.random(in: -0.35...0.35),
                    o: Double.random(in: 0.1...0.5)
                )
            }
        }
    }
}
