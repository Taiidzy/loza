import { useState, useMemo, useRef, useEffect } from "react";
import styles from "./LozaTab.module.css";
import {
  Folder,
  File,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  Code2,
  Search,
  ChevronRight,
  Home,
  Grid3x3,
  List,
  Download,
  Star,
  Clock,
  Trash2,
  HardDrive,
  MoreVertical,
  ArrowUp,
  Eye,
  Info,
} from "lucide-react";

/* ---------- Типы ---------- */
type FileType = "folder" | "image" | "document" | "video" | "audio" | "archive" | "code" | "file";

interface FileNode {
  id: string;
  name: string;
  type: FileType;
  size?: string;
  modified: string;
  children?: FileNode[];
  starred?: boolean;
  color?: string;
}

/* ---------- Мок-данные ---------- */
const MOCK_FS: FileNode = {
  id: "root",
  name: "Мой диск",
  type: "folder",
  modified: "сегодня",
  children: [
    {
      id: "docs",
      name: "Документы",
      type: "folder",
      modified: "2 ч назад",
      color: "#60a5fa",
      children: [
        { id: "d1", name: "Отчёт Q3.pdf", type: "document", size: "2.4 МБ", modified: "вчера", starred: true },
        { id: "d2", name: "Договор аренды.docx", type: "document", size: "156 КБ", modified: "3 дня назад" },
        { id: "d3", name: "Заметки.md", type: "code", size: "12 КБ", modified: "сегодня" },
        { id: "d4", name: "Архив 2023", type: "folder", modified: "месяц назад", color: "#a78bfa", children: [
          { id: "d4-1", name: "scan_001.pdf", type: "document", size: "890 КБ", modified: "12.01.2023" },
          { id: "d4-2", name: "scan_002.pdf", type: "document", size: "1.1 МБ", modified: "12.01.2023" },
        ]},
      ],
    },
    {
      id: "pics",
      name: "Изображения",
      type: "folder",
      modified: "вчера",
      color: "#f472b6",
      children: [
        { id: "p1", name: "vacation_01.jpg", type: "image", size: "3.2 МБ", modified: "вчера" },
        { id: "p2", name: "vacation_02.jpg", type: "image", size: "2.8 МБ", modified: "вчера" },
        { id: "p3", name: "screenshot.png", type: "image", size: "540 КБ", modified: "сегодня" },
        { id: "p4", name: "avatar.webp", type: "image", size: "84 КБ", modified: "неделю назад" },
      ],
    },
    {
      id: "vid",
      name: "Видео",
      type: "folder",
      modified: "неделю назад",
      color: "#fb923c",
      children: [
        { id: "v1", name: "demo.mp4", type: "video", size: "124 МБ", modified: "неделю назад" },
        { id: "v2", name: "tutorial.mov", type: "video", size: "312 МБ", modified: "2 недели назад" },
      ],
    },
    {
      id: "music",
      name: "Музыка",
      type: "folder",
      modified: "месяц назад",
      color: "#34d399",
      children: [
        { id: "m1", name: "track_01.mp3", type: "audio", size: "5.2 МБ", modified: "месяц назад" },
        { id: "m2", name: "ambient.flac", type: "audio", size: "28 МБ", modified: "месяц назад" },
      ],
    },
    {
      id: "proj",
      name: "Проекты",
      type: "folder",
      modified: "сегодня",
      color: "#fbbf24",
      children: [
        { id: "pr1", name: "loza-app", type: "folder", modified: "сегодня", color: "#22d3ee", children: [
          { id: "pr1-1", name: "index.tsx", type: "code", size: "8 КБ", modified: "сегодня" },
          { id: "pr1-2", name: "styles.css", type: "code", size: "3 КБ", modified: "вчера" },
          { id: "pr1-3", name: "package.json", type: "code", size: "1 КБ", modified: "сегодня" },
        ]},
        { id: "pr2", name: "landing.zip", type: "archive", size: "18 МБ", modified: "3 дня назад" },
      ],
    },
    { id: "f1", name: "readme.txt", type: "file", size: "2 КБ", modified: "сегодня", starred: true },
  ],
};

const QUICK_ACCESS = [
  { id: "recent", label: "Недавние", icon: Clock },
  { id: "starred", label: "Избранное", icon: Star },
  { id: "downloads", label: "Загрузки", icon: Download },
  { id: "trash", label: "Корзина", icon: Trash2 },
];

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

/* ---------- Компонент ---------- */
export default function LozaTab() {
  const [currentPath, setCurrentPath] = useState<string[]>(["root"]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [previewOpen, setPreviewOpen] = useState(true);

  // Найти узел по пути
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

  // Отфильтрованные элементы
  const items = useMemo(() => {
    const children = currentNode.children ?? [];
    if (!search.trim()) return children;
    const q = search.toLowerCase();
    return children.filter((c) => c.name.toLowerCase().includes(q));
  }, [currentNode, search]);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId]
  );

  const navigate = (node: FileNode) => {
    if (node.type === "folder") {
      setCurrentPath([...currentPath, node.id]);
      setSelectedId(null);
      setSearch("");
    } else {
      setSelectedId(node.id);
    }
  };

  const goTo = (index: number) => {
    setCurrentPath(currentPath.slice(0, index + 1));
    setSelectedId(null);
    setSearch("");
  };

  return (
    <div className={styles.root}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandLogo}>
            <HardDrive size={18} />
          </div>
          <div>
            <div className={styles.brandTitle}>Loza Drive</div>
            <div className={styles.brandSub}>128 ГБ свободно</div>
          </div>
        </div>

        <nav className={styles.nav}>
          <div className={styles.navLabel}>Быстрый доступ</div>
          {QUICK_ACCESS.map((q) => (
            <button key={q.id} className={styles.navItem}>
              <q.icon size={16} />
              <span>{q.label}</span>
            </button>
          ))}

          <div className={`${styles.navLabel} ${styles.navLabelTop}`}>Папки</div>
          <Tree
            node={MOCK_FS}
            path={["root"]}
            currentPath={currentPath}
            onNavigate={(path) => {
              setCurrentPath(path);
              setSelectedId(null);
              setSearch("");
            }}
          />
        </nav>

        <div className={styles.storage}>
          <div className={styles.storageRow}>
            <span>Хранилище</span>
            <span className={styles.storagePct}>62%</span>
          </div>
          <div className={styles.storageBar}>
            <div className={styles.storageFill} style={{ width: "62%" }} />
          </div>
          <div className={styles.storageSub}>78.2 ГБ из 128 ГБ</div>
        </div>
      </aside>

      {/* Main */}
      <main className={styles.main}>
        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.breadcrumbs}>
            {currentPath.map((id, idx) => {
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
            })}
          </div>

          <div className={styles.toolbarRight}>
            <div className={styles.search}>
              <Search size={14} className={styles.searchIcon} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск в текущей папке…"
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

        {/* Content */}
        <div className={styles.contentWrap}>
          <div className={styles.content}>
            {currentPath.length > 1 && (
              <button
                className={styles.backBtn}
                onClick={() => goTo(currentPath.length - 2)}
              >
                <ArrowUp size={14} />
                Назад
              </button>
            )}

            {items.length === 0 ? (
              <div className={styles.empty}>
                <Folder size={48} strokeWidth={1} />
                <div className={styles.emptyTitle}>Папка пуста</div>
                <div className={styles.emptySub}>
                  {search ? "Ничего не найдено по вашему запросу" : "Здесь пока нет файлов"}
                </div>
              </div>
            ) : viewMode === "grid" ? (
              <div className={styles.grid}>
                {items.map((item) => (
                  <GridItem
                    key={item.id}
                    item={item}
                    selected={selectedId === item.id}
                    onClick={() => setSelectedId(item.id)}
                    onOpen={() => navigate(item)}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.list}>
                <div className={styles.listHead}>
                  <div className={styles.listColName}>Имя</div>
                  <div className={styles.listCol}>Изменён</div>
                  <div className={styles.listCol}>Размер</div>
                  <div className={styles.listCol}></div>
                </div>
                {items.map((item) => (
                  <ListItem
                    key={item.id}
                    item={item}
                    selected={selectedId === item.id}
                    onClick={() => setSelectedId(item.id)}
                    onOpen={() => navigate(item)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Preview */}
          {previewOpen && selected && (
            <Preview item={selected} onClose={() => setPreviewOpen(false)} />
          )}
        </div>

        {/* Status bar */}
        <div className={styles.statusbar}>
          <div>{items.length} элементов</div>
          <div className={styles.statusDot} />
          <div>{currentNode.name}</div>
        </div>
      </main>
    </div>
  );
}

/* ---------- Дерево папок ---------- */
function Tree({
  node,
  path,
  currentPath,
  onNavigate,
  depth = 0,
}: {
  node: FileNode;
  path: string[];
  currentPath: string[];
  onNavigate: (path: string[]) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const folders = (node.children ?? []).filter((c) => c.type === "folder");
  if (folders.length === 0 && depth > 0) return null;

  const isActive =
    currentPath.length === path.length &&
    currentPath.every((p, i) => p === path[i]);

  const isAncestor =
    currentPath.length > path.length &&
    path.every((p, i) => currentPath[i] === p);

  return (
    <div>
      {depth > 0 && (
        <button
          onClick={() => onNavigate(path)}
          className={`${styles.treeItem} ${isActive ? styles.treeItemActive : ""} ${
            isAncestor ? styles.treeItemAncestor : ""
          }`}
          style={{ paddingLeft: `${12 + (depth - 1) * 14}px` }}
        >
          <Folder size={14} style={{ color: node.color ?? "#60a5fa" }} />
          <span className={styles.treeLabel}>{node.name}</span>
        </button>
      )}
      {(open || depth === 0) && (
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
      )}
    </div>
  );
}

/* ---------- Элемент сетки ---------- */
function GridItem({
  item,
  selected,
  onClick,
  onOpen,
}: {
  item: FileNode;
  selected: boolean;
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
      <div className={styles.gridThumb} style={{ ["--thumb-color" as any]: color }}>
        <Icon size={32} strokeWidth={1.5} />
        {item.starred && <Star size={12} className={styles.gridStar} fill="currentColor" />}
      </div>
      <div className={styles.gridName} title={item.name}>{item.name}</div>
      <div className={styles.gridMeta}>{item.size ?? `${(item.children?.length ?? 0)} эл.`}</div>
    </div>
  );
}

/* ---------- Элемент списка ---------- */
function ListItem({
  item,
  selected,
  onClick,
  onOpen,
}: {
  item: FileNode;
  selected: boolean;
  onClick: () => void;
  onOpen: () => void;
}) {
  const Icon = iconFor(item.type);
  const color = colorFor(item.type, item.color);

  return (
    <div
      className={`${styles.listRow} ${selected ? styles.listRowSelected : ""}`}
      onClick={onClick}
      onDoubleClick={onOpen}
    >
      <div className={styles.listColName}>
        <div className={styles.listIcon} style={{ ["--thumb-color" as any]: color }}>
          <Icon size={16} strokeWidth={1.6} />
        </div>
        <span className={styles.listName}>{item.name}</span>
        {item.starred && <Star size={12} className={styles.listStar} fill="currentColor" />}
      </div>
      <div className={styles.listCol}>{item.modified}</div>
      <div className={styles.listCol}>{item.size ?? `${(item.children?.length ?? 0)} эл.`}</div>
      <div className={styles.listCol}>
        <button className={styles.moreBtn} onClick={(e) => e.stopPropagation()}>
          <MoreVertical size={14} />
        </button>
      </div>
    </div>
  );
}

/* ---------- Превью ---------- */
function Preview({ item, onClose }: { item: FileNode; onClose: () => void }) {
  const Icon = iconFor(item.type);
  const color = colorFor(item.type, item.color);

  return (
    <aside className={styles.preview}>
      <div className={styles.previewHead}>
        <div className={styles.previewTitle}>Сведения</div>
        <button className={styles.previewClose} onClick={onClose}>×</button>
      </div>
      <div className={styles.previewThumb} style={{ ["--thumb-color" as any]: color }}>
        <Icon size={56} strokeWidth={1.2} />
      </div>
      <div className={styles.previewName}>{item.name}</div>
      <div className={styles.previewType}>{item.type === "folder" ? "Папка" : item.type}</div>

      <div className={styles.previewMeta}>
        <Row label="Размер" value={item.size ?? `${(item.children?.length ?? 0)} элементов`} />
        <Row label="Изменён" value={item.modified} />
        <Row label="Тип" value={item.type} />
        <Row label="Избранное" value={item.starred ? "Да" : "Нет"} />
      </div>

      <div className={styles.previewActions}>
        <button className={styles.actionBtn}>
          <Eye size={14} /> Открыть
        </button>
        <button className={styles.actionBtn}>
          <Info size={14} /> Подробнее
        </button>
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metaRow}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}