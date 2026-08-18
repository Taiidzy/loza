import { useState, useEffect, useCallback } from "react";
import { FileInfo } from "../../types/files";
import { fileApi } from "../../api/filesService";
import { logger } from "../../shared/utils/logger";
import {
  Download, FileText, Code, File, AlertCircle, Loader,
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

export default function FileViewer({ file, onClose, onEdited }: FileViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editorContent, setEditorContent] = useState("");
  const [saving, setSaving] = useState(false);

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
      const parentPath = file.path.substring(0, file.path.lastIndexOf("/"));
      // Backend rejects overwrites — delete first, then upload
      try { await fileApi.deleteFile(file.path); } catch { /* ignore — file may not exist */ }
      await fileApi.uploadFile(parentPath, file.name, data);
      onEdited();
      setIsEditing(false);
    } catch (e: any) {
      setError(e.message || "Failed to save file");
      logger.error("files", "FileViewer save error", e);
    } finally {
      setSaving(false);
    }
  };

  const name = file.name;
  const mt = file.mimeType;
  const previewable = isImage(name, mt) || isVideo(name, mt) || isAudio(name, mt) || isPdf(name, mt);
  const textable = isText(name, mt);
  const editable = isEditable(name);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0,
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 20px",
        borderBottom: "1px solid var(--color-surface-border)",
        gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <FileText size={18} style={{ color: "var(--color-text-secondary)" }} />
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>
            {name}
          </span>
          {file.sizeBytes > 0 && (
            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{formatBytes(file.sizeBytes)}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {editable && !isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              style={{
                padding: "6px 12px",
                borderRadius: "var(--radius-sm)",
                background: "var(--color-surface)",
                border: "1px solid var(--color-surface-border)",
                color: "var(--color-text-primary)",
                fontSize: 12,
                cursor: "pointer",
              }}
              title="Редактировать"
            >
              <Code size={14} style={{ marginRight: 6 }} />
              Редактировать
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: "6px 12px",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-surface)",
              border: "1px solid var(--color-surface-border)",
              color: "var(--color-text-secondary)",
              fontSize: 12,
              cursor: "pointer",
            }}
            title="Закрыть"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflow: "auto",
        padding: 20,
        minHeight: 0,
      }}>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
            <Loader size={24} style={{ color: "var(--color-text-muted)", animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Загрузка…</span>
          </div>
        ) : error ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "var(--color-error)", padding: 20 }}>
            <AlertCircle size={24} />
            <span style={{ fontSize: 13 }}>{error}</span>
          </div>
        ) : isEditing && editable ? (
          /* Editor mode */
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <textarea
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
              style={{
                flex: 1,
                minHeight: "calc(100vh - 200px)",
                background: "var(--color-surface)",
                border: "1px solid var(--color-surface-border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--color-text-primary)",
                fontSize: 13,
                fontFamily: "ui-monospace, 'Fira Code', 'Fira Mono', Consolas, 'Courier New', monospace",
                padding: 14,
                outline: "none",
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => { setEditorContent(textContent || ""); setIsEditing(false); }}
                disabled={saving}
                style={{
                  padding: "6px 14px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-surface-border)",
                  color: "var(--color-text-secondary)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "6px 14px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-accent)",
                  border: "1px solid var(--color-accent-border)",
                  color: "#fff",
                  fontSize: 12,
                  cursor: saving ? "wait" : "pointer",
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        ) : previewable && blobUrl ? (
          isPdf(name, mt) ? (
            <iframe
              src={blobUrl}
              title={name}
              style={{ width: "100%", height: "100%", border: "none", borderRadius: "var(--radius-sm)" }}
            />
          ) : isImage(name, mt) ? (
            <img
              src={blobUrl}
              alt={name}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "var(--radius-sm)" }}
            />
          ) : isVideo(name, mt) ? (
            <video src={blobUrl} controls style={{ maxWidth: "100%", borderRadius: "var(--radius-sm)" }} />
          ) : isAudio(name, mt) ? (
            <audio src={blobUrl} controls style={{ width: "100%" }} />
          ) : null
        ) : textable && textContent !== null ? (
          <SyntaxHighlighter
            language={getLanguage(name)}
            style={vscDarkPlus}
            customStyle={{
              backgroundColor: "rgba(20, 20, 28, 0.6)",
              borderRadius: "var(--radius-sm)",
              padding: 16,
              fontSize: 13,
            }}
            wrapLongLines
          >
            {textContent}
          </SyntaxHighlighter>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 40, color: "var(--color-text-muted)" }}>
            <File size={42} strokeWidth={1.2} />
            <span style={{ fontSize: 13 }}>Просмотр недоступен для этого типа файла</span>
            <button
              onClick={async () => {
                try {
                  const blob = await fileApi.downloadFile(file.path);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = name;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  logger.error("files", "Download failed", e);
                }
              }}
              style={{
                padding: "8px 16px",
                borderRadius: "var(--radius-sm)",
                background: "var(--color-accent)",
                border: "1px solid var(--color-accent-border)",
                color: "#fff",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <Download size={14} style={{ marginRight: 6 }} /> Скачать
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
            background: var(--color-surface);
            border: 1px solid var(--color-surface-border);
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 13px;
          }
        `}</style>
      )}
    </div>
  );
}
