//
//  LozaFileComponents.swift
//  Loza
//
//  Vivid tree row with gradient selection, colored icons, alive storage panel.
//

import SwiftUI

struct LozaTreeRowView: View {
    let node: FileNode
    var isSelected = false
    var onTap: (() -> Void)?
    var onInfo: (() -> Void)?

    @State private var isExpanded = false
    @State private var isHovered = false

    private var icon: String {
        FileIcon.icon(for: node.type)
    }

    private var iconColor: Color {
        FileIcon.color(for: node.type, custom: node.color)
    }

    var body: some View {
        Button(action: {
            withAnimation(.easeInOut(duration: 0.2)) {
                if node.type == .folder {
                    isExpanded.toggle()
                }
                onTap?()
            }
        }) {
            HStack(spacing: 8) {
                if node.type != .folder || true { indentView }

                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundStyle(iconColor.opacity(0.85))
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 1) {
                    Text(node.name)
                        .font(LozaType.body)
                        .foregroundStyle(.white.opacity(0.88))
                        .lineLimit(1)

                    if node.type == .folder, let size = node.size {
                        Text(size)
                            .font(LozaType.fieldLabel)
                            .foregroundStyle(.white.opacity(0.38))
                    }
                }

                Spacer(minLength: 4)

                if node.starred {
                    Image(systemName: "star.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(LozaColor.accentYellow.opacity(0.7))
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(
                        isSelected ? LozaColor.accentPink.opacity(0.2)
                        : isHovered ? Color.white.opacity(0.03)
                        : Color.clear
                    )
            )
        }
        .buttonStyle(.plain)
        .onHover { hovering in isHovered = hovering }

        if isExpanded, let children = node.children {
            ForEach(children) { child in
                LozaTreeRowView(
                    node: child,
                    isSelected: false,
                    onTap: { onTap?() },
                    onInfo: { onInfo?() }
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
    }

    private var indentView: some View {
        HStack(spacing: 0) {
            ForEach(0..<max(0, node.id.count - 2), id: \.self) { _ in
                Rectangle()
                    .fill(.white.opacity(0.05))
                    .frame(width: 12)
            }
        }
    }
}

// MARK: - Storage Panel (for sidebar)

struct StoragePanel: View {
    let storageUsed: String?
    let storageTotal: String?

    var body: some View {
        if let used = storageUsed, let total = storageTotal {
            VStack(alignment: .leading, spacing: 4) {
                Text("Хранилище")
                    .font(LozaType.fieldLabel)
                    .foregroundStyle(.white.opacity(0.35))

                HStack {
                    Text(used)
                        .font(LozaType.subheadline)
                        .foregroundStyle(.white.opacity(0.78))
                    Text("/")
                        .font(LozaType.caption)
                        .foregroundStyle(.white.opacity(0.3))
                    Text(total)
                        .font(LozaType.subheadline)
                        .foregroundStyle(.white.opacity(0.55))
                }
            }
        }
    }
}

#Preview {
    VStack(spacing: 12) {
        LozaTreeRowView(node: MockData.fileSystem)
    }
    .padding()
    .background(LozaBackgroundView())
}
