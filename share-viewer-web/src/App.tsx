import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Archive,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  File,
  FileCode,
  FileText,
  Film,
  Folder,
  HardDrive,
  Image as ImageIcon,
  Loader,
  Lock,
  Music2,
  ShieldCheck,
  X,
} from "lucide-react";
import { ShareEntry, ShareMeta, shareApi, tokenFromPath } from "./api";

// ─── Состояние страницы ────────────────────────────────────────────────────

type Screen =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "locked"; meta: ShareMeta }
  | { kind: "ready"; meta: ShareMeta; access: string };

// ─── Утилиты ───────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "КБ", "МБ", "ГБ", "ТБ"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Файл, который можно смотреть прямо в браузере (фото/PDF). */
function isPreviewable(entry: ShareEntry): boolean {
  if (entry.isDir) return false;
  const mime = entry.mimeType ?? "";
  return mime.startsWith("image/") || mime === "application/pdf";
}

function iconFor(entry: Pick<ShareEntry, "isDir" | "mimeType" | "name">, size = 20): React.ReactNode {
  if (entry.isDir) return <Folder size={size} color="var(--color-accent)" />;
  const mime = entry.mimeType ?? "";
  const ext = entry.name.includes(".") ? entry.name.split(".").pop()!.toLowerCase() : "";
  if (mime.startsWith("image/")) return <ImageIcon size={size} color="var(--color-violet)" />;
  if (mime.startsWith("video/")) return <Film size={size} color="var(--color-violet)" />;
  if (mime.startsWith("audio/")) return <Music2 size={size} color="var(--color-violet)" />;
  if (mime.startsWith("text/") || ["md", "rs", "ts", "tsx", "js", "py", "go", "json", "yaml", "toml", "sql", "sh"].includes(ext)) {
    return <FileCode size={size} color="var(--color-text-muted)" />;
  }
  if (mime === "application/pdf" || ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"].includes(ext)) {
    return <FileText size={size} color="var(--color-text-muted)" />;
  }
  if (mime.includes("zip") || ["zip", "tar", "gz", "7z", "rar"].includes(ext)) {
    return <Archive size={size} color="var(--color-text-muted)" />;
  }
  return <File size={size} color="var(--color-text-muted)" />;
}

// ─── App ────────────────────────────────────────────────────────────────────

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });

  useEffect(() => {
    const token = tokenFromPath();
    if (!token) {
      setScreen({ kind: "error", message: "Ссылка не распознана" });
      return;
    }
    let cancelled = false;
    shareApi
      .meta(token)
      .then((meta) => {
        if (cancelled) return;
        if (!meta.isActive) {
          setScreen({ kind: "error", message: "Ссылка больше не действует или была отозвана" });
          return;
        }
        if (!meta.hasPassword) {
          // Разблокировка без пароля — сразу получаем access-токен.
          shareApi.unlock(token, "").then(
            (res) => {
              if (!cancelled) setScreen({ kind: "ready", meta, access: res.access });
            },
            (e: Error) => {
              if (!cancelled) setScreen({ kind: "error", message: e.message });
            },
          );
          return;
        }
        setScreen({ kind: "locked", meta });
      })
      .catch((e: Error) => {
        if (!cancelled) setScreen({ kind: "error", message: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (screen.kind === "loading") {
    return (
      <Shell>
        <Loader className="sv-spin" size={26} color="var(--color-accent)" />
      </Shell>
    );
  }
  if (screen.kind === "error") {
    return (
      <Shell>
        <Card width={420}>
          <div className="sv-center-y" style={{ gap: 10, marginBottom: 6 }}>
            <AlertCircle size={20} color="var(--color-error)" />
            <h1 className="sv-title">Общий доступ</h1>
          </div>
          <p className="sv-muted" style={{ margin: 0 }}>{screen.message}</p>
        </Card>
      </Shell>
    );
  }
  if (screen.kind === "locked") {
    return <UnlockScreen meta={screen.meta} onUnlocked={(access) => setScreen({ kind: "ready", meta: screen.meta as ShareMeta, access })} />;
  }
  if (screen.meta.isDir) {
    return <FolderScreen meta={screen.meta} access={screen.access} />;
  }
  return <FileScreen meta={screen.meta} access={screen.access} />;
}

function UnlockScreen({
  meta,
  onUnlocked,
}: {
  meta: ShareMeta;
  onUnlocked: (access: string) => void;
}): React.JSX.Element {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const token = tokenFromPath();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await shareApi.unlock(token, password);
      onUnlocked(res.access);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [password, onUnlocked]);

  return (
    <Shell>
      <Card width={420}>
        <div className="sv-unlock-icon">
          <Lock size={22} color="var(--color-accent)" />
        </div>
        <h1 className="sv-title" style={{ textAlign: "center" }}>{meta.name}</h1>
        <p className="sv-muted" style={{ textAlign: "center", margin: "2px 0 18px" }}>
          Этот ресурс защищён паролем
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Пароль"
            className={`sv-input ${error ? "sv-input--error" : ""}`}
          />
          {error && (
            <div className="sv-error">
              <AlertCircle size={12} />
              <span>{error}</span>
            </div>
          )}
          <button type="submit" disabled={busy} className="sv-btn-accent">
            {busy ? <Loader size={14} className="sv-spin" /> : <ShieldCheck size={14} />}
            {busy ? "Проверяем…" : "Открыть"}
          </button>
        </form>
      </Card>
    </Shell>
  );
}

// ─── Папка ─────────────────────────────────────────────────────────────────

function FolderScreen({ meta, access }: { meta: ShareMeta; access: string }): React.JSX.Element {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<ShareEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Индекс в списке просматриваемых файлов (фото/PDF) — для lightbox.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    const token = tokenFromPath();
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    shareApi
      .list(token, access, path)
      .then((list) => {
        if (!cancelled) {
          setEntries(list);
          setLoading(false);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [access, path]);

  const previewables = entries.filter(isPreviewable);
  const previewEntry = previewIndex !== null ? previewables[previewIndex] ?? null : null;

  const crumbs = path ? path.split("/") : [];
  const goCrumb = (index: number) => setPath(crumbs.slice(0, index + 1).join("/"));

  return (
    <Shell>
      <Card width={880}>
        <div className="sv-head">
          <div className="sv-head-title">
            {meta.isDir ? (
              <Folder size={18} color="var(--color-accent)" />
            ) : (
              iconFor(meta, 18)
            )}
            <span>{meta.name}</span>
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="sv-crumbs" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className="sv-crumb"
            onClick={() => setPath("")}
            style={{ opacity: path ? 1 : 0.55 }}
          >
            Корень
          </button>
          {crumbs.map((part, i) => (
            <span key={`${part}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <ChevronRight size={12} color="var(--color-text-faint)" />
              <button type="button" className="sv-crumb" onClick={() => goCrumb(i)}>
                {part}
              </button>
            </span>
          ))}
        </div>

        {loading ? (
          <div className="sv-center" style={{ padding: "40px 0" }}>
            <Loader size={22} className="sv-spin" color="var(--color-text-muted)" />
          </div>
        ) : error ? (
          <div className="sv-error" style={{ justifyContent: "center", padding: "24px 0" }}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="sv-center" style={{ padding: "36px 0", color: "var(--color-text-muted)", fontSize: 13 }}>
            Папка пуста
          </div>
        ) : (
          <div className="sv-grid">
            {entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                access={access}
                onOpen={() => {
                  if (entry.isDir) setPath(entry.path);
                }}
                onShow={() => {
                  const index = previewables.findIndex((p) => p.id === entry.id);
                  if (index >= 0) setPreviewIndex(index);
                }}
              />
            ))}
          </div>
        )}

        {previewEntry && previewIndex !== null && (
          <Lightbox
            entry={previewEntry}
            access={access}
            index={previewIndex}
            total={previewables.length}
            onClose={() => setPreviewIndex(null)}
            onPrev={() => setPreviewIndex((previewIndex - 1 + previewables.length) % previewables.length)}
            onNext={() => setPreviewIndex((previewIndex + 1) % previewables.length)}
          />
        )}
      </Card>
    </Shell>
  );
}

function EntryRow({
  entry,
  access,
  onOpen,
  onShow,
}: {
  entry: ShareEntry;
  access: string;
  onOpen: () => void;
  onShow: () => void;
}): React.JSX.Element {
  const token = tokenFromPath();
  const previewable = isPreviewable(entry);
  const clickable = entry.isDir || previewable;
  const handleClick = () => {
    if (entry.isDir) onOpen();
    else if (previewable) onShow();
  };
  return (
    <div
      className="sv-row"
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {iconFor(entry, 18)}
      <span className="sv-row-name">{entry.name}</span>
      {!entry.isDir && <span className="sv-row-size">{formatBytes(entry.sizeBytes)}</span>}
      {previewable && token && (
        <button className="sv-icon-btn" title="Просмотреть" onClick={(e) => { e.stopPropagation(); onShow(); }}>
          <Eye size={14} />
        </button>
      )}
      {!entry.isDir && token && (
        <a
          className="sv-icon-btn"
          title="Скачать"
          href={shareApi.downloadUrl(token, access, entry.path)}
          onClick={(e) => e.stopPropagation()}
        >
          <Download size={14} />
        </a>
      )}
      {entry.isDir && <ChevronRight size={13} color="var(--color-text-faint)" />}
    </div>
  );
}

// ─── Лайтбокс предпросмотра (фото/PDF внутри расшаренной папки) ─────────────

function Lightbox({
  entry,
  access,
  index,
  total,
  onClose,
  onPrev,
  onNext,
}: {
  entry: ShareEntry;
  access: string;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}): React.JSX.Element {
  const token = tokenFromPath();
  const preview = token ? shareApi.previewUrl(token, access, entry.path) : "";
  const download = token ? shareApi.downloadUrl(token, access, entry.path) : "";
  const isPdf = entry.mimeType === "application/pdf";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="sv-overlay" onClick={onClose}>
      {total > 1 && (
        <button
          type="button"
          className="sv-nav-btn sv-nav-btn--left"
          title="Предыдущий (←)"
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
        >
          <ChevronLeft size={22} />
        </button>
      )}

      <div className="sv-lightbox" onClick={(e) => e.stopPropagation()}>
        <div className="sv-lightbox-head">
          <span className="sv-lightbox-title">
            {iconFor(entry, 16)}
            <span>{entry.name}</span>
          </span>
          <div className="sv-lightbox-actions">
            {total > 1 && (
              <span className="sv-muted" style={{ fontSize: 12, flexShrink: 0 }}>
                {index + 1} / {total}
              </span>
            )}
            <button type="button" className="sv-icon-btn" title="Скачать" onClick={() => { window.location.href = download; }}>
              <Download size={14} />
            </button>
            <button type="button" className="sv-icon-btn" title="Закрыть (Esc)" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </div>
        {isPdf ? (
          <iframe src={preview} title={entry.name} className="sv-lightbox-frame" />
        ) : (
          <img src={preview} alt={entry.name} className="sv-lightbox-img" />
        )}
      </div>

      {total > 1 && (
        <button
          type="button"
          className="sv-nav-btn sv-nav-btn--right"
          title="Следующий (→)"
          onClick={(e) => { e.stopPropagation(); onNext(); }}
        >
          <ChevronRight size={22} />
        </button>
      )}
    </div>
  );
}

// ─── Один файл ─────────────────────────────────────────────────────────────

function FileScreen({ meta, access }: { meta: ShareMeta; access: string }): React.JSX.Element {
  const token = tokenFromPath();
  if (!token) {
    return <Shell><Card width={420}><p className="sv-muted">Что-то пошло не так</p></Card></Shell>;
  }
  const preview = shareApi.previewUrl(token, access, "");
  const download = shareApi.downloadUrl(token, access, "");
  const isImage = (meta.mimeType ?? "").startsWith("image/");
  const isPdf = meta.mimeType === "application/pdf";

  return (
    <Shell>
      <Card width={760}>
        <div className="sv-head">
          <div className="sv-head-title">{iconFor(meta, 18)}<span>{meta.name}</span></div>
          <div className="sv-head-actions">
            {meta.sizeBytes !== null && meta.sizeBytes > 0 && (
              <span className="sv-muted" style={{ fontSize: 12 }}>{formatBytes(meta.sizeBytes)}</span>
            )}
            <a className="sv-btn-accent" href={download}>
              <Download size={14} />
              Скачать
            </a>
          </div>
        </div>

        {isImage ? (
          <div className="sv-preview-box">
            <img src={preview} alt={meta.name} className="sv-preview-img" />
          </div>
        ) : isPdf ? (
          <div className="sv-preview-box" style={{ height: 560 }}>
            <iframe src={preview} title={meta.name} style={{ width: "100%", height: "100%", border: "none", borderRadius: "var(--radius-sm)" }} />
          </div>
        ) : (
          <div className="sv-center" style={{ flexDirection: "column", gap: 10, padding: "48px 0", color: "var(--color-text-muted)" }}>
            {iconFor(meta, 34)}
            <span style={{ fontSize: 13 }}>
              Предпросмотр этого типа файлов недоступен{meta.sizeBytes !== null ? ` · ${formatBytes(meta.sizeBytes)}` : ""}
            </span>
            <a className="sv-btn-accent sv-btn-accent--sm" href={download}>
              <Download size={14} />
              Скачать файл
            </a>
          </div>
        )}
      </Card>
    </Shell>
  );
}

// ─── Каркас ────────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="sv-shell">
      <div className="sv-logo">
        <HardDrive size={16} color="var(--color-accent)" />
        <span>Loza</span>
      </div>
      <div className="sv-shell-content">{children}</div>
      <div className="sv-footer">Loza · защищённый общий доступ</div>
    </div>
  );
}

function Card({ children, width }: { children: React.ReactNode; width: number }): React.JSX.Element {
  return (
    <div className="sv-card" style={{ maxWidth: width }}>
      {children}
    </div>
  );
}