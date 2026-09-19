import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  File as FileIcon,
  Folder,
  Link2,
  Lock,
  Loader,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { fileApi } from "../../../api/filesService";
import { logger } from "../../../shared/utils/logger";
import { ShareInfo } from "../../../types/files";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SharesTab() {
  const [shares, setShares] = useState<ShareInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [busyToken, setBusyToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setShares(await fileApi.listShares());
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить ссылки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeShares = shares.filter((s) => s.isActive);
  const revokedShares = shares.filter((s) => !s.isActive);

  const handleCopy = async (share: ShareInfo) => {
    try {
      const url = await fileApi.getShareUrl(share.token);
      try {
        await navigator.clipboard.writeText(url);
        setCopiedToken(share.token);
        setTimeout(() => setCopiedToken(null), 1500);
      } catch (e) {
        logger.warning("files", "clipboard write failed", e);
      }
    } catch (e: any) {
      logger.warning("files", "copy share url failed", e);
    }
  };

  const handleRevoke = async (share: ShareInfo) => {
    const label = share.name || share.token.slice(0, 12);
    if (!window.confirm(`Отозвать ссылку на «${label}»? Общий доступ будет прекращено.`)) {
      return;
    }
    setBusyToken(share.token);
    try {
      await fileApi.revokeShare(share.token);
      await load();
    } catch (e: any) {
      setError(e?.message || "Не удалось отозвать ссылку");
    } finally {
      setBusyToken(null);
    }
  };

  const renderShare = (share: ShareInfo) => {
    const active = share.isActive;
    const name = share.name || "—";
    const path = share.path && share.path !== name ? share.path : name;
    return (
      <div
        key={share.id}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          borderRadius: "var(--radius-md)",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid var(--color-glass-border)",
          opacity: active ? 1 : 0.55,
        }}
      >
        {share.isDir ? (
          <Folder size={20} color="var(--color-accent)" style={{ flexShrink: 0 }} />
        ) : (
          <FileIcon size={20} color="var(--color-text-secondary)" style={{ flexShrink: 0 }} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              style={{ fontWeight: 600, color: "var(--color-text-primary)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={path}
            >
              {name}
            </span>
            {share.hasPassword && (
              <span title="Защищена паролем" style={{ display: "inline-flex", flexShrink: 0 }}>
                <Lock size={12} color="var(--color-accent)" />
              </span>
            )}
            <span
              style={{
                flexShrink: 0,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                padding: "2px 6px",
                borderRadius: 6,
                color: active ? "var(--color-success)" : "var(--color-text-muted)",
                background: active ? "rgba(62,207,110,0.12)" : "rgba(255,255,255,0.05)",
              }}
            >
              {active ? "Активна" : "Отозвана"}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {path} · создана {formatDate(share.createdAt)}
          </div>
        </div>

        {active && (
          <button
            onClick={() => handleCopy(share)}
            title="Скопировать ссылку"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-glass-border)",
              background: "transparent",
              color: copiedToken === share.token ? "var(--color-success)" : "var(--color-text-secondary)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {copiedToken === share.token ? <X size={14} /> : <Copy size={14} />}
          </button>
        )}

        {active && (
          <button
            onClick={() => handleRevoke(share)}
            disabled={busyToken === share.token}
            title="Отозвать ссылку"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              height: 30,
              padding: "0 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid rgba(255,100,100,0.4)",
              background: "rgba(255,60,60,0.08)",
              color: "var(--color-error)",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {busyToken === share.token ? <Loader size={12} className="spinning" /> : <Trash2 size={13} />}
            {busyToken === share.token ? "Отзываем…" : "Отозвать"}
          </button>
        )}
      </div>
    );
  };

  const displayShares = [...activeShares, ...revokedShares];

  return (
    <div style={{ padding: 28, maxWidth: 860, margin: "0 auto", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link2 size={18} color="var(--color-accent)" />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)" }}>Общие ссылки</h2>
          {!loading && (
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {activeShares.length} активн.
            </span>
          )}
        </div>
        <button
          onClick={load}
          title="Обновить"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 12px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-glass-border)",
            background: "rgba(255,255,255,0.05)",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          <RefreshCw size={13} className={loading ? "spinning" : undefined} />
          Обновить
        </button>
      </div>

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            background: "rgba(255,60,60,0.1)",
            color: "var(--color-error)",
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 0", color: "var(--color-text-muted)" }}>
          <Loader size={20} className="spinning" />
          <span style={{ fontSize: 13 }}>Загружаем ссылки…</span>
        </div>
      ) : displayShares.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            padding: "48px 0",
            borderRadius: "var(--radius-lg)",
            background: "rgba(255,255,255,0.03)",
            border: "1px dashed var(--color-glass-border)",
            color: "var(--color-text-muted)",
          }}
        >
          <Link2 size={26} />
          <span style={{ fontSize: 13 }}>Пока нет общих ссылок. Создать их можно через «Поделиться ссылкой» в Loza.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{displayShares.map(renderShare)}</div>
      )}
    </div>
  );
}