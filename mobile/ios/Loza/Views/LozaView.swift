//
//  LozaView.swift
//  Loza
//
//  Mobile port of pages/dashboard/tabs/LozaTab.tsx: a file browser with a
//  collapsible sidebar (quick-access sections + folder tree + live storage
//  stats) and a main panel (breadcrumbs + search + grid/list view).
//
//  The desktop tab uses entirely mock data (no file-storage backend API), so
//  this port mirrors MOCK_FS / RECENT / DOWNLOADS verbatim. Storage usage
//  under the sidebar, however, is live — read from StatusSocket.shared.status.

import SwiftUI

// ─── View model ─────────────────────────────────────────────────────────────────

enum FileViewMode: String, CaseIterable {
    case grid
    case list
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

    // Navigate to a folder by pushing its id onto the path.
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
        if starredIds.contains(id) {
            starredIds.remove(id)
        } else {
            starredIds.insert(id)
        }
    }

    // ─── Derived state (mirrors LozaTab.tsx useMemo blocks) ────────────────────

    var currentNode: FileNode {
        var node = MockData.fileSystem
        for i in 1..<currentPath.count {
            guard let child = node.children?.first(where: { $0.id == currentPath[i] }) else { break }
            node = child
        }
        return node
    }

    var sectionTitle: String {
        section == .files ? currentNode.name : section.label
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

    // Counts for the quick-access sidebar badges.
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

// ─── Main view ──────────────────────────────────────────────────────────────────

struct LozaView: View {
    @ObservedObject private var socket = StatusSocket.shared
    @StateObject private var model = LozaViewModel()

    var body: some View {
        NavigationStack {
            HStack(alignment: .top, spacing: 0) {
                sidebar

                Divider()
                    .frame(width: 1)
                    .overlay(Color.white.opacity(0.04))

                mainContent
            }
            .lozaBackground()
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            model.isCollapsed = UIScreen.main.bounds.width < 800
        }
    }

    // ─── Sidebar ────────────────────────────────────────────────────────────────

    @ViewBuilder
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Collapse toggle
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
                            onSelect: { model.switchSection($0 == "files" ? .files : .files) },
                            onNavigate: { model.navigate(to: $0) }
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)

                        if let storage = socket.status?.storage {
                            StoragePanel(storage: storage)
                                .padding(.top, 16)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
            } else {
                // Collapsed: icon-only strip
                VStack(spacing: 20) {
                    Spacer()
                    ForEach(LozaSection.allCases.filter { $0 != .files }) { s in
                        collapsedIcon(s)
                    }
                    Spacer()
                    if let storage = socket.status?.storage {
                        collapsedStorageBadge(storage: storage)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
            }
        }
        .frame(width: model.isCollapsed ? 64 : 240)
    }

    @ViewBuilder
    private func quickAccessItem(_ s: LozaSection) -> some View {
        Button {
            model.switchSection(s)
            model.selectedId = nil
        } label: {
            HStack(spacing: 10) {
                Image(systemName: systemIcon(for: s))
                    .frame(width: 18, height: 18)
                VStack(alignment: .leading, spacing: 1) {
                    Text(s.label)
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.8))
                    Text("\(model.sectionCounts[s, default: 0]) элементов")
                        .font(.system(size: 10))
                        .foregroundStyle(.white.opacity(0.35))
                }
                Spacer()
                if model.section == s {
                    Color.white.opacity(0.18)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(
            model.section == s
                ? Color.white.opacity(0.18)
                : Color.clear
        )
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    @ViewBuilder
    private func collapsedIcon(_ s: LozaSection) -> some View {
        Button {
            model.switchSection(s)
        } label: {
            Image(systemName: systemIcon(for: s))
                .font(.system(size: 18))
                .foregroundStyle(model.section == s ? .white : .white.opacity(0.35))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func collapsedStorageBadge(storage: StorageInfo) -> some View {
        VStack(spacing: 4) {
            Text("\(storage.usedPercent)%")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.6))
            Text(ByteFormat.gbInt(storage.usedBytes))
                .font(.system(size: 8))
                .foregroundStyle(.white.opacity(0.25))
        }
        .frame(maxWidth: .infinity)
    }

    // ─── Main content ───────────────────────────────────────────────────────────

    private var mainContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Breadcrumbs
            breadcrumbs

            // Toolbar: search + view toggle
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.3))
                    TextField("Поиск…", text: $model.search)
                        .font(.system(size: 13))
                        .textFieldStyle(.plain)
                }
                .padding(.horizontal, 10)
                .frame(maxWidth: 220, alignment: .leading)

                Spacer()

                // View mode toggle
                HStack(spacing: 2) {
                    Button { model.viewMode = .grid } label: {
                        Image(systemName: "square.grid.2x2")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(model.viewMode == .grid ? .white : .white.opacity(0.25))
                    }
                    .buttonStyle(.plain)
                    Button { model.viewMode = .list } label: {
                        Image(systemName: "list.bullet")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(model.viewMode == .list ? .white : .white.opacity(0.25))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 4)
                .frame(height: 26)
                .lozaGlass(radius: LozaMetrics.pillRadius, style: .thin)
                .clipShape(RoundedRectangle(cornerRadius: LozaMetrics.pillRadius, style: .continuous))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            // Section title + count
            HStack(spacing: 6) {
                Text("\(model.sectionTitle) · \(model.items.count) \(plural(count: model.items.count))")
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.3))
                    .monospacedDigit()
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)

            // File listing
            if model.items.isEmpty {
                emptyState
            } else if model.viewMode == .grid {
                scrollView(.grid)
            } else {
                scrollView(.list)
            }
        }
        .background(Color.clear)
    }

    @ViewBuilder
    private var breadcrumbs: some View {
        let path = model.currentPath
        HStack(spacing: 4) {
            Button {
                model.currentPath = ["root"]
                model.section = .files
            } label: {
                Image(systemName: "home")
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.45))
            }
            .buttonStyle(.plain)

            if path.count > 1 {
                ForEach(1..<path.count, id: \.self) { idx in
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10))
                            .foregroundStyle(.white.opacity(0.15))
                        if idx == path.count - 1 {
                            Text(nodeName(for: path[idx]))
                                .font(.system(size: 11))
                                .foregroundStyle(.white.opacity(0.6))
                        } else {
                            Button {
                                model.goToDepth(idx)
                                model.section = .files
                            } label: {
                                Text(nodeName(for: path[idx]))
                                    .font(.system(size: 11))
                                    .foregroundStyle(.white.opacity(0.6))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private func scrollView(_ mode: FileViewMode) -> some View {
        ScrollView {
            if mode == .grid {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 100, maximum: 130), spacing: 16)], spacing: 16) {
                    ForEach(model.items) { item in
                        gridItem(item)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(model.items.enumerated()), id: \.offset) { _, item in
                        listItem(item)
                        if item.id != model.items.last?.id {
                            Divider().overlay(Color.white.opacity(0.05))
                        }
                    }
                }
            }
        }
    }

    // ─── File item views ────────────────────────────────────────────────────────

    @ViewBuilder
    private func gridItem(_ item: FileNode) -> some View {
        Button {
            if item.type == .folder {
                model.navigate(to: item.id)
            } else {
                model.selectedId = item.id
            }
        } label: {
            VStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.clear)
                    .lozaMiniGlass(radius: 10, fallbackOpacity: 0.05)
                    .overlay(
                        VStack {
                            Spacer()
                            Image(systemName: FileIcon.icon(for: item.type))
                                .font(.system(size: 30))
                                .foregroundStyle(FileIcon.color(for: item.type, custom: item.color))
                            Spacer()
                        }
                    )
                    .frame(height: 70)

                Text(item.name)
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.8))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                model.toggleStar(id: item.id)
            } label: {
                Label("Избранное", systemImage: model.starredIds.contains(item.id) ? "star.fill" : "star")
            }
        }
    }

    @ViewBuilder
    private func listItem(_ item: FileNode) -> some View {
        Button {
            if item.type == .folder {
                model.navigate(to: item.id)
            } else {
                model.selectedId = item.id
            }
        } label: {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(Color.clear)
                    .lozaMiniGlass(radius: 7, fallbackOpacity: 0.05)
                    .frame(width: 34, height: 34)
                    .overlay(
                        Image(systemName: FileIcon.icon(for: item.type))
                            .font(.system(size: 15))
                            .foregroundStyle(FileIcon.color(for: item.type, custom: item.color))
                    )

                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name)
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.85))
                        .lineLimit(1)
                    HStack(spacing: 8) {
                        if let size = item.size {
                            Text(size)
                                .font(.system(size: 10))
                                .foregroundStyle(.white.opacity(0.35))
                        }
                        Text(item.modified)
                            .font(.system(size: 10))
                            .foregroundStyle(.white.opacity(0.35))
                    }
                }
                Spacer()
                if item.type != .folder {
                    Text(item.size ?? "\(item.children?.count ?? 0) эл.")
                        .font(.system(size: 10))
                        .foregroundStyle(.white.opacity(0.25))
                        .monospacedDigit()
                } else {
                    Text("\(item.children?.count ?? 0) эл.")
                        .font(.system(size: 10))
                        .foregroundStyle(.white.opacity(0.25))
                        .monospacedDigit()
                }
            }
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                model.toggleStar(id: item.id)
            } label: {
                Label("Избранное", systemImage: model.starredIds.contains(item.id) ? "star.fill" : "star")
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "tray.full")
                .font(.system(size: 40))
                .foregroundStyle(.white.opacity(0.15))
            Text(emptyTitle)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.5))
            Text(emptySubtitle)
                .font(.system(size: 11))
                .foregroundStyle(.white.opacity(0.28))
        }
        .padding(.top, 40)
        .frame(maxWidth: .infinity)
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    private func nodeName(for id: String) -> String {
        func find(_ node: FileNode, _ target: String) -> String? {
            if node.id == target { return node.name }
            for child in node.children ?? [] {
                if let found = find(child, target) { return found }
            }
            return nil
        }
        return find(MockData.fileSystem, id) ?? id
    }

    private func systemIcon(for section: LozaSection) -> String {
        switch section {
        case .files:     return "folder"
        case .recent:    return "clock"
        case .starred:   return "star"
        case .downloads: return "arrow.down.circle"
        case .trash:     return "trash"
        }
    }

    private var emptyTitle: String {
        if !search.isEmpty { return "Ничего не найдено" }
        return section == .trash ? "Корзина пуста" : "Папка пуста"
    }

    private var emptySubtitle: String {
        if !search.isEmpty { return "По запросу «\(search)» ничего нет" }
        return section == .trash ? "Удалённые файлы будут появляться здесь" : "Здесь пока нет файлов"
    }

    private func plural(count: Int) -> String {
        let m10 = count % 10, m100 = count % 100
        if m10 == 1 && m100 != 11 { return "элемент" }
        if m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) { return "элемента" }
        return "элементов"
    }
}
