import { useState, useMemo } from "react";
import styles from "./LozaTab.module.css";
import {
  Folder, File, FileText, Image as ImageIcon, Film, Music, Archive, Code2,
  Search, ChevronRight, ChevronLeft, Home, Grid3x3, List, Download, Star,
  Clock, Trash2
} from "lucide-react";
import { ServerStatus } from "../../../types/serverStatus";
import { formatBytes } from "../../../shared/utils/serverStorage";

/* ---------- Типы ---------- */
type FileType = "folder" | "image" | "document" | "video" | "audio" | "archive" | "code" | "file";
type Section = "files" | "recent" | "starred" | "downloads" | "trash";

interface FileNode {
  id: string;
  name: string;
  type: FileType;
  size?: string;
  modified: string;
  ts?: number;
  children?: FileNode[];
  starred?: boolean;
  color?: string;
}

/* ---------- Мок-данные ---------- */
const MOCK_FS: FileNode = {
  id: "root", name: "Мой диск", type: "folder", modified: "сегодня",
  children: [
    {
      id: "docs", name: "Документы", type: "folder", modified: "2 ч назад", color: "#60a5fa",
      children: [
        { id: "d1", name: "Отчёт Q3.pdf", type: "document", size: "2.4 МБ", modified: "вчера", ts: 88, starred: true },
        { id: "d2", name: "Договор аренды.docx", type: "document", size: "156 КБ", modified: "3 дня назад", ts: 70 },
        { id: "d3", name: "Заметки.md", type: "code", size: "12 КБ", modified: "сегодня", ts: 96 },
        {
          id: "d4", name: "Архив 2023", type: "folder", modified: "месяц назад", color: "#a78bfa",
          children: [
            { id: "d4-1", name: "scan_001.pdf", type: "document", size: "890 КБ", modified: "12.01.2023", ts: 10 },
            { id: "d4-2", name: "scan_002.pdf", type: "document", size: "1.1 МБ", modified: "12.01.2023", ts: 11 },
          ],
        },
      ],
    },
    {
      id: "pics", name: "Изображения", type: "folder", modified: "вчера", color: "#f472b6",
      children: [
        { id: "p1", name: "vacation_01.jpg", type: "image", size: "3.2 МБ", modified: "вчера", ts: 86 },
        { id: "p2", name: "vacation_02.jpg", type: "image", size: "2.8 МБ", modified: "вчера", ts: 85 },
        { id: "p3", name: "screenshot.png", type: "image", size: "540 КБ", modified: "сегодня", ts: 99 },
        { id: "p4", name: "avatar.webp", type: "image", size: "84 КБ", modified: "неделю назад", ts: 55 },
      ],
    },
    {
      id: "vid", name: "Видео", type: "folder", modified: "неделю назад", color: "#fb923c",
      children: [
        { id: "v1", name: "demo.mp4", type: "video", size: "124 МБ", modified: "неделю назад", ts: 52 },
        { id: "v2", name: "tutorial.mov", type: "video", size: "312 МБ", modified: "2 недели назад", ts: 40 },
      ],
    },
    {
      id: "music", name: "Музыка", type: "folder", modified: "месяц назад", color: "#34d399",
      children: [
        { id: "m1", name: "track_01.mp3", type: "audio", size: "5.2 МБ", modified: "месяц назад", ts: 25 },
        { id: "m2", name: "ambient.flac", type: "audio", size: "28 МБ", modified: "месяц назад", ts: 24 },
      ],
    },
    {
      id: "proj", name: "Проекты", type: "folder", modified: "сегодня", color: "#fbbf24",
      children: [
        {
          id: "pr1", name: "loza-app", type: "folder", modified: "сегодня", color: "#22d3ee",
          children: [
            { id: "pr1-1", name: "index.tsx", type: "code", size: "8 КБ", modified: "сегодня", ts: 100 },
            { id: "pr1-2", name: "styles.css", type: "code", size: "3 КБ", modified: "вчера", ts: 84 },
            { id: "pr1-3", name: "package.json", type: "code", size: "1 КБ", modified: "сегодня", ts: 98 },
          ],
        },
        { id: "pr2", name: "landing.zip", type: "archive", size: "18 МБ", modified: "3 дня назад", ts: 68 },
      ],
    },
    { id: "f1", name: "readme.txt", type: "file", size: "2 КБ", modified: "сегодня", ts: 97, starred: true },
  ],
};

const SECTIONS: Record<Exclude<Section, "files">, { label: string; icon: any }> = {
  recent: { label: "Недавние", icon: Clock },
  starred: { label: "Избранное", icon: Star },
  downloads: { label: "Загрузки", icon: Download },
  trash: { label: "Корзина", icon: Trash2 },
};

const QUICK_ORDER: Exclude<Section, "files">[] = ["recent", "starred", "downloads", "trash"];

/* ---------- Утилиты ---------- */
const iconFor = (type: FileType) => {
  switch (type) {
    case "folder": return Folder;
    case "image": return ImageIcon;
    case "video": return Film;
    case "audio": return Music;
    case "document": return FileText;
    case "archive": return Archive;
    case "code": return Code2;
    default: return File;
  }
};

const colorFor = (type: FileType, custom?: string) => {
  if (custom) return custom;
  switch (type) {
    case "folder": return "#60a5fa";
    case "image": return "#f472b6";
    case "video": return "#fb923c";
    case "audio": return "#34d399";
    case "document": return "#a78bfa";
    case "archive": return "#fbbf24";
    case "code": return "#22d3ee";
    default: return "#94a3b8";
  }
};

const collectFiles = (node: FileNode, acc: FileNode[] = []): FileNode[] => {
  for (const c of node.children ?? []) {
    if (c.type === "folder") collectFiles(c, acc);
    else acc.push(c);
  }
  return acc;
};

const ALL_FILES = collectFiles(MOCK_FS);
const RECENT = [...ALL_FILES].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)).slice(0, 8);
const DOWNLOADS = ALL_FILES.filter((f) => ["archive", "video", "audio"].includes(f.type));

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

const MUTED = "var(--color-text-muted)";
const SECONDARY = "var(--color-text-secondary)";

/* ---------- Компонент ---------- */
export default function LozaTab({ status }: { status: ServerStatus | null }) {
  const [currentPath, setCurrentPath] = useState<string[]>(["root"]);
  const [section, setSection] = useState<Section>("files");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [starredIds, setStarredIds] = useState<Set<string>>(
    () => new Set(ALL_FILES.filter((f) => f.starred).map((f) => f.id))
  );

  const storage = status!.storage;
  const usedPercent = storage.totalBytes > 0 ? Math.min(100, Math.round((storage.usedBytes / storage.totalBytes) * 100)) : 0;

  const findNode = (path: string[]): FileNode => {
    let node = MOCK_FS;
    for (let i = 1; i < path.length; i++) {
      const child = node.children?.find((c) => c.id === path[i]);
      if (!child) break;
      node = child;
    }
    return node;
  };

  const currentNode = useMemo(() => findNode(currentPath), [currentPath]);

  const baseItems = useMemo(() => {
    switch (section) {
      case "recent": return RECENT;
      case "starred": return ALL_FILES.filter((f) => starredIds.has(f.id));
      case "downloads": return DOWNLOADS;
      case "trash": return [];
      default: return currentNode.children ?? [];
    }
  }, [section, currentNode, starredIds]);

  const items = useMemo(() => {
    if (!search.trim()) return baseItems;
    const q = search.toLowerCase();
    return baseItems.filter((c) => c.name.toLowerCase().includes(q));
  }, [baseItems, search]);

  const toggleStar = (id: string) =>
    setStarredIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const select = (id: string) => {
    setSelectedId(id);
  };

  const navigate = (node: FileNode) => {
    if (node.type === "folder" && section === "files") {
      setCurrentPath([...currentPath, node.id]);
      setSelectedId(null);
      setSearch("");
    } else {
      select(node.id);
    }
  };

  const goTo = (index: number) => {
    setCurrentPath(currentPath.slice(0, index + 1));
    setSelectedId(null);
    setSearch("");
  };

  const switchSection = (s: Section) => {
    setSection(s);
    setSelectedId(null);
    setSearch("");
  };

  const sectionTitle = section === "files" ? currentNode.name : SECTIONS[section].label;

  const counts: Record<string, number> = {
    recent: RECENT.length,
    starred: starredIds.size,
    downloads: DOWNLOADS.length,
    trash: 0,
  };

  return (
    <div
      className={styles.root}
      style={{
        gridTemplateColumns: collapsed ? "68px 1fr" : "260px 1fr",
        transition: "grid-template-columns 0.25s var(--ease-standard)",
      }}
    >
      {/* ---------- Sidebar ---------- */}
      <aside className={styles.sidebar}>
        <div className={styles.userBadge}>
          <button
            className={styles.toggleBtn}
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? "Развернуть панель" : "Свернуть панель"}
          >
            <ChevronLeft
              size={16}
              style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 0.25s" }}
            />
          </button>
        </div>
        <nav className={styles.nav} style={{ overflowY: "auto" }}>
          {!collapsed && <div className={styles.navLabel}>Быстрый доступ</div>}
          {QUICK_ORDER.map((id) => {
            const q = SECTIONS[id];
            return (
              <button
                key={id}
                title={q.label}
                className={`${styles.navItem} ${section === id ? styles.active : ""}`}
                style={collapsed ? { justifyContent: "center", padding: "10px 0" } : undefined}
                onClick={() => switchSection(id)}
              >
                <q.icon size={16} />
                {!collapsed && (
                  <>
                    <span>{q.label}</span>
                    {counts[id] > 0 && (
                      <span style={{ marginLeft: "auto", fontSize: 10, color: MUTED }}>{counts[id]}</span>
                    )}
                  </>
                )}
              </button>
            );
          })}
          {!collapsed && (
            <>
              <div className={`${styles.navLabel} ${styles.navLabelTop}`}>Папки</div>
              <Tree
                node={MOCK_FS}
                path={["root"]}
                currentPath={section === "files" ? currentPath : []}
                onNavigate={(path) => {
                  setSection("files");
                  setCurrentPath(path);
                  setSelectedId(null);
                  setSearch("");
                }}
              />
            </>
          )}
        </nav>
        <div className={styles.storage}>
          {!collapsed && (
            <>
              <div className={styles.storageRow}>
                <span>Хранилище</span>
                <span className={styles.storagePct}>{usedPercent}%</span>
              </div>
              <div className={styles.storageSegments}>
                {storage.categories.map(category => (
                  <div
                    key={category.id}
                    className={styles.storageSegment}
                    style={{
                      flex: category.bytes,
                      background: category.color,
                    }}
                  />
                ))}
              </div>
              {/* Tooltip вынесен из storageSegments, чтобы не обрезаться из-за overflow: hidden */}
              <div className={styles.storageTooltip}>
                <strong>
                  {formatBytes(storage.usedBytes)}
                  {" / "}
                  {formatBytes(storage.totalBytes)}
                </strong>
                {storage.categories.map(cat => (
                  <div
                    key={cat.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: 6,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: cat.color,
                        }}
                      />
                      {cat.label}
                    </span>
                    <span>{formatBytes(cat.bytes)}</span>
                  </div>
                ))}
              </div>
              <div className={styles.storageSub}>
                {formatBytes(storage.usedBytes)} из {formatBytes(storage.totalBytes)}
              </div>
            </>
          )}
        </div>
      </aside>

      {/* ---------- Main ---------- */}
      <main className={styles.main}>
        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.breadcrumbs}>
            {section === "files" ? (
              currentPath.map((id, idx) => {
                const node = findNode(currentPath.slice(0, idx + 1));
                return (
                  <div key={id} className={styles.crumb}>
                    {idx > 0 && <ChevronRight size={14} className={styles.crumbSep} />}
                    <button
                      onClick={() => goTo(idx)}
                      className={`${styles.crumbBtn} ${idx === currentPath.length - 1 ? styles.crumbActive : ""}`}
                    >
                      {idx === 0 ? <Home size={14} /> : null}
                      {node.name}
                    </button>
                  </div>
                );
              })
            ) : (
              <>
                <div className={styles.crumb}>
                  <button className={styles.crumbBtn} onClick={() => switchSection("files")}>
                    <Home size={14} /> Мой диск
                  </button>
                </div>
                <div className={styles.crumb}>
                  <ChevronRight size={14} className={styles.crumbSep} />
                  <span className={`${styles.crumbBtn} ${styles.crumbActive}`}>{sectionTitle}</span>
                </div>
              </>
            )}
          </div>
          <div className={styles.toolbarRight}>
            <div className={styles.search}>
              <Search size={14} className={styles.searchIcon} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={section === "files" ? "Поиск в текущей папке…" : "Поиск файлов…"}
                className={styles.searchInput}
              />
            </div>
            <div className={styles.viewToggle}>
              <button
                className={`${styles.viewBtn} ${viewMode === "grid" ? styles.viewBtnActive : ""}`}
                onClick={() => setViewMode("grid")}
                title="Сетка"
              >
                <Grid3x3 size={15} />
              </button>
              <button
                className={`${styles.viewBtn} ${viewMode === "list" ? styles.viewBtnActive : ""}`}
                onClick={() => setViewMode("list")}
                title="Список"
              >
                <List size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className={styles.body}>
          <div className={styles.cardLabel}>
            {sectionTitle} · {items.length} {plural(items.length, "элемент", "элемента", "элементов")}
          </div>
          {items.length === 0 ? (
            <EmptyState
              title={
                search ? "Ничего не найдено"
                : section === "trash" ? "Корзина пуста"
                : section === "starred" ? "Нет избранных файлов"
                : "Папка пуста"
              }
              sub={
                search ? `По запросу «${search}» ничего нет`
                : section === "trash" ? "Удалённые файлы будут появляться здесь"
                : section === "starred" ? "Отметьте файл звёздочкой — он появится здесь"
                : "Здесь пока нет файлов"
              }
            />
          ) : viewMode === "grid" ? (
            <div className={styles.panel}>
              <div className={styles.grid}>
                {items.map((item) => (
                  <GridItem
                    key={item.id}
                    item={item}
                    selected={selectedId === item.id}
                    starred={starredIds.has(item.id)}
                    onClick={() => select(item.id)}
                    onOpen={() => navigate(item)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.list}>
              <div className={styles.listHead}>
                <div>Имя</div>
                <div>Изменён</div>
                <div>Размер</div>
                <div />
              </div>
              {items.map((item) => (
                <ListItem
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  starred={starredIds.has(item.id)}
                  onClick={() => select(item.id)}
                  onOpen={() => navigate(item)}
                  onStar={() => toggleStar(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ---------- Дерево папок ---------- */
function Tree({
  node, path, currentPath, onNavigate, depth = 0,
}: {
  node: FileNode;
  path: string[];
  currentPath: string[];
  onNavigate: (path: string[]) => void;
  depth?: number;
}) {
  const folders = (node.children ?? []).filter((c) => c.type === "folder");
  if (folders.length === 0 && depth > 0) return null;

  const isActive =
    currentPath.length === path.length && currentPath.every((p, i) => p === path[i]);
  const isAncestor =
    currentPath.length > path.length && path.every((p, i) => currentPath[i] === p);

  return (
    <div>
      {depth > 0 && (
        <button
          onClick={() => onNavigate(path)}
          className={`${styles.treeItem} ${isActive ? styles.treeItemActive : ""} ${isAncestor ? styles.treeItemAncestor : ""}`}
          style={{ paddingLeft: `${12 + (depth - 1) * 14}px` }}
        >
          <Folder size={14} style={{ color: node.color ?? "#60a5fa" }} />
          <span className={styles.treeLabel}>{node.name}</span>
        </button>
      )}
      <div>
        {folders.map((f) => (
          <Tree
            key={f.id}
            node={f}
            path={[...path, f.id]}
            currentPath={currentPath}
            onNavigate={onNavigate}
            depth={depth + 1}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------- Элемент сетки ---------- */
function GridItem({
  item, selected, starred, onClick, onOpen,
}: {
  item: FileNode;
  selected: boolean;
  starred: boolean;
  onClick: () => void;
  onOpen: () => void;
}) {
  const Icon = iconFor(item.type);
  const color = colorFor(item.type, item.color);

  return (
    <div
      className={`${styles.gridItem} ${selected ? styles.gridItemSelected : ""}`}
      onClick={onClick}
      onDoubleClick={onOpen}
    >
      <div className={styles.gridThumb} style={{ "--thumb-color": color } as React.CSSProperties}>
        <Icon size={30} strokeWidth={1.4} />
        {starred && <Star size={12} className={styles.gridStar} fill="currentColor" />}
      </div>
      <div className={styles.gridName} title={item.name}>{item.name}</div>
      <div className={styles.gridMeta}>{item.size ?? `${item.children?.length ?? 0} эл.`}</div>
    </div>
  );
}

/* ---------- Элемент списка ---------- */
function ListItem({
  item, selected, starred, onClick, onOpen, onStar,
}: {
  item: FileNode;
  selected: boolean;
  starred: boolean;
  onClick: () => void;
  onOpen: () => void;
  onStar: () => void;
}) {
  const Icon = iconFor(item.type);
  const color = colorFor(item.type, item.color);

  return (
    <div
      className={`${styles.listRow} ${selected ? styles.listRowSelected : ""}`}
      onClick={onClick}
      onDoubleClick={onOpen}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <div
          style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            display: "grid", placeItems: "center", color,
            background: `color-mix(in srgb, ${color} 14%, transparent)`,
          }}
        >
          <Icon size={15} strokeWidth={1.6} />
        </div>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </span>
      </div>
      <div style={{ color: SECONDARY }}>{item.modified}</div>
      <div style={{ color: SECONDARY }}>{item.size ?? `${item.children?.length ?? 0} эл.`}</div>
      <div>
        <button
          className={styles.viewBtn}
          style={{ width: 26, height: 24 }}
          title="Избранное"
          onClick={(e) => { e.stopPropagation(); onStar(); }}
        >
          <Star
            size={13}
            fill={starred ? "currentColor" : "none"}
            style={{ color: starred ? "var(--color-warning)" : undefined }}
          />
        </button>
      </div>
    </div>
  );
}

/* ---------- Пустое состояние ---------- */
function EmptyState({ title, sub }: { title: string; sub: string }) {
  return (
    <div
      className={styles.panel}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "44px 20px" }}
    >
      <Folder size={42} strokeWidth={1.1} style={{ color: MUTED }} />
      <div style={{ fontSize: 13, fontWeight: 600, color: SECONDARY, marginTop: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: MUTED }}>{sub}</div>
    </div>
  );
}