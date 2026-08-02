//
//  LozaFileComponents.swift
//  Loza
//
//  Sub-components for LozaView: the recursive folder tree (TreeRow) and the
//  live storage panel (StoragePanel). Mirrors the Tree + storage sidebar
//  helpers in pages/dashboard/tabs/LozaTab.tsx.

import SwiftUI

// ─── Folder tree (recursive, mirrors the Tree JSX component) ────────────────────

struct TreeRow: View {
    let node: FileNode
    let path: [String]
    let currentPath: [String]
    let onSelect: (String) -> Void
    let onNavigate: (String) -> Void

    private var isFolder: Bool { node.type == .folder }
    private var isCurrent: Bool {
        currentPath.count == path.count && currentPath.enumerated().allSatisfy { $0.element == path[$0.offset] }
    }
    private var isAncestor: Bool {
        currentPath.count > path.count && path.enumerated().allSatisfy { $0.element == currentPath[$0.offset] }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if path.count > 1 {
                Button {
                    onNavigate(node.id)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: FileIcon.icon(for: node.type))
                            .font(.system(size: 13))
                            .foregroundStyle(node.color.map { Color(hexString: $0) } ?? FileIcon.color(for: node.type))
                        Text(node.name)
                            .font(.system(size: 12))
                            .foregroundStyle(isCurrent ? .white.opacity(0.85) : (isAncestor ? .white.opacity(0.5) : .white.opacity(0.45)))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, 5)
                    .padding(.leading, path.count > 1 ? CGFloat(path.count - 1) * 14 : 0)
                }
                .buttonStyle(.plain)
            }

            if let children = node.children, !children.isEmpty {
                ForEach(children.filter { $0.type == .folder }) { child in
                    TreeRow(
                        node: child,
                        path: path + [child.id],
                        currentPath: currentPath,
                        onSelect: onSelect,
                        onNavigate: onNavigate
                    )
                }
            }
        }
    }
}

// ─── Storage panel (live stats from StatusSocket, mirrors LozaTab storage div) ───

struct StoragePanel: View {
    let storage: StorageInfo

    private var usedPercent: Int {
        storage.totalBytes > 0 ? min(100, Int(Double(storage.usedBytes) / Double(storage.totalBytes) * 100)) : 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Хранилище")
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.28))
                    .textCase(.uppercase)
                    .tracking(0.8)
                Text("\(usedPercent)%")
                    .font(.system(size: 20, weight: .light))
                    .foregroundStyle(.white)
            }

            HStack(spacing: 2) {
                ForEach(storage.categories, id: \.id) { cat in
                    RoundedRectangle(cornerRadius: 0)
                        .fill(cat.color)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 5)
            .lozaGlass(radius: 3)

            VStack(spacing: 6) {
                ForEach(storage.categories) { cat in
                    HStack(spacing: 8) {
                        Circle()
                            .fill(cat.color)
                            .frame(width: 7, height: 7)
                        Text(cat.label)
                            .font(.system(size: 10.5))
                            .foregroundStyle(.white.opacity(0.5))
                        Spacer()
                        Text(ByteFormat.gb(cat.bytes))
                            .font(.system(size: 10))
                            .foregroundStyle(.white.opacity(0.28))
                            .monospacedDigit()
                    }
                }
            }

            HStack(spacing: 4) {
                Text(ByteFormat.gb(storage.usedBytes))
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.32))
                Text("из")
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.22))
                Text(ByteFormat.gb(storage.totalBytes))
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.32))
                Spacer()
                Text(ByteFormat.gb(storage.freeBytes))
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.22))
            }
            .monospacedDigit()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
