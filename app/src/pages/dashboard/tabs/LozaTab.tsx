import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import styles from "./LozaTab.module.css";
import { FileInfo } from "../../../types/files";
import { fileApi } from "../../../api/filesService";
import { logger } from "../../../shared/utils/logger";
import { formatBytes } from "../../../shared/utils/serverStorage";
import {
  Folder, File, FileText, Image as ImageIcon, Film, Music, Archive, Code2,
  Search, ChevronRight, Home, Grid3x3, List, Upload, Download,
  MoreVertical, FolderPlus, Edit3, Copy, Trash2,
} from "lucide-react";
import { useOperationQueue } from "../../../components/files/OperationQueue";
import OperationQueueList from "../../../components/files/OperationQueue";
import FileViewer from "../../../components/files/FileViewer";

const SECONDARY = "var(--color-text-secondary)";
const PRIMARY = "var(--color-text-primary)";
const MUTED = "var(--color-text-muted)";

const iconFor = (file: FileInfo): any => {
  if (file.isDir) return Folder;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (["jpg","jpeg","png","gif","webp","bmp","svg","avif"].includes(ext)) return ImageIcon;
  if (["mp4","webm","mov","avi","mkv"].includes(ext)) return Film;
  if (["mp3","wav","ogg","flac","m4a"].includes(ext)) return Music;
  if (["zip","tar","gz","7z","rar"].includes(ext)) return Archive;
  if (["txt","md","json","yaml","yml","toml","ini","csv","xml","html","css","js","ts","jsx","tsx","py","rs","go","c","cpp","h","hpp","sh","log"].includes(ext)) return Code2;
  if (["pdf","doc","docx","xls","xlsx","ppt","pptx"].includes(ext)) return FileText;
  return File;
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
          <div style={{ height: 12, background: "var(--color-surface)", borderRadius: 4, width: "80%", margin: "4px auto" }} />
          <div style={{ height: 10, background: "var(--color-surface)", borderRadius: 4, width: "50%", margin: "2px auto" }} />
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

export default function LozaTab() {
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileInfo | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ item: FileInfo; x: number; y: number } | null>(null);
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [newMenuPos, setNewMenuPos] = useState<{ top: number; left: number } | null>(null);

  const { operations, uploadFile, downloadFile, cancelOperation, removeOperation, retry } = useOperationQueue();

  const loadFiles = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setSelectedId(null);
    try {
      const result = await fileApi.listFiles(path);
      setFiles(result);
    } catch (e: any) {
      setError(e.message || "Failed to load files");
      logger.error("files", "loadFiles error", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles(currentPath);
  }, [loadFiles, currentPath]);

  const breadcrumbs = buildBreadcrumbs(currentPath);

  useLayoutEffect(() => {
    if (showNewMenu && newMenuButtonRef.current) {
      const rect = newMenuButtonRef.current.getBoundingClientRect();
      setNewMenuPos({ top: rect.bottom + 8, left: rect.left });
    } else {
      setNewMenuPos(null);
    }
  }, [showNewMenu]);

  const filtered = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [filtered]);

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    setSearch("");
    setShowNewMenu(false);
  };

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

  const doRename = async () => {
    if (!renameTarget) return;
    const newName = renameValue.trim();
    if (!newName || newName === renameTarget.name) { setRenameTarget(null); return; }

    // Build the new path: same directory, different name
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
    try {
      await fileApi.createDir(name);
      loadFiles(currentPath);
      setShowNewMenu(false);
    } catch (e: any) {
      setError(e.message || "Failed to create directory");
    }
  };

  const handleDownload = (file: FileInfo) => {
    if (file.isDir) return;
    downloadFile({ path: file.path, filename: file.name, sizeBytes: file.sizeBytes });
  };

  const handleContextMenu = (e: React.MouseEvent, item: FileInfo) => {
    e.preventDefault();
    setContextMenu({ item, x: e.clientX, y: e.clientY });
  };

  const handleNewFile = async (type: "folder" | "file") => {
    setShowNewMenu(false);
    if (type === "folder") {
      const name = prompt("Имя папки:");
      if (name) await handleMkdir(name);
    } else {
      fileInputRef.current?.click();
    }
  };

  return (
    <div className={styles.root}>
      <aside className={styles.sidebar}>
        <FolderTreeSidebar currentPath={currentPath} onNavigate={handleNavigate} refreshKey={currentPath} />
      </aside>

      <main className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.breadcrumbs}>
            {breadcrumbs.map((crumb, idx) => (
              <div key={idx} className={styles.crumb}>
                {idx > 0 && <ChevronRight size={14} className={styles.crumbSep} />}
                <button
                  onClick={() => handleNavigate(crumb.path)}
                  className={`${styles.crumbBtn} ${idx === breadcrumbs.length - 1 ? styles.crumbActive : ""}`}
                >
                  {idx === 0 && <Home size={14} />}
                  {crumb.name}
                </button>
              </div>
            ))}
          </div>

          <div className={styles.toolbarRight}>
            <div style={{ position: "relative" }}>
              <button ref={newMenuButtonRef} className={styles.viewBtn} onClick={() => setShowNewMenu(!showNewMenu)} title="Создать">
                +
              </button>
              {showNewMenu && newMenuPos && (
                <>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -4 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      position: "fixed",
                      top: newMenuPos.top,
                      left: newMenuPos.left,
                      background: "var(--color-surface)", border: "1px solid var(--color-surface-border)",
                      borderRadius: "var(--radius-sm)", padding: "4px", minWidth: 140,
                      display: "flex", flexDirection: "column", gap: 2,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.3)", zIndex: 100,
                    }}
                  >
                    <motion.button
                      whileHover={{ background: "var(--color-surface-hover)" }}
                      onClick={() => handleNewFile("folder")}
                      style={{ padding: "6px 10px", textAlign: "left", fontSize: 12, background: "transparent", border: "none", color: PRIMARY, cursor: "pointer", borderRadius: "var(--radius-sm)" }}
                    >
                      <FolderPlus size={12} style={{ marginRight: 6 }} /> Папка
                    </motion.button>
                    <motion.button
                      whileHover={{ background: "var(--color-surface-hover)" }}
                      onClick={() => handleNewFile("file")}
                      style={{ padding: "6px 10px", textAlign: "left", fontSize: 12, background: "transparent", border: "none", color: PRIMARY, cursor: "pointer", borderRadius: "var(--radius-sm)" }}
                    >
                      <FileText size={12} style={{ marginRight: 6 }} /> Файл
                    </motion.button>
                  </motion.div>
                  <div style={{ position: "fixed", inset: 0, zIndex: 1 }} onClick={() => setShowNewMenu(false)} />
                </>
              )}
            </div>

            <button className={styles.viewBtn} onClick={() => fileInputRef.current?.click()} title="Загрузить">
              <Upload size={15} />
            </button>

            <div className={styles.viewToggle}>
              <button className={`${styles.viewBtn} ${viewMode === "grid" ? styles.viewBtnActive : ""}`} onClick={() => setViewMode("grid")} title="Сетка">
                <Grid3x3 size={15} />
              </button>
              <button className={`${styles.viewBtn} ${viewMode === "list" ? styles.viewBtnActive : ""}`} onClick={() => setViewMode("list")} title="Список">
                <List size={15} />
              </button>
            </div>

            <div className={styles.search}>
              <Search size={14} className={styles.searchIcon} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск…" className={styles.searchInput} />
            </div>
          </div>
        </div>

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
            <motion.div className={styles.grid} initial="hide" animate="show">
              {sorted.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.15, delay: i * 0.02 }}
                >
                  <GridItem item={item} selected={selectedId === item.id}
                    onClick={() => setSelectedId(item.id)}
                    onDoubleClick={() => handleDoubleClick(item)}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                    onView={() => setPreviewFile(item)} />
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div className={styles.list} initial="hide" animate="show">
              <div className={styles.listHead}>
                <div>Имя</div>
                <div>Изменён</div>
                <div>Размер</div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <MoreVertical size={14} style={{ color: MUTED }} />
                </div>
              </div>
              {sorted.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.12, delay: i * 0.015 }}
                >
                  <ListItem item={item} selected={selectedId === item.id}
                    onClick={() => setSelectedId(item.id)}
                    onDoubleClick={() => handleDoubleClick(item)}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                    onView={() => setPreviewFile(item)} />
                </motion.div>
              ))}
            </motion.div>
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
      </main>

      {previewFile && (
        <div style={{
          width: 480, borderLeft: "1px solid var(--color-surface-border)",
          display: "flex", flexDirection: "column", background: "var(--color-surface)",
        }}>
          <FileViewer file={previewFile} onClose={() => setPreviewFile(null)} onEdited={() => loadFiles(currentPath)} />
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          item={contextMenu.item} x={contextMenu.x} y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onRename={() => { setRenameTarget(contextMenu.item); setRenameValue(contextMenu.item.name); setContextMenu(null); }}
          onDownload={() => handleDownload(contextMenu.item)}
          onDelete={() => handleDelete(contextMenu.item)}
        />
      )}

      {contextMenu && (
        <ContextMenu
          item={contextMenu.item} x={contextMenu.x} y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onRename={() => { setRenameTarget(contextMenu.item); setRenameValue(contextMenu.item.name); setContextMenu(null); }}
          onDownload={() => handleDownload(contextMenu.item)}
          onDelete={() => handleDelete(contextMenu.item)}
        />
      )}

      {renameTarget && (
        <>
          <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 1999 }} onClick={() => setRenameTarget(null)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "var(--color-surface)", border: "1px solid var(--color-surface-border)", borderRadius: "var(--radius-md)", padding: "18px 22px", minWidth: 320, boxShadow: "0 20px 50px rgba(0,0,0,0.4)", zIndex: 2000 }}
          >
            <h3 style={{ fontSize: 13, fontWeight: 600, color: PRIMARY, marginBottom: 12 }}>Переименовать</h3>
            <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doRename(); if (e.key === "Escape") setRenameTarget(null); }}
              style={{ width: "100%", padding: "8px 10px", borderRadius: "var(--radius-sm)", background: "rgba(0,0,0,0.2)", border: "1px solid var(--color-surface-border)", color: PRIMARY, fontSize: 13, marginBottom: 14 }} autoFocus />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setRenameTarget(null)} style={{ padding: "6px 14px", borderRadius: "var(--radius-sm)", background: "var(--color-surface)", border: "1px solid var(--color-surface-border)", color: SECONDARY, fontSize: 12, cursor: "pointer" }}>Отмена</button>
              <button onClick={doRename} style={{ padding: "6px 14px", borderRadius: "var(--radius-sm)", background: "var(--color-accent)", border: "1px solid var(--color-accent-border)", color: "#fff", fontSize: 12, cursor: "pointer" }}>Готово</button>
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
}: {
  item: FileInfo; x: number; y: number;
  onClose: () => void; onRename: () => void;
  onDownload: () => void; onDelete: () => void;
}) {
  const menuStyle: React.CSSProperties = {
    position: "fixed", top: y, left: x,
    background: "var(--color-surface)", border: "1px solid var(--color-surface-border)",
    borderRadius: "var(--radius-sm)", padding: "4px", minWidth: 180,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)", zIndex: 200,
  };
  return (
    <>
      <motion.div
        style={menuStyle}
        initial={{ opacity: 0, scale: 0.9, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: -4 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        <button style={{ display: "block", width: "100%", padding: "6px 10px", textAlign: "left", fontSize: 12, background: "transparent", border: "none", color: PRIMARY, cursor: "pointer", borderRadius: "var(--radius-sm)" }} onClick={() => { if (!item.isDir) onDownload(); else onClose(); }}>
          <Download size={12} style={{ marginRight: 6 }} /> Скачать
        </button>
        <button style={{ display: "block", width: "100%", padding: "6px 10px", textAlign: "left", fontSize: 12, background: "transparent", border: "none", color: PRIMARY, cursor: "pointer", borderRadius: "var(--radius-sm)" }} onClick={() => { navigator.clipboard.writeText(item.name); onClose(); }}>
          <Copy size={12} style={{ marginRight: 6 }} /> Копировать путь
        </button>
        <hr style={{ border: 0, height: 1, background: "var(--color-surface-border)", margin: "4px 0" }} />
        <button style={{ display: "block", width: "100%", padding: "6px 10px", textAlign: "left", fontSize: 12, background: "transparent", border: "none", color: PRIMARY, cursor: "pointer", borderRadius: "var(--radius-sm)" }} onClick={() => { onRename(); onClose(); }}>
          <Edit3 size={12} style={{ marginRight: 6 }} /> Переименовать
        </button>
        <button style={{ display: "block", width: "100%", padding: "6px 10px", textAlign: "left", fontSize: 12, background: "transparent", border: "none", color: "var(--color-error)", cursor: "pointer", borderRadius: "var(--radius-sm)" }} onClick={() => { onDelete(); onClose(); }}>
          <Trash2 size={12} style={{ marginRight: 6 }} /> Удалить
        </button>
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
      node.children = children;
      node.loaded = true;
      setRootNodes((prev) => [...prev]);
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
            onClick={() => isDir ? toggleExpand(node, fullPath) : onNavigate(fullPath)}
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
            onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = "var(--color-surface-hover)"; e.currentTarget.style.color = "var(--color-text-primary)"; } }}
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
  onClick: () => void; onDoubleClick: () => void;
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
    >
      <div className={styles.gridThumb} style={{ "--thumb-color": color } as React.CSSProperties}>
        <Icon size={30} strokeWidth={1.4} />
      </div>
      <div className={styles.gridName} title={item.name}>{item.name}</div>
      <div className={styles.gridMeta}>
        {item.isDir ? `${item.sizeBytes || 0} эл.` : formatBytes(item.sizeBytes)}
      </div>
      {!item.isDir && isPreviewable && (
        <button
          onClick={(e) => { e.stopPropagation(); onView(); }}
          style={{
            position: "absolute", top: 8, right: 8,
            width: 20, height: 20, borderRadius: "var(--radius-sm)",
            background: "rgba(0,0,0,0.3)", border: "1px solid var(--color-surface-border)",
            color: "var(--color-text-secondary)", cursor: "pointer",
            display: "grid", placeItems: "center", opacity: 0,
            transition: "opacity 0.15s",
          }}
          title="Просмотр"
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0"; }}
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
  onClick: () => void; onDoubleClick: () => void;
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
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          display: "grid", placeItems: "center", color,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
        }}>
          <Icon size={15} strokeWidth={1.6} />
        </div>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.name}>
          {item.name}
        </span>
      </div>
      <div style={{ color: SECONDARY, fontSize: 12 }}>{formatTimeAgo(item.updatedAt)}</div>
      <div style={{ color: SECONDARY, fontSize: 12 }}>{item.isDir ? "—" : formatBytes(item.sizeBytes)}</div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {!item.isDir && (
          <button
            onClick={(e) => { e.stopPropagation(); onView(); }}
            style={{
              width: 24, height: 22, borderRadius: "var(--radius-sm)",
              background: "transparent", border: "1px solid var(--color-surface-border)",
              color: "var(--color-text-secondary)", cursor: "pointer",
              display: "grid", placeItems: "center",
            }}
            title="Просмотр"
          >
            <FileText size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
