import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import styles from "./LozaTab.module.css";
import { FileInfo } from "../../../types/files";
import { fileApi } from "../../../api/filesService";
import { logger } from "../../../shared/utils/logger";
import { formatBytes } from "../../../shared/utils/serverStorage";
import {
  Folder, File as FileIcon, FileText, Image as ImageIcon, Film, Music, Archive, Code2,
  Search, ChevronRight, Home, Grid3x3, List, Upload, Download,
  MoreVertical, FolderPlus, Edit3, Copy, Trash2, Plus,
  ArrowLeft, ArrowRight, ArrowUp, RefreshCw,
  Eye, Share2, FolderOpen, Scissors, ClipboardPaste,
} from "lucide-react";
import { useOperationQueue } from "../../../components/files/OperationQueue";
import OperationQueueList from "../../../components/files/OperationQueue";
import FileViewer from "../../../components/files/FileViewer";
import { listen } from "@tauri-apps/api/event";

const SECONDARY = "var(--color-text-secondary)";
const PRIMARY = "var(--color-text-primary)";
const MUTED = "var(--color-text-muted)";

const FILE_CHANGE_EVENT = "file-change";

const iconFor = (file: FileInfo): any => {
  if (file.isDir) return Folder;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (["jpg","jpeg","png","gif","webp","bmp","svg","avif"].includes(ext)) return ImageIcon;
  if (["mp4","webm","mov","avi","mkv"].includes(ext)) return Film;
  if (["mp3","wav","ogg","flac","m4a"].includes(ext)) return Music;
  if (["zip","tar","gz","7z","rar"].includes(ext)) return Archive;
  if (["txt","md","json","yaml","yml","toml","ini","csv","xml","html","css","js","ts","jsx","tsx","py","rs","go","c","cpp","h","hpp","sh","log"].includes(ext)) return Code2;
  if (["pdf","doc","docx","xls","xlsx","ppt","pptx"].includes(ext)) return FileText;
  return FileIcon;
};

const colorFor = (file: FileInfo): string => {
  if (file.isDir) return "#60a5fa";
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    jpg:"#f472b6",jpeg:"#f472b6",png:"#f472b6",gif:"#f472b6",webp:"#f472b6",avif:"#f472b6",svg:"#f472b6",
    mp4:"#fb923c",webm:"#fb923c",mov:"#fb923c",avi:"#fb923c",mkv:"#fb923c",
    mp3:"#34d39f",wav:"#34d39f",ogg:"#34d39f",flac:"#34d39f",m4a:"#34d39f",
    zip:"#fbbf24",gz:"#fbbf24",tar:"#fbbf24","7z":"#fbbf24",rar:"#fbbf24",
    pdf:"#ef4444",json:"#60a5fa",md:"#34d39f",rs:"#ea5818",go:"#00add8",
    py:"#3776ab",js:"#f7df1e",ts:"#f7df1e",jsx:"#f7df1e",tsx:"#f7df1e",
    html:"#e34c26",htm:"#e34c26",css:"#1572b6",xml:"#f472b6",
  };
  return map[ext] || "#94a3b8";
};

const formatTimeAgo = (iso: string): string => {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (m < 1) return "только что";
    if (m < 60) return `${m} мин назад`;
    if (h < 24) return `${h} ч назад`;
    if (days < 7) return `${days} дн назад`;
    return d.toLocaleDateString("ru-RU");
  } catch {
    return iso;
  }
};

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className={styles.grid}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.gridItem}>
          <div className={styles.gridThumb} style={{ "--thumb-color": "#64748b" } as any}>
            <div style={{ width: 24, height: 24, opacity: 0.3 }} />
          </div>
          <div style={{ height: 12, background: "var(--color-glass-surface)", borderRadius: 4, width: "80%", margin: "4px auto" }} />
          <div style={{ height: 10, background: "var(--color-glass-surface)", borderRadius: 4, width: "50%", margin: "2px auto" }} />
        </div>
      ))}
    </div>
  );
}

function buildBreadcrumbs(currentPath: string): { name: string; path: string }[] {
  const crumbs: { name: string; path: string }[] = [{ name: "Мой диск", path: "" }];
  if (currentPath) {
    const parts = currentPath.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      crumbs.push({ name: part, path: acc });
    }
  }
  return crumbs;
}

// ── Clipboard manager for move/copy ──────────────────────────────────────

type ClipboardEntry = { operation: "move" | "copy"; paths: string[] };
const clipboard: { current: ClipboardEntry | null } = { current: null };

export default function LozaTab() {
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<FileInfo[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileInfo | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ item: FileInfo; x: number; y: number } | null>(null);
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newMenuButtonRef = useRef<HTMLDivElement>(null);
  const [newMenuPos, setNewMenuPos] = useState<{ top: number; left: number } | null>(null);

  const [inputModal, setInputModal] = useState<{
    type: "folder" | "file";
    title: string;
    placeholder: string;
    onConfirm: (name: string) => void;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const navHistoryRef = useRef<string[]>([""]);
  const navIndexRef = useRef(0);
  const loadRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  const { operations, uploadFile, downloadFile, cancelOperation, removeOperation, retry } = useOperationQueue();

  // ── Navigation history with React state ──────────────────────────────

  const updateNavButtons = useCallback(() => {
    setCanGoBack(navIndexRef.current > 0);
    setCanGoForward(navIndexRef.current < navHistoryRef.current.length - 1);
  }, []);

  const pushHistory = useCallback((path: string) => {
    navHistoryRef.current = navHistoryRef.current.slice(0, navIndexRef.current + 1);
    navHistoryRef.current.push(path);
    navIndexRef.current = navHistoryRef.current.length - 1;
    updateNavButtons();
  }, [updateNavButtons]);

  const goBack = () => {
    if (navIndexRef.current > 0) {
      navIndexRef.current -= 1;
      handleNavigate(navHistoryRef.current[navIndexRef.current], false);
    }
  };

  const goForward = () => {
    if (navIndexRef.current < navHistoryRef.current.length - 1) {
      navIndexRef.current += 1;
      handleNavigate(navHistoryRef.current[navIndexRef.current], false);
    }
  };

  const goUp = () => {
    if (currentPath) {
      const parent = currentPath.substring(0, currentPath.lastIndexOf("/"));
      handleNavigate(parent);
    }
  };

  // ── Global keyboard shortcuts ─�───────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (inputModal) { setInputModal(null); return; }
      if (showNewMenu) { setShowNewMenu(false); return; }
      if (contextMenu) { setContextMenu(null); return; }
      if (renameTarget) { setRenameTarget(null); setRenameValue(""); return; }
      if (previewFile) { setPreviewFile(null); return; }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [inputModal, showNewMenu, contextMenu, renameTarget, previewFile]);

  // Close new menu on window resize
  useEffect(() => {
    const onResize = () => { if (showNewMenu) setShowNewMenu(false); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [showNewMenu]);

  // ── Load files ────────────────────────────────────────────────────────

  const loadFiles = useCallback(async (path: string) => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fileApi.listFiles(path);
      if (requestId !== loadRequestRef.current || currentPathRef.current !== path) return;
      setFiles(result);
      setSelectedIds((previous) => new Set(
        [...previous].filter((id) => result.some((file) => file.id === id)),
      ));
    } catch (e: any) {
      if (requestId !== loadRequestRef.current || currentPathRef.current !== path) return;
      const msg = e?.message || "Failed to load files";
      setError(msg);
      logger.error("files", "loadFiles error", e);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, []);

  // File operations are HTTP-authoritative; WebSocket pushes are only an
  // invalidation signal. Reloading from the server avoids duplicate local
  // optimistic state and handles messages without a single `path` (rename).
  useEffect(() => {
    let refreshTimer: number | undefined;
    const unlisten = listen(FILE_CHANGE_EVENT, () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => loadFiles(currentPath), 100);
    });
    return () => {
      window.clearTimeout(refreshTimer);
      void unlisten.then((stop) => stop());
    };
  }, [currentPath, loadFiles]);

  useEffect(() => {
    loadFiles(currentPath);
  }, [loadFiles, currentPath]);

  // ── Search with debounce ─────────────────────────────────────────────

  useEffect(() => {
    if (!search.trim()) {
      searchRequestRef.current += 1;
      setSearchResults(null);
      return;
    }

    const timer = setTimeout(async () => {
      const requestId = ++searchRequestRef.current;
      setSearchResults(null);
      try {
        const results = await fileApi.searchFiles(search, currentPath);
        if (requestId !== searchRequestRef.current) return;
        setSearchResults(results);
      } catch (e: any) {
        if (requestId !== searchRequestRef.current) return;
        logger.error("files", "Search failed", e);
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [search, currentPath]);

  useEffect(() => {
    updateNavButtons();
  }, [currentPath, updateNavButtons]);

  const breadcrumbs = buildBreadcrumbs(currentPath);

  useLayoutEffect(() => {
    if (showNewMenu && newMenuButtonRef.current) {
      const rect = newMenuButtonRef.current.getBoundingClientRect();
      const menuWidth = 180;
      const menuHeight = 80;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      let left = rect.left;
      let top = rect.bottom + 8;
      
      if (left + menuWidth > viewportWidth - 16) {
        left = viewportWidth - menuWidth - 16;
      }
      if (left < 16) left = 16;
      if (top + menuHeight > viewportHeight - 16) {
        top = rect.top - menuHeight - 8;
      }
      if (top < 16) top = 16;
      
      setNewMenuPos({ top, left });
    } else {
      setNewMenuPos(null);
    }
  }, [showNewMenu]);

  // ── Filtering & sorting ───────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, search]);

  const sorted = useMemo(() => {
    const source = searchResults !== null ? searchResults : filtered;
    return [...source].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [filtered, searchResults]);

  // ── Navigation ───────────────────────────────────────────────────────

  const handleNavigate = useCallback((path: string, addToHistory = true) => {
    if (path === currentPath) return;
    if (addToHistory) pushHistory(path);
    setCurrentPath(path);
    setSearch("");
    setSearchResults(null);
    setShowNewMenu(false);
    setContextMenu(null);
    setRenameTarget(null);
    setPreviewFile(null);
    setSelectedIds(new Set());
    setError(null);
  }, [currentPath, pushHistory]);

  // ── Selection ──────────────────────────────────────────────────────────

  const clearSelection = () => setSelectedIds(new Set());

  const handleContextMenu = (e: React.MouseEvent, item: FileInfo) => {
    e.preventDefault();
    if (!selectedIds.has(item.id)) setSelectedIds(new Set([item.id]));
    setContextMenu({ item, x: e.clientX, y: e.clientY });
  };

  const handleSelection = (file: FileInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    const id = file.id;

    if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else if (e.shiftKey && selectedIds.size > 0) {
      // Find the last selected index and select range
      const sortedIds = sorted.map((f) => f.id);
      const lastSelectedId = Array.from(selectedIds).pop() || id;
      const lastIndex = sortedIds.indexOf(lastSelectedId);
      const currentIndex = sortedIds.indexOf(id);

      if (lastIndex >= 0 && currentIndex >= 0) {
        const [start, end] = [Math.min(lastIndex, currentIndex), Math.max(lastIndex, currentIndex)];
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) {
            next.add(sortedIds[i]);
          }
          return next;
        });
      }
    } else {
      setSelectedIds(new Set([id]));
    }
  };

  // ── File operations ───────────────────────────────────────────────────

  const handleDoubleClick = (file: FileInfo) => {
    if (file.isDir) {
      handleNavigate(file.path);
    } else {
      setPreviewFile(file);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove(styles.dragOver);
    const items = e.dataTransfer.files;
    if (!items || items.length === 0) return;
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      if (f.type.startsWith("directory/")) continue;
      try {
        await uploadFile({ path: currentPath, filename: f.name, file: f as File });
      } catch (e: any) {
        logger.error("files", "Upload failed", e);
      }
    }
    loadFiles(currentPath);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add(styles.dragOver);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove(styles.dragOver);
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const selected = sorted.filter((f) => selectedIds.has(f.id));
    const names = selected.map((f) => f.name).join(", ");
    if (!confirm(`Удалить ${selected.length} элемент(ов): ${names}?`)) return;
    try {
      for (const file of selected) {
        await fileApi.deleteFile(file.path);
      }
      clearSelection();
      loadFiles(currentPath);
    } catch (e: any) {
      setError(e.message || "Failed to delete");
    }
  };

  const doRename = async () => {
    if (!renameTarget) return;
    const newName = renameValue.trim();
    if (!newName || newName === renameTarget.name) { setRenameTarget(null); return; }

    const parentPath = renameTarget.path.substring(0, renameTarget.path.lastIndexOf("/"));
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;

    try {
      await fileApi.renameFile(renameTarget.path, newPath);
      loadFiles(currentPath);
    } catch (e: any) {
      setError(e.message || "Failed to rename");
    } finally {
      setRenameTarget(null);
      setRenameValue("");
    }
  };

  const handleMkdir = async (name: string) => {
    if (!name.trim()) return;
    const trimmedName = name.trim();
    const fullPath = currentPath ? `${currentPath}/${trimmedName}` : trimmedName;
    try {
      await fileApi.createDir(fullPath);
      loadFiles(currentPath);
      setShowNewMenu(false);
    } catch (e: any) {
      setError(e.message || "Failed to create directory");
    }
  };

  const handleDownload = async (file: FileInfo) => {
    if (file.isDir) return;
    await downloadFile({ path: file.path, filename: file.name, sizeBytes: file.sizeBytes });
  };

  const handleDownloadSelected = async () => {
    if (selectedIds.size === 0) return;
    const selected = sorted.filter((f) => selectedIds.has(f.id) && !f.isDir);
    for (const file of selected) {
      await downloadFile({ path: file.path, filename: file.name, sizeBytes: file.sizeBytes });
    }
  };

  const handleOpen = (file: FileInfo) => {
    if (file.isDir) {
      handleNavigate(file.path);
    } else {
      setPreviewFile(file);
    }
  };

  const handlePreviewFile = (file: FileInfo) => {
    setPreviewFile(file);
  };

  // ── Move / Copy ───────────────────────────────────────────────────────

  const putInClipboard = (operation: ClipboardEntry["operation"], selected: FileInfo[]) => {
    if (selected.length === 0) return;
    clipboard.current = {
      operation,
      paths: selected.map((f) => f.path),
    };
    setContextMenu(null);
    clearSelection();
  };

  const handleCut = () => putInClipboard("move", sorted.filter((f) => selectedIds.has(f.id)));

  const handleCopy = () => putInClipboard("copy", sorted.filter((f) => selectedIds.has(f.id)));

  const handlePaste = async () => {
    if (!clipboard.current) return;
    const { operation, paths } = clipboard.current;

    try {
      if (operation === "copy") {
        for (const fromPath of paths) {
          const name = fromPath.split("/").pop() || fromPath;
          const toPath = currentPath ? `${currentPath}/${name}` : name;
          await fileApi.copyFile(fromPath, toPath);
        }
      } else {
        for (const fromPath of paths) {
          const name = fromPath.split("/").pop() || fromPath;
          const toPath = currentPath ? `${currentPath}/${name}` : name;
          await fileApi.moveFile(fromPath, toPath);
        }
      }
      loadFiles(currentPath);
      clipboard.current = null;
    } catch (e: any) {
      setError(e.message || "Failed to paste");
    }
  };

  const handleDelete = async (file: FileInfo) => {
    if (!confirm(`Удалить "${file.name}"?`)) return;
    try {
      await fileApi.deleteFile(file.path);
      loadFiles(currentPath);
      if (previewFile?.id === file.id) setPreviewFile(null);
    } catch (e: any) {
      setError(e.message || "Failed to delete");
    }
  };

  const handleNewFile = async (type: "folder" | "file") => {
    setShowNewMenu(false);
    if (type === "folder") {
      setInputModal({ type: "folder", title: "Создать папку", placeholder: "Имя папки", onConfirm: handleMkdir });
    } else {
      setInputModal({ type: "file", title: "Создать файл", placeholder: "Имя файла", onConfirm: createEmptyFile });
    }
  };

  const createEmptyFile = async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    try {
      const emptyFile = new File([], trimmedName, { type: "text/plain" });
      await uploadFile({ path: currentPath, filename: trimmedName, file: emptyFile });
      loadFiles(currentPath);
    } catch (e: any) {
      setError(e.message || "Failed to create file");
    }
  };

  const hasClipboard = clipboard.current !== null;

  return (
    <div className={`${styles.root} ${sidebarCollapsed ? styles.collapsed : ""}`}>
      <aside className={styles.sidebar} style={{ display: sidebarCollapsed ? "none" : "flex" }}>
        <FolderTreeSidebar currentPath={currentPath} onNavigate={handleNavigate} refreshKey={currentPath} />
      </aside>

      <main className={styles.main}>
        {/* ── Finder-like toolbar ────────────────────────── */}
        <motion.div
          className={styles.toolbarFinder}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.05 }}
        >
          <div className={styles.navGroup}>
            <motion.button
              whileHover={{ background: "var(--color-glass-hover-strong)" }}
              whileTap={{ scale: 0.94 }}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className={styles.navBtn}
              title={sidebarCollapsed ? "Показать боковую панель" : "Скрыть боковую панель"}
            >
              {sidebarCollapsed ? <FolderOpen size={15} /> : <ChevronRight size={15} style={{ transform: "rotate(180deg)" }} />}
            </motion.button>
            <motion.button
              whileHover={{ background: "var(--color-glass-hover-strong)" }}
              whileTap={{ scale: 0.94 }}
              onClick={goBack}
              disabled={!canGoBack}
              className={styles.navBtn}
              title="Назад"
            >
              <ArrowLeft size={15} />
            </motion.button>
            <motion.button
              whileHover={{ background: "var(--color-glass-hover-strong)" }}
              whileTap={{ scale: 0.94 }}
              onClick={goForward}
              disabled={!canGoForward}
              className={styles.navBtn}
              title="Вперёд"
            >
              <ArrowRight size={15} />
            </motion.button>
            <motion.button
              whileHover={{ background: "var(--color-glass-hover-strong)" }}
              whileTap={{ scale: 0.94 }}
              onClick={goUp}
              disabled={!currentPath}
              className={styles.navBtn}
              title="Вверх"
            >
              <ArrowUp size={15} />
            </motion.button>
            <motion.button
              whileHover={{ background: "var(--color-glass-hover-strong)" }}
              whileTap={{ scale: 0.94 }}
              onClick={() => loadFiles(currentPath)}
              className={styles.navBtn}
              title="Обновить"
            >
              <RefreshCw size={15} />
            </motion.button>
          </div>

          {/* Breadcrumbs - scrollable container */}
          <div className={styles.breadcrumbsContainer}>
            <div className={styles.breadcrumbs}>
              <AnimatePresence mode="wait">
                {breadcrumbs.map((crumb, idx) => (
                  <motion.div
                    key={idx}
                    className={styles.crumb}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 6 }}
                    transition={{ duration: 0.15, delay: idx * 0.03 }}
                  >
                    {idx > 0 && <ChevronRight size={14} className={styles.crumbSep} />}
                    <button
                      onClick={() => handleNavigate(crumb.path)}
                      className={`${styles.crumbBtn} ${idx === breadcrumbs.length - 1 ? styles.crumbActive : ""}`}
                      title={crumb.path || "Мой диск"}
                    >
                      {idx === 0 && <Home size={14} />}
                      {crumb.name}
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div className={styles.toolbarRight}>
            {selectedIds.size > 0 && (
              <>
                <motion.button
                  whileHover={{ background: "var(--color-glass-hover-strong)" }}
                  whileTap={{ scale: 0.94 }}
                  onClick={handleCut}
                  className={styles.navBtn}
                  title="Вырезать"
                >
                  <Scissors size={15} />
                </motion.button>
                <motion.button
                  whileHover={{ background: "var(--color-glass-hover-strong)" }}
                  whileTap={{ scale: 0.94 }}
                  onClick={handleCopy}
                  className={styles.navBtn}
                  title="Копировать"
                >
                  <Copy size={15} />
                </motion.button>
                <motion.button
                  whileHover={{ background: "var(--color-glass-hover-strong)" }}
                  whileTap={{ scale: 0.94 }}
                  onClick={handlePaste}
                  disabled={!hasClipboard}
                  className={styles.navBtn}
                  title="Вставить"
                >
                  <ClipboardPaste size={15} />
                </motion.button>
                <motion.button
                  whileHover={{ background: "var(--color-glass-hover-strong)" }}
                  whileTap={{ scale: 0.94 }}
                  onClick={handleDownloadSelected}
                  className={styles.navBtn}
                  title="Скачать выбранное"
                >
                  <Download size={15} />
                </motion.button>
                <motion.button
                  whileHover={{ background: "rgba(255,100,100,0.12)" }}
                  whileTap={{ scale: 0.94 }}
                  onClick={handleDeleteSelected}
                  className={styles.navBtn}
                  title="Удалить выбранное"
                >
                  <Trash2 size={15} style={{ color: "var(--color-error)" }} />
                </motion.button>
              </>
            )}
            <div style={{ position: "relative", display: "inline-block" }}>
              <div ref={newMenuButtonRef} style={{ display: "inline-block" }}>
                <motion.button
                  whileHover={{ background: "var(--color-glass-hover-strong)" }}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => setShowNewMenu(!showNewMenu)}
                  className={styles.navBtn}
                  title="Создать"
                >
                  <Plus size={15} />
                </motion.button>
              </div>
              {showNewMenu && newMenuPos && (
                <>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -4 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    style={{
                      position: "fixed",
                      top: newMenuPos.top,
                      left: newMenuPos.left,
                      background: "var(--color-glass-surface)",
                      border: "1px solid var(--color-glass-border)",
                      borderRadius: "var(--radius-sm)",
                      padding: "6px",
                      minWidth: 150,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                      zIndex: 100,
                      backdropFilter: "var(--glass-blur)",
                      WebkitBackdropFilter: "var(--glass-blur)",
                    }}
                  >
                    <motion.button
                      whileHover={{ background: "var(--color-glass-hover)" }}
                      onClick={() => handleNewFile("folder")}
                      style={{ padding: "6px 10px", textAlign: "left", fontSize: 12, background: "transparent", border: "none", color: PRIMARY, cursor: "pointer", borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <FolderPlus size={12} /> Папка
                    </motion.button>
                    <motion.button
                      whileHover={{ background: "var(--color-glass-hover)" }}
                      onClick={() => handleNewFile("file")}
                      style={{ padding: "6px 10px", textAlign: "left", fontSize: 12, background: "transparent", border: "none", color: PRIMARY, cursor: "pointer", borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <FileText size={12} /> Файл
                    </motion.button>
                  </motion.div>
                  <div style={{ position: "fixed", inset: 0, zIndex: 1 }} onClick={() => setShowNewMenu(false)} />
                </>
              )}
            </div>

            <motion.button
              whileHover={{ background: "var(--color-glass-hover-strong)" }}
              whileTap={{ scale: 0.94 }}
              onClick={() => fileInputRef.current?.click()}
              className={styles.navBtn}
              title="Загрузить файлы"
            >
              <Upload size={15} />
            </motion.button>

            <div className={styles.viewToggle}>
              <motion.button
                whileHover={viewMode === "grid" ? undefined : { background: "var(--color-glass-hover-strong)" }}
                whileTap={viewMode === "grid" ? undefined : { scale: 0.92 }}
                className={`${styles.viewBtn} ${viewMode === "grid" ? styles.viewBtnActive : ""}`}
                onClick={() => setViewMode("grid")}
                title="Сетка"
              >
                <Grid3x3 size={15} />
              </motion.button>
              <motion.button
                whileHover={viewMode === "list" ? undefined : { background: "var(--color-glass-hover-strong)" }}
                whileTap={viewMode === "list" ? undefined : { scale: 0.92 }}
                className={`${styles.viewBtn} ${viewMode === "list" ? styles.viewBtnActive : ""}`}
                onClick={() => setViewMode("list")}
                title="Список"
              >
                <List size={15} />
              </motion.button>
            </div>

            <div className={styles.search}>
              <Search size={14} className={styles.searchIcon} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск…"
                className={styles.searchInput}
              />
            </div>
          </div>
        </motion.div>

        <div className={styles.body} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
          <AnimatePresence>
            {error && (
              <motion.div
                className={styles.errorBanner}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <span>{error}</span>
                <button className={styles.errorRetryButton} onClick={() => loadFiles(currentPath)}>Повторить</button>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            className={styles.cardLabel}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: 0.05 }}
          >
            {breadcrumbs[breadcrumbs.length - 1]?.name || "Мой диск"} · {sorted.length} {plural(sorted.length, "элемент", "элемента", "элементов")}
          </motion.div>

          {loading ? (
            <SkeletonGrid count={6} />
          ) : sorted.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
              <EmptyState title={search ? "Ничего не найдено" : "Папка пуста"} sub={search ? `По запросу «${search}» ничего нет` : "Здесь пока нет файлов"} />
            </motion.div>
          ) : viewMode === "grid" ? (
            <AnimatePresence mode="popLayout">
              <motion.div className={styles.grid} layout>
                {sorted.map((item, _i) => (
                  <motion.div
                    key={item.id}
                    layoutId={item.id}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    style={{ willChange: "transform, opacity" }}
                  >
                    <GridItem item={item} selected={selectedIds.has(item.id)}
                      onClick={(e) => handleSelection(item, e)}
                      onDoubleClick={() => handleDoubleClick(item)}
                      onContextMenu={(e) => handleContextMenu(e, item)}
                      onView={() => setPreviewFile(item)} />
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>
          ) : (
            <AnimatePresence mode="popLayout">
              <motion.div className={styles.list} layout>
                <div className={styles.listHead}>
                  <div>Имя</div>
                  <div>Изменён</div>
                  <div>Размер</div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <MoreVertical size={14} style={{ color: MUTED }} />
                  </div>
                </div>
                {sorted.map((item) => (
                  <motion.div
                    key={item.id}
                    layoutId={item.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    style={{ willChange: "transform, opacity" }}
                  >
                    <ListItem item={item} selected={selectedIds.has(item.id)}
                      onClick={(e) => handleSelection(item, e)}
                      onDoubleClick={() => handleDoubleClick(item)}
                      onContextMenu={(e) => handleContextMenu(e, item)}
                      onView={() => setPreviewFile(item)} />
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>
          )}

          <input ref={fileInputRef} type="file" multiple style={{ display: "none" }}
            onChange={async (e) => {
              const fs = Array.from(e.target.files || []);
              for (const f of fs) {
                try { await uploadFile({ path: currentPath, filename: f.name, file: f }); }
                catch (e: any) { logger.error("files", "Upload failed", e); }
              }
              loadFiles(currentPath);
              e.target.value = "";
            }} />
        </div>
        <div className={styles.statusBar}>
          <span className={styles.statusPath} title={currentPath || "Мой диск"}>
            {currentPath || "Мой диск"}
          </span>
          <span className={styles.statusItem}>
            {selectedIds.size > 0
              ? <><span className={styles.statusAccent}>{selectedIds.size}</span> выбрано</>
              : <><span className={styles.statusAccent}>{files.length}</span> {plural(files.length, "элемент", "элемента", "элементов")}</>}
          </span>
        </div>
      </main>

      {previewFile && (
        <div
          style={{
            position: "fixed", inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 5000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
          onClick={() => setPreviewFile(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            style={{
              width: "min(90vw, 800px)",
              height: "min(90vh, 600px)",
              maxWidth: "90vw",
              maxHeight: "90vh",
              background: "var(--color-glass-surface)",
              border: "1px solid var(--color-glass-border)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <FileViewer file={previewFile} onClose={() => setPreviewFile(null)} onEdited={() => loadFiles(currentPath)} />
          </motion.div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          item={contextMenu.item} x={contextMenu.x} y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onRename={() => { setRenameTarget(contextMenu.item); setRenameValue(contextMenu.item.name); setContextMenu(null); }}
          onDownload={() => handleDownload(contextMenu.item)}
          onDelete={() => handleDelete(contextMenu.item)}
          onOpen={() => handleOpen(contextMenu.item)}
          onPreview={() => handlePreviewFile(contextMenu.item)}
          onMove={() => putInClipboard("move", [contextMenu.item])}
          onCopy={() => putInClipboard("copy", [contextMenu.item])}
        />
      )}

      {renameTarget && (
        <>
          <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1999 }} onClick={() => setRenameTarget(null)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            style={{
              position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              background: "var(--color-glass-surface)", border: "1px solid var(--color-glass-border)",
              borderRadius: "var(--radius-md)", padding: "18px 22px", minWidth: 320,
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)", zIndex: 2000,
            }}
          >
            <h3 style={{ fontSize: 13, fontWeight: 600, color: PRIMARY, marginBottom: 12 }}>Переименовать</h3>
            <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doRename(); if (e.key === "Escape") setRenameTarget(null); }}
              style={{
                width: "100%", padding: "8px 10px", borderRadius: "var(--radius-sm)",
                background: "rgba(0,0,0,0.3)", border: "1px solid var(--color-glass-border)",
                color: PRIMARY, fontSize: 13, marginBottom: 14, outline: "none",
              }} autoFocus />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setRenameTarget(null)} style={{
                padding: "6px 14px", borderRadius: "var(--radius-sm)",
                background: "var(--color-glass-surface)", border: "1px solid var(--color-glass-border)",
                color: SECONDARY, fontSize: 12, cursor: "pointer", transition: "all 0.15s",
              }}>Отмена</button>
              <button onClick={doRename} style={{
                padding: "6px 14px", borderRadius: "var(--radius-sm)",
                background: "var(--color-accent)", border: "1px solid var(--color-accent-border)",
                color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 500,
              }}>Готово</button>
            </div>
          </motion.div>
        </>
      )}

      {inputModal && (
        <>
          <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1999 }} onClick={() => setInputModal(null)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            style={{
              position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              background: "var(--color-glass-surface)", border: "1px solid var(--color-glass-border)",
              borderRadius: "var(--radius-md)", padding: "18px 22px", minWidth: 320,
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)", zIndex: 2000,
            }}
          >
            <h3 style={{ fontSize: 13, fontWeight: 600, color: PRIMARY, marginBottom: 12 }}>{inputModal.title}</h3>
            <input ref={inputRef} type="text" placeholder={inputModal.placeholder}
              onKeyDown={(e) => { if (e.key === "Enter") { inputModal.onConfirm(inputRef.current?.value || ""); setInputModal(null); } if (e.key === "Escape") setInputModal(null); }}
              style={{
                width: "100%", padding: "8px 10px", borderRadius: "var(--radius-sm)",
                background: "rgba(0,0,0,0.3)", border: "1px solid var(--color-glass-border)",
                color: PRIMARY, fontSize: 13, marginBottom: 14, outline: "none",
              }} autoFocus />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setInputModal(null)} style={{
                padding: "6px 14px", borderRadius: "var(--radius-sm)",
                background: "var(--color-glass-surface)", border: "1px solid var(--color-glass-border)",
                color: SECONDARY, fontSize: 12, cursor: "pointer", transition: "all 0.15s",
              }}>Отмена</button>
              <button onClick={() => { inputModal.onConfirm(inputRef.current?.value || ""); setInputModal(null); }} style={{
                padding: "6px 14px", borderRadius: "var(--radius-sm)",
                background: "var(--color-accent)", border: "1px solid var(--color-accent-border)",
                color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 500,
              }}>Готово</button>
            </div>
          </motion.div>
        </>
      )}

      <OperationQueueList operations={operations} onCancel={cancelOperation} onClose={removeOperation} onRetry={retry} />
    </div>
  );
}

function EmptyState({ title, sub }: { title: string; sub: string }) {
  return (
    <motion.div
      className={styles.panel}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "44px 20px" }}
    >
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={{ duration: 0.2, delay: 0.05 }}>
        <Folder size={42} strokeWidth={1.1} style={{ color: MUTED }} />
      </motion.div>
      <motion.div style={{ fontSize: 13, fontWeight: 600, color: SECONDARY, marginTop: 6 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, delay: 0.07 }}>{title}</motion.div>
      <motion.div style={{ fontSize: 12, color: MUTED }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, delay: 0.09 }}>{sub}</motion.div>
    </motion.div>
  );
}

function ContextMenu({
  item, x, y, onClose, onRename, onDownload, onDelete,
  onOpen, onPreview, onMove, onCopy,
}: {
  item: FileInfo; x: number; y: number;
  onClose: () => void; onRename: () => void;
  onDownload: () => void; onDelete: () => void;
  onOpen: () => void; onPreview: () => void;
  onMove: () => void; onCopy: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (menuRef.current) {
      setMenuRect(menuRef.current.getBoundingClientRect());
    }
  }, []);

  const popupStyle: React.CSSProperties = {
    position: "fixed",
    top: menuRect
      ? Math.min(y, window.innerHeight - menuRect.height - 16)
      : Math.min(y, window.innerHeight - 320),
    left: menuRect
      ? Math.min(x, window.innerWidth - menuRect.width - 16)
      : Math.min(x, window.innerWidth - 240),
    background: "var(--color-glass-surface)",
    border: "1px solid var(--color-glass-border)",
    borderRadius: "var(--radius-sm)",
    padding: "4px",
    minWidth: 200,
    maxWidth: 260,
    maxHeight: 480,
    overflow: "hidden",
    boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
    zIndex: 2000,
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
  };

  const itemStyle = (opts?: { danger?: boolean; shortcut?: string }): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    padding: "6px 10px",
    textAlign: "left",
    fontSize: 12,
    background: "transparent",
    border: "none",
    color: opts?.danger ? "var(--color-error)" : "var(--color-text-primary)",
    cursor: "pointer",
    borderRadius: "4px",
    transition: "all 0.12s",
  });

  const IconWrapper = ({ icon: Icon, color }: { icon: any; color?: string }) =>
    <div style={{ width: 16, height: 16, display: "grid", placeItems: "center", flexShrink: 0, color: color || "var(--color-text-secondary)" }}>
      <Icon size={11} strokeWidth={1.6} />
    </div>;

  const renderItem = (
    icon: any, label: string, onClick: () => void,
    opts?: { danger?: boolean; disabled?: boolean; shortcut?: string; submenu?: string },
  ) => (
    <motion.button
      key={label}
      whileHover={!opts?.disabled ? {
        background: opts?.danger ? "rgba(255,100,100,0.12)" : "var(--color-glass-hover)",
        x: 3,
      } : {}}
      onClick={() => { onClick(); if (!opts?.submenu) onClose(); }}
      disabled={opts?.disabled}
      style={itemStyle({ danger: opts?.danger })}
    >
      <IconWrapper icon={icon} color={opts?.danger ? "var(--color-error)" : undefined} />
      <span>{label}</span>
      {opts?.shortcut && (
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--color-text-muted)", fontFamily: "ui-monospace, monospace" }}>
          {opts.shortcut}
        </span>
      )}
      {opts?.submenu && <ChevronRight size={10} style={{ marginLeft: "auto", color: "var(--color-text-muted)" }} />}
    </motion.button>
  );

  const renderSeparator = (key: string) => (
    <div key={key} style={{ height: 1, background: "var(--color-surface-border)", margin: "4px 0" }} />
  );

  const renderLabel = (text: string) => (
    <div style={{ padding: "4px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--color-text-muted)", fontWeight: 600 }}>
      {text}
    </div>
  );

  return (
    <>
      <motion.div
        ref={menuRef}
        style={popupStyle}
        initial={{ opacity: 0, scale: 0.92, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: -4 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
      >
        {renderLabel("Действия")}
        {renderItem(FolderOpen, "Открыть", () => { if (item.isDir) onOpen(); else onClose(); })}
        {!item.isDir && renderItem(Eye, "Просмотр", () => { onPreview(); onClose(); }, { shortcut: "Пробел" })}
        {!item.isDir && renderItem(Download, "Скачать", () => { onDownload(); onClose(); }, { shortcut: "⌘+S" })}

        {renderSeparator("sep1")}

        {renderLabel("Правка")}
        {renderItem(Edit3, "Переименовать", () => { onRename(); onClose(); }, { shortcut: "⌘+R" })}
        {renderItem(Copy, "Копировать", () => { onCopy(); onClose(); }, { shortcut: "⌘+C" })}
        {renderItem(Scissors, "Переместить", () => { onMove(); onClose(); }, { shortcut: "⌘+X" })}

        {!item.isDir && (
          <>
            {renderSeparator("sep2")}
            {renderLabel("Поделиться")}
            {renderItem(Share2, "Поделиться ссылкой", () => { navigator.clipboard.writeText(item.name); onClose(); })}
          </>
        )}

        {renderSeparator("sep3")}
        {renderItem(Trash2, "Удалить", () => { onDelete(); onClose(); }, { danger: true, shortcut: "⌫" })}
      </motion.div>
      <div style={{ position: "fixed", inset: 0, zIndex: 100 }} onClick={onClose} />
    </>
  );
}

/* ─── Folder tree sidebar ────────────────────────────────────────────── */

interface TreeNode {
  id: string; name: string; isDir: boolean;
  children: TreeNode[]; hasChildren: boolean; loaded: boolean;
}

const FolderTreeSidebar: React.FC<{
  currentPath: string;
  onNavigate: (path: string) => void;
  refreshKey: string;
}> = ({ currentPath, onNavigate, refreshKey }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);

  const loadDir = useCallback(async (path: string): Promise<TreeNode[]> => {
    try {
      const files = await fileApi.listFiles(path);
      return files.map((f) => ({
        id: f.path, name: f.name, isDir: f.isDir,
        children: [], hasChildren: f.isDir, loaded: false,
      }));
    } catch (e) {
      logger.error("files", "Tree load error", e);
      return [];
    }
  }, []);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    const nodes = await loadDir("");
    setRootNodes(nodes);
    setLoading(false);
  }, [loadDir]);

  useEffect(() => { loadRoot(); }, [refreshKey, loadRoot]);

  const toggleExpand = useCallback(async (node: TreeNode, fullPath: string) => {
    if (!node.isDir) return;
    const key = fullPath;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    if (!node.loaded) {
      const children = await loadDir(fullPath);
      const updateNodes = (nodes: TreeNode[]): TreeNode[] => nodes.map((candidate) => {
        if (candidate.id === fullPath) return { ...candidate, children, loaded: true };
        return candidate.children.length > 0
          ? { ...candidate, children: updateNodes(candidate.children) }
          : candidate;
      });
      setRootNodes(updateNodes);
    }
  }, [loadDir]);

  const renderTree = (nodes: TreeNode[], depth = 0) =>
    nodes.map((node) => {
      const fullPath = node.id;
      const isDir = node.isDir;
      const isExpanded = expanded.has(fullPath);
      const isActive = currentPath === fullPath;
      return (
        <div key={fullPath}>
          <button
            onClick={() => {
              if (isDir) {
                onNavigate(fullPath);
                void toggleExpand(node, fullPath);
              }
            }}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              paddingLeft: `${10 + depth * 14}px`, paddingRight: 10,
              height: 30, borderRadius: "var(--radius-sm)",
              background: isActive ? "var(--color-accent-soft)" : "transparent",
              border: "1px solid transparent",
              color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
              cursor: "pointer", fontSize: 12, width: "100%", textAlign: "left",
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = "var(--color-glass-hover)"; e.currentTarget.style.color = "var(--color-text-primary)"; } }}
            onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--color-text-secondary)"; } }}
          >
            {isDir && (
              <ChevronRight size={12} style={{
                transition: "transform 0.15s",
                transform: isExpanded ? "rotate(90deg)" : "none",
                color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
              }} />
            )}
            <Folder size={13} style={{ color: "#60a5fa" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
          </button>
          {isDir && isExpanded && node.children.length > 0 && (
            <div>{renderTree(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
      <div style={{ padding: "0 12px 8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, fontWeight: 600 }}>
        Папки
      </div>
      {loading ? (
        <div style={{ padding: "8px 12px", fontSize: 12, color: MUTED }}>Загрузка…</div>
      ) : (
        renderTree(rootNodes, 0)
      )}
    </div>
  );
};

/* ─── Grid item ───────────────────────────────────────────────────────── */

function GridItem({
  item, selected, onClick, onDoubleClick, onContextMenu, onView,
}: {
  item: FileInfo; selected: boolean;
  onClick: (e: React.MouseEvent) => void; onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void; onView: () => void;
}) {
  const Icon = iconFor(item);
  const color = colorFor(item);
  const isPreviewable = !item.isDir && (
    item.mimeType?.startsWith("image/") ||
    item.mimeType?.startsWith("video/") ||
    item.mimeType?.startsWith("audio/") ||
    item.mimeType?.startsWith("text/") ||
    item.mimeType === "application/pdf" ||
    item.mimeType === "application/json"
  );

  return (
    <div
      className={`${styles.gridItem} ${selected ? styles.gridItemSelected : ""}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        className={styles.gridThumb}
        style={{
          width: 72, height: 72, borderRadius: "var(--radius-md)",
          "--thumb-color": color,
          display: "grid",
          placeItems: "center",
          position: "relative",
          transition: "transform 0.15s, box-shadow 0.15s",
        } as React.CSSProperties}
      >
        <Icon size={34} strokeWidth={1.3} />
        {item.isDir && item.sizeBytes > 0 && (
          <span
            className={styles.typeBadge}
            style={{ background: "rgba(96,165,250,0.18)", color: "#60a5fa" }}
          >
            {item.sizeBytes}
          </span>
        )}
      </div>
      <div className={styles.gridName} title={item.name} style={{ fontSize: 13, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.name}
      </div>
      <div className={styles.gridMeta} style={{ fontSize: 11 }}>
        {item.isDir ? `${item.sizeBytes || 0} эл.` : formatBytes(item.sizeBytes)}
      </div>
      {!item.isDir && isPreviewable && (
        <button
          onClick={(e) => { e.stopPropagation(); onView(); }}
          className={styles.gridPreviewBtn}
          title="Просмотр"
          style={{
            opacity: 1,
            transform: "scale(1)",
            transition: "opacity 0.15s, transform 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.transform = "scale(1.08)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.3)"; e.currentTarget.style.transform = "scale(1)"; }}
          onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.9)"; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1.08)"; }}
        >
          <FileText size={11} />
        </button>
      )}
    </div>
  );
}

/* ─── List item ───────────────────────────────────────────────────────── */

function ListItem({
  item, selected, onClick, onDoubleClick, onContextMenu, onView,
}: {
  item: FileInfo; selected: boolean;
  onClick: (e: React.MouseEvent) => void; onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void; onView: () => void;
}) {
  const Icon = iconFor(item);
  const color = colorFor(item);

  return (
    <div
      className={`${styles.listRow} ${selected ? styles.listRowSelected : ""}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 120px 100px 40px",
        padding: "10px 14px",
        fontSize: 13,
        alignItems: "center",
        cursor: "pointer",
        borderBottom: "1px solid var(--color-glass-border)",
        background: selected ? "var(--color-accent-soft)" : "var(--color-glass-surface)",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--color-glass-hover)"; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "var(--color-glass-surface)"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <motion.div
          style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            display: "grid", placeItems: "center", color,
            background: `color-mix(in srgb, ${color} 14%, transparent)`,
          }}
          whileHover={{ scale: 1.08 }}
          transition={{ duration: 0.12 }}
        >
          <Icon size={15} strokeWidth={1.6} />
        </motion.div>
        <span
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: PRIMARY }}
          title={item.name}
        >
          {item.name}
        </span>
        {item.isDir && (
          <span style={{ fontSize: 11, color: MUTED, marginLeft: 6 }}>(директория)</span>
        )}
      </div>
      <div style={{ color: SECONDARY, fontSize: 12 }}>{formatTimeAgo(item.updatedAt)}</div>
      <div style={{ color: SECONDARY, fontSize: 12 }}>
        {item.isDir ? "—" : formatBytes(item.sizeBytes)}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {!item.isDir && (
          <motion.button
            onClick={(e) => { e.stopPropagation(); onView(); }}
            style={{
              width: 24, height: 22, borderRadius: "var(--radius-sm)",
              background: "transparent", border: "1px solid var(--color-surface-border)",
              color: "var(--color-text-secondary)", cursor: "pointer",
              display: "grid", placeItems: "center",
            }}
            whileHover={{ background: "var(--color-glass-hover)", color: PRIMARY }}
            title="Просмотр"
          >
            <FileText size={11} />
          </motion.button>
        )}
      </div>
    </div>
  );
}
