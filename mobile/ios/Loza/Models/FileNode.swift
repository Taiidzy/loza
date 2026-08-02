//
//  FileNode.swift
//  Loza
//
//  Data model + mock file tree for the "Loza" tab (mobile port of
//  pages/dashboard/tabs/LozaTab.tsx). The desktop version uses entirely
//  hardcoded mock data (MOCK_FS) — there is no file-browser backend API
//  yet, so we mirror the same mock tree here. Storage stats, however, are
//  live: read from StatusSocket.shared.status.storage.

import Foundation

// ─── Types ─────────────────────────────────────────────────────────────────────

enum FileType: String, CaseIterable {
    case folder, image, document, video, audio, archive, code, file
}

enum LozaSection: String, CaseIterable, Identifiable {
    case files      // full tree view
    case recent
    case starred
    case downloads
    case trash

    var id: String { rawValue }

    var label: String {
        switch self {
        case .files:      return "Файлы"
        case .recent:     return "Недавние"
        case .starred:    return "Избранное"
        case .downloads:  return "Загрузки"
        case .trash:      return "Корзина"
        }
    }
}

struct FileNode: Identifiable, Hashable {
    let id: String
    let name: String
    let type: FileType
    let size: String?
    let modified: String
    let ts: Int?
    let children: [FileNode]?
    let starred: Bool
    let color: String?
}

// ─── Icon + color helpers (mirror iconFor / colorFor in LozaTab.tsx) ────────────

enum FileIcon {
    static func icon(for type: FileType) -> String {
        switch type {
        case .folder:    return "folder"
        case .image:     return "photo"
        case .video:     return "play.rectangle"
        case .audio:     return "music.note"
        case .document:  return "doc.text"
        case .archive:   return "archivebox"
        case .code:      return "chevron.left.forwardslash.chevron.right"
        case .file:      return "doc"
        }
    }

    static func color(for type: FileType, custom: String? = nil) -> Color {
        if let custom { return Color(hexString: custom) }
        switch type {
        case .folder:   return Color(hex: 0x60A5FA)
        case .image:    return Color(hex: 0xF472B6)
        case .video:    return Color(hex: 0xFB923C)
        case .audio:    return Color(hex: 0x34D399)
        case .document: return Color(hex: 0xA78BFA)
        case .archive:  return Color(hex: 0xFBBF24)
        case .code:     return Color(hex: 0x22D3EE)
        case .file:     return Color(hex: 0x94A3B8)
        }
    }
}

// ─── Mock file tree (identical to MOCK_FS in LozaTab.tsx) ──────────────────────

struct MockData {
    static let fileSystem: FileNode = {
        FileNode(
            id: "root", name: "Мой диск", type: .folder, size: nil, modified: "сегодня",
            ts: nil, children: [
                FileNode(
                    id: "docs", name: "Документы", type: .folder, size: nil, modified: "2 ч назад",
                    ts: nil, children: [
                        FileNode(id: "d1", name: "Отчёт Q3.pdf", type: .document, size: "2.4 МБ", modified: "вчера", ts: 88, children: nil, starred: true, color: nil),
                        FileNode(id: "d2", name: "Договор аренды.docx", type: .document, size: "156 КБ", modified: "3 дня назад", ts: 70, children: nil, starred: false, color: nil),
                        FileNode(id: "d3", name: "Заметки.md", type: .code, size: "12 КБ", modified: "сегодня", ts: 96, children: nil, starred: false, color: nil),
                        FileNode(
                            id: "d4", name: "Архив 2023", type: .folder, size: nil, modified: "месяц назад",
                            ts: nil, children: [
                                FileNode(id: "d4-1", name: "scan_001.pdf", type: .document, size: "890 КБ", modified: "12.01.2023", ts: 10, children: nil, starred: false, color: nil),
                                FileNode(id: "d4-2", name: "scan_002.pdf", type: .document, size: "1.1 МБ", modified: "12.01.2023", ts: 11, children: nil, starred: false, color: nil),
                            ],
                            starred: false, color: "#a78bfa"
                        ),
                    ],
                    starred: false, color: "#60a5fa"
                ),
                FileNode(
                    id: "pics", name: "Изображения", type: .folder, size: nil, modified: "вчера",
                    ts: nil, children: [
                        FileNode(id: "p1", name: "vacation_01.jpg", type: .image, size: "3.2 МБ", modified: "вчера", ts: 86, children: nil, starred: false, color: nil),
                        FileNode(id: "p2", name: "vacation_02.jpg", type: .image, size: "2.8 МБ", modified: "вчера", ts: 85, children: nil, starred: false, color: nil),
                        FileNode(id: "p3", name: "screenshot.png", type: .image, size: "540 КБ", modified: "сегодня", ts: 99, children: nil, starred: false, color: nil),
                        FileNode(id: "p4", name: "avatar.webp", type: .image, size: "84 КБ", modified: "неделю назад", ts: 55, children: nil, starred: false, color: nil),
                    ],
                    starred: false, color: "#f472b6"
                ),
                FileNode(
                    id: "vid", name: "Видео", type: .folder, size: nil, modified: "неделю назад",
                    ts: nil, children: [
                        FileNode(id: "v1", name: "demo.mp4", type: .video, size: "124 МБ", modified: "неделю назад", ts: 52, children: nil, starred: false, color: nil),
                        FileNode(id: "v2", name: "tutorial.mov", type: .video, size: "312 МБ", modified: "2 недели назад", ts: 40, children: nil, starred: false, color: nil),
                    ],
                    starred: false, color: "#fb923c"
                ),
                FileNode(
                    id: "music", name: "Музыка", type: .folder, size: nil, modified: "месяц назад",
                    ts: nil, children: [
                        FileNode(id: "m1", name: "track_01.mp3", type: .audio, size: "5.2 МБ", modified: "месяц назад", ts: 25, children: nil, starred: false, color: nil),
                        FileNode(id: "m2", name: "ambient.flac", type: .audio, size: "28 МБ", modified: "месяц назад", ts: 24, children: nil, starred: false, color: nil),
                    ],
                    starred: false, color: "#34d399"
                ),
                FileNode(
                    id: "proj", name: "Проекты", type: .folder, size: nil, modified: "сегодня",
                    ts: nil, children: [
                        FileNode(
                            id: "pr1", name: "loza-app", type: .folder, size: nil, modified: "сегодня",
                            ts: nil, children: [
                                FileNode(id: "pr1-1", name: "index.tsx", type: .code, size: "8 КБ", modified: "сегодня", ts: 100, children: nil, starred: false, color: nil),
                                FileNode(id: "pr1-2", name: "styles.css", type: .code, size: "3 КБ", modified: "вчера", ts: 84, children: nil, starred: false, color: nil),
                                FileNode(id: "pr1-3", name: "package.json", type: .code, size: "1 КБ", modified: "сегодня", ts: 98, children: nil, starred: false, color: nil),
                            ],
                            starred: false, color: "#22d3ee"
                        ),
                        FileNode(id: "pr2", name: "landing.zip", type: .archive, size: "18 МБ", modified: "3 дня назад", ts: 68, children: nil, starred: false, color: nil),
                    ],
                    starred: false, color: "#fbbf24"
                ),
                FileNode(id: "f1", name: "readme.txt", type: .file, size: "2 КБ", modified: "сегодня", ts: 97, children: nil, starred: true, color: nil),
            ],
            starred: false, color: nil
        )
    }()

    /// Flattened list of all non-folder files (mirrors collectFiles + ALL_FILE).
    static let allFiles: [FileNode] = {
        func collect(_ node: FileNode) -> [FileNode] {
            guard let children = node.children else {
                return node.type == .folder ? [] : [node]
            }
            return children.flatMap { collect($0) }
        }
        return collect(fileSystem)
    }()

    /// Recent: sorted by ts descending, top 8.
    static let recent: [FileNode] = {
        allFiles
            .filter { $0.ts != nil }
            .sorted { ($0.ts ?? 0) > ($1.ts ?? 0) }
            .prefix(8)
            .map { $0 }
    }()

    /// Downloads: archives, videos, audio.
    static let downloads: [FileNode] = {
        allFiles.filter { ["archive", "video", "audio"].contains($0.type.rawValue) }
    }()
}
