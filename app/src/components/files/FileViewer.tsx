import { useState, useEffect, useCallback, useRef } from "react";
import { FileInfo } from "../../types/files";
import { fileApi } from "../../api/filesService";
import { logger } from "../../shared/utils/logger";
import {
  Download, FileText, Code, File, AlertCircle, Loader,
  X, RotateCcw, RotateCw,
  ZoomIn, ZoomOut, Share2,
} from "lucide-react";
import { formatBytes } from "../../shared/utils/serverStorage";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface FileViewerProps {
  file: FileInfo;
  onClose: () => void;
  onEdited: () => void;
}

const TEXT_EXTENSIONS = ["txt", "md", "json", "yaml", "yml", "toml", "ini", "csv", "xml", "html", "css", "js", "ts", "jsx", "tsx", "py", "rs", "go", "c", "cpp", "h", "hpp", "sh", "log", "conf", "cfg"];
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/svg+xml", "image/avif"];
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/x-matroska"];
const AUDIO_MIMES = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/flac", "audio/mp4"];
const EDITABLE_EXTENSIONS = ["txt", "md", "json", "yaml", "yml", "toml", "ini", "csv", "xml", "html", "css", "js", "ts", "jsx", "tsx", "py", "rs", "go", "c", "cpp", "h", "hpp", "sh", "log"];

function getExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

function isText(name: string, mimeType: string | null): boolean {
  const ext = getExtension(name);
  if (TEXT_EXTENSIONS.includes(ext)) return true;
  if (mimeType && mimeType.startsWith("text/")) return true;
  if (mimeType === "application/json" || mimeType === "application/xml") return true;
  return false;
}

function isImage(name: string, mimeType: string | null): boolean {
  const ext = getExtension(name);
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif"].includes(ext)) return true;
  return mimeType ? IMAGE_MIMES.includes(mimeType) : false;
}

function isVideo(name: string, mimeType: string | null): boolean {
  const ext = getExtension(name);
  if (["mp4", "webm", "mov", "avi", "mkv"].includes(ext)) return true;
  return mimeType ? VIDEO_MIMES.includes(mimeType) : false;
}

function isAudio(name: string, mimeType: string | null): boolean {
  const ext = getExtension(name);
  if (["mp3", "wav", "ogg", "flac", "m4a"].includes(ext)) return true;
  return mimeType ? AUDIO_MIMES.includes(mimeType) : false;
}

function isPdf(name: string, mimeType: string | null): boolean {
  return getExtension(name) === "pdf" || mimeType === "application/pdf";
}

function isEditable(name: string): boolean {
  return EDITABLE_EXTENSIONS.includes(getExtension(name));
}

function getLanguage(name: string): string | undefined {
  return getExtension(name) || undefined;
}

export function isFileEditable(file: FileInfo): boolean {
  return !file.isDir && isEditable(file.name);
}

export function isFilePreviewable(file: FileInfo): boolean {
  if (file.isDir) return false;
  const name = file.name;
  const mt = file.mimeType;
  return isImage(name, mt) || isVideo(name, mt) || isAudio(name, mt) || isText(name, mt) || isPdf(name, mt);
}

interface ToolbarButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

function ToolbarButton({ onClick, disabled, title, children, style }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: "var(--radius-sm)",
        background: disabled ? "transparent" : "var(--color-glass-surface)",
        border: "1px solid var(--color-glass-border)",
        color: disabled ? "var(--color-text-muted)" : "var(--color-text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.15s",
        opacity: disabled ? 0.4 : 1,
        ...style,
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--color-glass-hover)"; e.currentTarget.style.color = "var(--color-text-primary)"; } }}
      onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--color-glass-surface)"; e.currentTarget.style.color = "var(--color-text-secondary)"; } }}
    >
      {children}
    </button>
  );
}

export default function FileViewer({ file, onClose, onEdited }: FileViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editorContent, setEditorContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const pdfRef = useRef<HTMLIFrameElement>(null);

  const loadContent = useCallback(async () => {
    if (file.isDir) return;

    const name = file.name;
    const mt = file.mimeType;

    const previewable = isImage(name, mt) || isVideo(name, mt) || isAudio(name, mt) || isPdf(name, mt);
    const textable = isText(name, mt);

    try {
      if (previewable || textable) {
        const blob = await fileApi.downloadFile(file.path);
        if (textable) {
          const text = await blob.text();
          setTextContent(text);
          setEditorContent(text);
        } else {
          const url = URL.createObjectURL(blob);
          setBlobUrl(url);
        }
      }
    } catch (e: any) {
      setError(e.message || "Failed to load file");
      logger.error("files", "FileViewer load error", e);
    } finally {
      setLoading(false);
    }
  }, [file]);

  useEffect(() => {
    loadContent();
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [loadContent, blobUrl]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = new TextEncoder().encode(editorContent).buffer;
      const lastSlash = file.path.lastIndexOf("/");
      const parentPath = lastSlash >= 0 ? file.path.substring(0, lastSlash) : "";
      await fileApi.uploadFile(parentPath, file.name, data, true);
      onEdited();
      setIsEditing(false);
    } catch (e: any) {
      setError(e.message || "Failed to save file");
      logger.error("files", "FileViewer save error", e);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async () => {
    try {
      const blob = await fileApi.downloadFile(file.path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      logger.error("files", "Download failed", e);
    }
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(file.name);
    } catch (e) {
      logger.error("files", "Share failed", e);
    }
  };

  const name = file.name;
  const mt = file.mimeType;
  const previewable = isImage(name, mt) || isVideo(name, mt) || isAudio(name, mt) || isPdf(name, mt);
  const textable = isText(name, mt);
  const editable = isEditable(name);
  const isImageFile = isImage(name, mt);

  const resetView = () => {
    setZoom(1);
    setRotation(0);
  };

  const zoomIn = () => setZoom((z) => Math.min(z * 1.2, 5));
  const zoomOut = () => setZoom((z) => Math.max(z / 1.2, 0.1));
  const rotateLeft = () => setRotation((r) => (r - 90) % 360);
  const rotateRight = () => setRotation((r) => (r + 90) % 360);

  const renderPreviewContent = () => {
    if (!blobUrl) return null;
    if (isPdf(name, mt)) {
      return (
        <iframe
          ref={pdfRef}
          src={blobUrl}
          title={name}
          style={{ width: "100%", height: "100%", border: "none", borderRadius: "var(--radius-sm)", background: "var(--color-popup-surface)" }}
        />
      );
    }
    if (isImageFile) {
      return (
        <img
          ref={imageRef}
          src={blobUrl}
          alt={name}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            borderRadius: "var(--radius-sm)",
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
            transformOrigin: "center center",
            transition: "transform 0.15s ease-out",
            cursor: zoom > 1 ? "grab" : "default",
          }}
        />
      );
    }
    if (isVideo(name, mt)) {
      return <video src={blobUrl} controls style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: "var(--radius-sm)" }} />;
    }
    if (isAudio(name, mt)) {
      return <audio src={blobUrl} controls style={{ width: "100%", maxWidth: 400 }} />;
    }
    return null;
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0,
      background: "var(--color-popup-surface)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid var(--color-popup-border)",
        gap: 12,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
          <FileText size={18} style={{ color: "var(--color-text-secondary)", flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>
            {name}
          </span>
          {file.sizeBytes > 0 && (
            <span style={{ fontSize: 11, color: "var(--color-text-muted)", flexShrink: 0 }}>{formatBytes(file.sizeBytes)}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {/* Image controls */}
          {isImageFile && blobUrl && !isEditing && (
            <div style={{ display: "flex", gap: 2, padding: "0 4px", borderRight: "1px solid var(--color-popup-border)" }}>
              <ToolbarButton onClick={zoomOut} title="Уменьшить" ><ZoomOut size={14} /></ToolbarButton>
              <ToolbarButton onClick={zoomIn} title="Увеличить" ><ZoomIn size={14} /></ToolbarButton>
              <ToolbarButton onClick={resetView} title="Сбросить" ><RotateCcw size={14} /></ToolbarButton>
              <ToolbarButton onClick={rotateLeft} title="Повернуть влево" ><RotateCcw size={14} /></ToolbarButton>
              <ToolbarButton onClick={rotateRight} title="Повернуть вправо" ><RotateCw size={14} /></ToolbarButton>
            </div>
          )}
          {/* Actions */}
          <div style={{ display: "flex", gap: 2 }}>
            {editable && !isEditing && (
              <ToolbarButton onClick={() => setIsEditing(true)} title="Редактировать" ><Code size={14} /></ToolbarButton>
            )}
            <ToolbarButton onClick={handleDownload} title="Скачать" ><Download size={14} /></ToolbarButton>
            <ToolbarButton onClick={handleShare} title="Поделиться" ><Share2 size={14} /></ToolbarButton>
            <ToolbarButton onClick={onClose} title="Закрыть" style={{ marginLeft: 4 }}><X size={14} /></ToolbarButton>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflow: "auto",
        padding: 16,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-popup-bg)",
      }}>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "var(--color-text-muted)" }}>
            <Loader size={24} style={{ animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 13 }}>Загрузка…</span>
          </div>
        ) : error ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "var(--color-error)", padding: 20 }}>
            <AlertCircle size={24} />
            <span style={{ fontSize: 13 }}>{error}</span>
          </div>
        ) : isEditing && editable ? (
          <div style={{ width: "100%", maxWidth: 900, display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
            <textarea
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
              style={{
                flex: 1,
                minHeight: 0,
                background: "var(--color-popup-surface)",
                border: "1px solid var(--color-popup-border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--color-text-primary)",
                fontSize: 13,
                fontFamily: "ui-monospace, 'Fira Code', 'Fira Mono', Consolas, 'Courier New', monospace",
                padding: 14,
                outline: "none",
                resize: "none",
                lineHeight: 1.5,
              }}
              spellCheck={false}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexShrink: 0 }}>
              <button
                onClick={() => { setEditorContent(textContent || ""); setIsEditing(false); }}
                disabled={saving}
                style={{
                  padding: "8px 16px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-popup-surface)",
                  border: "1px solid var(--color-popup-border)",
                  color: "var(--color-text-secondary)",
                  fontSize: 12,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-glass-hover)"; e.currentTarget.style.color = "var(--color-text-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--color-popup-surface)"; e.currentTarget.style.color = "var(--color-text-secondary)"; }}
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "8px 16px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-accent)",
                  border: "1px solid var(--color-accent-border)",
                  color: "#fff",
                  fontSize: 12,
                  cursor: saving ? "wait" : "pointer",
                  opacity: saving ? 0.7 : 1,
                  fontWeight: 500,
                }}
              >
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        ) : previewable && blobUrl ? (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {renderPreviewContent()}
          </div>
        ) : textable && textContent !== null ? (
          <div style={{ width: "100%", maxWidth: 900, height: "100%", display: "flex", flexDirection: "column" }}>
            <SyntaxHighlighter
              language={getLanguage(name)}
              style={vscDarkPlus}
              customStyle={{
                backgroundColor: "rgba(20, 20, 28, 0.6)",
                borderRadius: "var(--radius-sm)",
                padding: 16,
                fontSize: 13,
                flex: 1,
                minHeight: 0,
                overflow: "auto",
              }}
              wrapLongLines
            >
              {textContent}
            </SyntaxHighlighter>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: 40, color: "var(--color-text-muted)", textAlign: "center" }}>
            <File size={48} strokeWidth={1.2} />
            <span style={{ fontSize: 14 }}>Просмотр недоступен для этого типа файла</span>
            <button
              onClick={handleDownload}
              style={{
                padding: "10px 20px",
                borderRadius: "var(--radius-sm)",
                background: "var(--color-accent)",
                border: "1px solid var(--color-accent-border)",
                color: "#fff",
                fontSize: 13,
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              <Download size={14} style={{ marginRight: 6, verticalAlign: "middle" }} /> Скачать файл
            </button>
          </div>
        )}
      </div>

      {/* Markdown content styling */}
      {textable && textContent !== null && getExtension(name) === "md" && (
        <style>{`
          .markdown-body {
            color: var(--color-text-primary);
            font-size: 14px;
            line-height: 1.6;
          }
          .markdown-body pre {
            background: rgba(20, 20, 28, 0.6);
            border-radius: var(--radius-sm);
            padding: 12px;
            overflow: auto;
          }
          .markdown-body code {
            background: var(--color-popup-surface);
            border: 1px solid var(--color-popup-border);
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 13px;
          }
        `}</style>
      )}
    </div>
  );
}