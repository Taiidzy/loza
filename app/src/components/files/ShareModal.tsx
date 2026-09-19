import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { FileInfo, ShareInfo } from "../../types/files";
import { fileApi } from "../../api/filesService";
import { logger } from "../../shared/utils/logger";
import { X, Copy, Link2, Trash2, Loader, AlertCircle, CheckCircle, Lock } from "lucide-react";

interface Props {
  file: FileInfo;
  onClose: () => void;
}

export default function ShareModal({ file, onClose }: Props) {
  const [shares, setShares] = useState<ShareInfo[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listed = await fileApi.listShares(file.path);
      setShares(listed);
      const urlEntries = await Promise.all(
        listed.map(async (s) => [s.token, await fileApi.getShareUrl(s.token)] as const)
      );
      setUrls(Object.fromEntries(urlEntries));
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить ссылки");
      logger.error("files", "listShares error", e);
    } finally {
      setLoading(false);
    }
  }, [file.path]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    const trimmed = password.trim();
    if (file.isDir && !trimmed) {
      setPasswordError("Для папки пароль обязателен");
      return;
    }
    setPasswordError(null);
    setCreating(true);
    setError(null);
    try {
      const created = await fileApi.createShare(file.path, trimmed || undefined);
      await navigator.clipboard.writeText(created.url);
      setCopiedToken(created.share.token);
      setTimeout(() => setCopiedToken(null), 2000);
      setPassword("");
      await load();
    } catch (e: any) {
      setError(e?.message || "Не удалось создать ссылку");
      logger.error("files", "createShare error", e);
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (token: string) => {
    try {
      const url = await fileApi.getShareUrl(token);
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch (e) {
      logger.error("files", "copy share url error", e);
    }
  };

  const handleRevoke = async (token: string) => {
    try {
      await fileApi.revokeShare(token);
      await load();
    } catch (e: any) {
      setError(e?.message || "Не удалось отозвать ссылку");
      logger.error("files", "revokeShare error", e);
    }
  };

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          zIndex: 2000,
        }}
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "var(--color-glass-surface)",
          border: "1px solid var(--color-glass-border)",
          borderRadius: "var(--radius-md)",
          padding: "18px 22px",
          minWidth: 340,
          maxWidth: 440,
          maxHeight: "70vh",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
          zIndex: 2001,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Ссылки · {file.name}
          </h3>
          <button
            onClick={onClose}
            style={{
              width: 24,
              height: 24,
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              border: "1px solid transparent",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            <X size={12} />
          </button>
        </div>

        {error && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: "var(--radius-sm)", background: "rgba(255,60,60,0.1)", color: "var(--color-error)", fontSize: 12 }}>
            <AlertCircle size={13} style={{ marginTop: 2, flexShrink: 0 }} />
            <span style={{ wordBreak: "break-word" }}>{error}</span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleCreate}
              disabled={creating}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                background: creating ? "var(--color-accent)" : "var(--color-accent)",
                border: "1px solid var(--color-accent-border)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 500,
                cursor: creating ? "wait" : "pointer",
                opacity: creating ? 0.7 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {creating ? <Loader size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Link2 size={12} />}
              {creating ? "Создание…" : "Создать ссылку"}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError(null);
              }}
              placeholder={
                file.isDir ? "Пароль для доступа (обязателен)" : "Пароль для доступа (необязательно)"
              }
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(255,255,255,0.05)",
                border: `1px solid ${passwordError ? "var(--color-error)" : "var(--color-glass-border)"}`,
                color: "var(--color-text-primary)",
                fontSize: 12,
                outline: "none",
                boxSizing: "border-box",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !creating) {
                  handleCreate();
                }
              }}
            />
            {passwordError ? (
              <div style={{ fontSize: 11, color: "var(--color-error)" }}>{passwordError}</div>
            ) : (
              <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                {file.isDir
                  ? "Ссылкой смогут воспользоваться только те, кто знает пароль"
                  : "Без пароля ссылку откроет любой, у кого она есть"}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
            <Loader size={18} style={{ animation: "spin 1s linear infinite", color: "var(--color-text-muted)" }} />
          </div>
        ) : shares.length === 0 ? (
          <div style={{ padding: "16px 10px", textAlign: "center", fontSize: 12, color: "var(--color-text-muted)" }}>
            Активных ссылок нет
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, overflow: "auto", maxHeight: "40vh" }}>
            {shares.map((s) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--color-glass-border)",
                  fontSize: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                  {s.hasPassword && (
                    <Lock size={10} color="#ffb6d2" style={{ flexShrink: 0 }} />
                  )}
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: s.isActive ? "var(--color-text-secondary)" : "var(--color-text-muted)",
                    }}
                  >
                    {urls[s.token] ?? `/share/${s.token}`}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={() => handleCopy(s.token)}
                    title="Скопировать ссылку"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "var(--radius-sm)",
                      background: "transparent",
                      border: "1px solid var(--color-glass-border)",
                      color: copiedToken === s.token ? "var(--color-success)" : "var(--color-text-secondary)",
                      cursor: "pointer",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {copiedToken === s.token ? <CheckCircle size={10} /> : <Copy size={10} />}
                  </button>
                  {s.isActive && (
                    <button
                      onClick={() => handleRevoke(s.token)}
                      title="Отозвать ссылку"
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "var(--radius-sm)",
                        background: "transparent",
                        border: "1px solid var(--color-glass-border)",
                        color: "var(--color-error)",
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-glass-surface)",
              border: "1px solid var(--color-glass-border)",
              color: "var(--color-text-secondary)",
              fontSize: 12,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            Закрыть
          </button>
        </div>
      </motion.div>
    </>
  );
}