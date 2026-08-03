//
//  LozaView.swift
//  Loza
//
//  Vivid file browser with gradient breadcrumbs, pink accents, alive tree.
//

import SwiftUI
import Combine

// MARK: - View Model

enum FileViewMode: String, CaseIterable {
    case grid, list
}

@MainActor
final class LozaViewModel: ObservableObject {
    @Published var currentPath: [String] = ["root"]
    @Published var section: LozaSection = .files
    @Published var selectedId: String?
    @Published var viewMode: FileViewMode = .grid
    @Published var search: String = ""
    @Published var isCollapsed: Bool = false
    @Published var starredIds: Set<String> = Set(MockData.allFiles.filter { $0.starred }.map { $0.id })

    func navigate(to id: String) {
        if currentPath.last == id { return }
        currentPath.append(id)
    }

    func goToDepth(_ index: Int) {
        currentPath = Array(currentPath.prefix(index + 1))
        selectedId = nil
        search = ""
    }

    func switchSection(_ s: LozaSection) {
        section = s
        currentPath = ["root"]
        selectedId = nil
        search = ""
    }

    func toggleStar(id: String) {
        if starredIds.contains(id) { starredIds.remove(id) }
        else { starredIds.insert(id) }
    }

    var currentNode: FileNode {
        var node = MockData.fileSystem
        for i in 1..<currentPath.count {
            guard let child = node.children?.first(where: { $0.id == currentPath[i] }) else { break }
            node = child
        }
        return node
    }

    var baseItems: [FileNode] {
        switch section {
        case .recent:    return MockData.recent
        case .starred:   return MockData.allFiles.filter { starredIds.contains($0.id) }
        case .downloads: return MockData.downloads
        case .trash:     return []
        case .files:     return currentNode.children ?? []
        }
    }

    var items: [FileNode] {
        let filtered = baseItems.filter { $0.name.localizedCaseInsensitiveContains(search) }
        return filtered
    }

    var sectionCounts: [LozaSection: Int] {
        [
            .files:     currentNode.children?.count ?? 0,
            .recent:    MockData.recent.count,
            .starred:   starredIds.count,
            .downloads: MockData.downloads.count,
            .trash:     0,
        ]
    }
}

struct LozaView: View {
    @ObservedObject private var socket = StatusSocket.shared
    @StateObject private var model = LozaViewModel()

    var body: some View {
        NavigationStack {
            HStack(alignment: .top, spacing: 0) {
                sidebar
                Divider().frame(width: 1).overlay(Color.white.opacity(0.04))
                mainContent
            }
            .background { LozaBackgroundView() }
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            model.isCollapsed = UIScreen.main.bounds.width < 800
        }
    }

    // MARK: - Sidebar

    @ViewBuilder
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Spacer()
                Button {
                    withAnimation(.spring(response: 0.25, dampingFraction: 0.85)) {
                        model.isCollapsed.toggle()
                    }
                } label: {
                    Image(systemName: model.isCollapsed ? "chevron.right" : "chevron.left")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.35))
                        .frame(width: 26, height: 26)
                }
                Spacer()
            }
            .frame(height: 40)
            .padding(.vertical, 6)
            .contentShape(Rectangle())

            if !model.isCollapsed {
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        sidebarLabel("Быстрый доступ")

                        ForEach(LozaSection.allCases.filter { $0 != .files }) { s in
                            quickAccessItem(s)
                        }

                        sidebarLabel("Папки")
                        TreeRow(
                            node: MockData.fileSystem,
                            path: ["root"],
                            currentPath: model.currentPath,
                            selectedId: model.selectedId,
                            onSelect: { id in model.navigate(to: id) }
                        )
                        .padding(.leading, 8)
                    }
                    .padding(.vertical, 4)
                }

                Divider().frame(height: 1).overlay(Color.white.opacity(0.04))

                StoragePanel(
                    storageUsed: socket.status.map { ByteFormat.gb($0.storage.usedBytes) },
                    storageTotal: socket.status.map { ByteFormat.gb($0.storage.totalBytes) }
                )
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
        }
        .frame(width: model.isCollapsed ? 0 : 220)
        .opacity(model.isCollapsed ? 0 : 1)
    }

    private func sidebarLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(LozaType.fieldLabel)
            .foregroundStyle(.white.opacity(0.28))
            .tracking(0.8)
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 4)
    }

    private func quickAccessItem(_ section: LozaSection) -> some View {
        Button {
            model.switchSection(section)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: section == .files ? "folder" : sectionIcon(section))
                    .font(.system(size: 13))
                    .foregroundStyle(model.section == section ? LozaColor.accentPink : .white.opacity(0.38))
                    .frame(width: 18)

                Text(section.label)
                    .font(LozaType.body)
                    .foregroundStyle(model.section == section ? .white.opacity(0.88) : .white.opacity(0.55))

                Spacer(minLength: 2)

                let count = model.sectionCounts[section] ?? 0
                if count > 0 {
                    Text("\(count)")
                        .font(LozaType.fieldLabel)
                        .foregroundStyle(.white.opacity(0.3))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(model.section == section ? LozaColor.accentPink.opacity(0.15) : Color.clear)
            )
        }
    }

    private func sectionIcon(_ section: LozaSection) -> String {
        switch section {
        case .files:      return "folder"
        case .recent:     return "clock"
        case .starred:    return "star"
        case .downloads:  return "arrow.down.circle"
        case .trash:      return "trash"
        }
    }

    // MARK: - Main Content

    private var mainContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            breadcrumbsBar
            Divider().frame(height: 1).overlay(Color.white.opacity(0.04))

            if model.items.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(model.items) { node in
                            FileRow(
                                node: node,
                                isSelected: node.id == model.selectedId,
                                isStarred: model.starredIds.contains(node.id),
                                onTap: { model.selectedId = node.id },
                                onNavigate: { model.navigate(to: node.id) },
                                onToggleStar: { model.toggleStar(id: node.id) }
                            )
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private var breadcrumbsBar: some View {
        HStack(spacing: 3) {
            ForEach(Array(model.currentPath.enumerated()), id: \.offset) { idx, id in
                let name = modelName(for: id)
                Button {
                    model.goToDepth(idx)
                } label: {
                    Text(name)
                        .font(idx == model.currentPath.count - 1 ? LozaType.subheadline : LozaType.caption)
                        .foregroundStyle(idx == model.currentPath.count - 1 ? .white.opacity(0.88) : LozaColor.accentPink.opacity(0.7))
                }

                if idx < model.currentPath.count - 1 {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 8))
                        .foregroundStyle(.white.opacity(0.18))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .frame(height: 36)
    }

    private func modelName(for id: String) -> String {
        guard id != "root" else { return MockData.fileSystem.name }
        func find(_ node: FileNode, targetId: String) -> FileNode? {
            if node.id == targetId { return node }
            if let children = node.children {
                for child in children {
                    if let found = find(child, targetId: targetId) { return found }
                }
            }
            return nil
        }
        return find(MockData.fileSystem, targetId: id)?.name ?? id
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "folder")
                .font(.system(size: 28))
                .foregroundStyle(.white.opacity(0.15))
            Text("Папка пуста")
                .font(LozaType.subheadline)
                .foregroundStyle(.white.opacity(0.55))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - File Row

private struct FileRow: View {
    let node: FileNode
    let isSelected: Bool
    let isStarred: Bool
    var onTap: (() -> Void)?
    var onNavigate: (() -> Void)?
    var onToggleStar: (() -> Void)?

    var body: some View {
        Button {
            if node.type == .folder { onNavigate?() }
            else { onTap?() }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: FileIcon.icon(for: node.type))
                    .font(.system(size: 16))
                    .foregroundStyle(FileIcon.color(for: node.type, custom: node.color).opacity(0.85))
                    .frame(width: 22)

                VStack(alignment: .leading, spacing: 1) {
                    Text(node.name)
                        .font(LozaType.body)
                        .foregroundStyle(.white.opacity(0.88))
                        .lineLimit(1)
                    if let size = node.size {
                        Text(size)
                            .font(LozaType.fieldLabel)
                            .foregroundStyle(.white.opacity(0.35))
                    }
                }

                Spacer(minLength: 4)

                if isStarred {
                    Image(systemName: "star.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(LozaColor.accentYellow.opacity(0.7))
                }

                if node.type == .folder {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9))
                        .foregroundStyle(.white.opacity(0.15))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(isSelected ? LozaColor.accentPink.opacity(0.15) : Color.clear)
            )
        }
        .buttonStyle(.plain)
    }
}


// MARK: - Tree Row

private struct TreeRow: View {
    let node: FileNode
    let path: [String]
    let currentPath: [String]
    let selectedId: String?
    let onSelect: (String) -> Void

    private var isExpanded: Bool {
        currentPath.contains(node.id)
    }

    private var depth: Int {
        path.count - 1
    }

    var body: some View {
        if node.type == .folder {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    onSelect(node.id)
                } label: {
                    HStack(spacing: 4) {
                        Rectangle()
                            .fill(Color.clear)
                            .frame(width: CGFloat(depth) * 12)

                        Image(systemName: isExpanded ? "folder.fill" : "folder")
                            .font(.system(size: 12))
                            .foregroundStyle(LozaColor.accentPurple.opacity(0.7))
                        Text(node.name)
                            .font(LozaType.caption)
                            .foregroundStyle(
                                currentPath.last == node.id
                                ? .white.opacity(0.88)
                                : .white.opacity(0.55)
                            )
                            .lineLimit(1)
                        Spacer()
                    }
                    .padding(.vertical, 3)
                }

                if isExpanded, let children = node.children {
                    ForEach(children) { child in
                        TreeRow(
                            node: child,
                            path: path + [child.id],
                            currentPath: currentPath,
                            selectedId: selectedId,
                            onSelect: onSelect
                        )
                    }
                }
            }
        }
    }
}

#Preview {
    LozaView()
}
