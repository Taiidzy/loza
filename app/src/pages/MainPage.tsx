import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { loadSession, authLogout } from "../api/auth";
import { fetchServerStatus, type ServerStatus, type ClientInfo, type StorageInfo, type LoadInfo } from "../api/serverStatus";
import StorageOrb from "../components/StorageOrb";
import { useNavigate } from "react-router-dom";

// ─── Icons ────────────────────────────────────────────────────────────────────

const LeafIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" />
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
  </svg>
);

const GridIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
  </svg>
);

const ActivityIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.07 4.93a10 10 0 0 1 1.93 3.12M4.93 4.93A10 10 0 0 0 3 8.05M3 12a9 9 0 0 0 1.07 4.24M20.93 12a9 9 0 0 1-1.07 4.24M4.93 19.07A10 10 0 0 0 8.05 21M19.07 19.07A10 10 0 0 1 15.95 21" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

// ─── Mini Sparkline ───────────────────────────────────────────────────────────

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 80, h = 28;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  });

  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />
      {/* last dot */}
      <circle
        cx={w} cy={h - ((values[values.length - 1] - min) / range) * h}
        r="2.5" fill={color}
      />
    </svg>
  );
}

// ─── Card shell ───────────────────────────────────────────────────────────────

function Card({
  children, delay, flex = 1, style,
}: { children: React.ReactNode; delay: number; flex?: number; style?: React.CSSProperties }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      style={{
        flex, minWidth: 150,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        padding: "16px 18px",
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
      {children}
    </div>
  );
}

function CardSkeleton({ delay }: { delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      style={{
        flex: 1, minWidth: 150, height: 148,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 16,
      }}
    />
  );
}

// ─── Clients card ───────────────────────────────────────────────────────────

function ClientsCard({ clients, delay }: { clients: ClientInfo[]; delay: number }) {
  const activeCount = clients.filter((c) => c.active).length;

  return (
    <Card delay={delay}>
      <CardLabel>Клиенты</CardLabel>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 28, fontWeight: 300, color: "#fff", letterSpacing: "-0.5px", lineHeight: 1 }}>
          {activeCount}
        </span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
          активно из {clients.length}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {clients.length === 0 ? (
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>Нет подключённых устройств</div>
        ) : (
          clients.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: c.active ? "#3ecf6e" : "rgba(255,255,255,0.2)",
                boxShadow: c.active ? "0 0 6px #3ecf6e88" : "none",
              }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.name}
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)" }}>
                  {c.device}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ─── Storage card ───────────────────────────────────────────────────────────

function StorageCard({ storage, delay }: { storage: StorageInfo; delay: number }) {
  const pct = Math.min(100, Math.round((storage.usedBytes / storage.totalBytes) * 100));
  const freeGB = Math.round((storage.totalBytes - storage.usedBytes) / 1024 ** 3);

  return (
    <Card delay={delay} flex={1.1} style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <StorageOrb storage={storage} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <CardLabel>Хранилище</CardLabel>
        <div style={{ fontSize: 22, fontWeight: 300, color: "#fff", letterSpacing: "-0.5px", lineHeight: 1, marginBottom: 4 }}>
          {pct}%
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
          свободно {freeGB} ГБ
        </div>
      </div>
    </Card>
  );
}

// ─── Load card ──────────────────────────────────────────────────────────────

function LoadCard({ load, delay }: { load: LoadInfo; delay: number }) {
  return (
    <Card delay={delay}>
      <CardLabel>Нагрузка</CardLabel>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 24, fontWeight: 300, color: "#fff", letterSpacing: "-0.5px", lineHeight: 1 }}>
              {load.cpuPercent}%
            </span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>CPU</span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>
            RAM {load.memPercent}%
          </div>
        </div>
        <Sparkline values={load.history} color="rgba(180,120,255,0.8)" />
      </div>

      {/* мини бары CPU / RAM */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[
          { label: "CPU", pct: load.cpuPercent, color: "rgba(180,120,255,0.75)" },
          { label: "RAM", pct: load.memPercent, color: "rgba(255,182,210,0.75)" },
        ].map((row) => (
          <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", width: 26 }}>{row.label}</span>
            <div style={{ flex: 1, height: 4, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${row.pct}%` }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                style={{ height: "100%", background: row.color, borderRadius: 3 }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({
  icon, label, active, onClick,
}: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 9,
        padding: "8px 12px", borderRadius: 10,
        background: active ? "rgba(255,182,210,0.12)" : "transparent",
        border: active ? "1px solid rgba(255,182,210,0.2)" : "1px solid transparent",
        color: active ? "rgba(255,182,210,0.9)" : "rgba(255,255,255,0.38)",
        fontSize: 12, fontWeight: active ? 500 : 400,
        cursor: "pointer", width: "100%", textAlign: "left",
        transition: "all 0.18s ease",
        letterSpacing: "0.02em",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── MainPage ─────────────────────────────────────────────────────────────────

export default function MainPage() {
  const navigate = useNavigate();
  const session = loadSession();
  const [activeNav, setActiveNav] = useState("dashboard");
  const [time, setTime] = useState(new Date());

  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const data = await fetchServerStatus();
      setStatus(data);
      setStatusError(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Не удалось получить статус сервера");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const id = setInterval(loadStatus, 2000); // обновляем каждые 15 сек
    return () => clearInterval(id);
  }, [loadStatus]);

  const handleLogout = async () => {
    if (session?.token) {
      await authLogout(session.token);
    }
    navigate("/auth");
  };

  const timeStr = time.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = time.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div style={{
      flex: 1, display: "flex", overflow: "hidden",
      background: "transparent",
    }}>
      {/* ── Sidebar ── */}
      <motion.aside
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: 180, flexShrink: 0,
          borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex", flexDirection: "column",
          padding: "18px 12px",
          gap: 4,
        }}
      >
        {/* User badge */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 10px 14px",
          marginBottom: 4,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: "50%",
            background: "linear-gradient(135deg, rgba(255,182,210,0.5), rgba(180,120,255,0.5))",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)",
            flexShrink: 0,
          }}>
            {(session?.display_name || session?.username || "U")[0].toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.82)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {session?.display_name || session?.username}
            </div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {session?.role}
            </div>
          </div>
        </div>

        {/* Nav */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          <NavItem icon={<GridIcon />} label="Обзор" active={activeNav === "dashboard"} onClick={() => setActiveNav("dashboard")} />
          <NavItem icon={<ActivityIcon />} label="Активность" active={activeNav === "activity"} onClick={() => setActiveNav("activity")} />
          <NavItem icon={<LeafIcon />} label="Loza" active={activeNav === "loza"} onClick={() => setActiveNav("loza")} />
          <NavItem icon={<SettingsIcon />} label="Настройки" active={activeNav === "settings"} onClick={() => setActiveNav("settings")} />
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 12px", borderRadius: 10,
            background: "transparent",
            border: "1px solid transparent",
            color: "rgba(255,100,100,0.4)",
            fontSize: 12, cursor: "pointer",
            transition: "all 0.18s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,100,100,0.75)";
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,80,80,0.08)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,100,100,0.4)";
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          }}
        >
          <LogoutIcon />
          Выйти
        </button>
      </motion.aside>

      {/* ── Main content ── */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.35 }}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "16px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.82)" }}>
              Обзор системы
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.24)", textTransform: "capitalize", marginTop: 1 }}>
              {dateStr}
            </div>
          </div>
          <div style={{
            fontVariantNumeric: "tabular-nums",
            fontSize: 13, fontWeight: 300,
            color: "rgba(255,255,255,0.4)",
            letterSpacing: "0.04em",
          }}>
            {timeStr}
          </div>
        </motion.div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Ошибка получения статуса */}
          {statusError && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "rgba(255,100,100,0.08)",
                border: "1px solid rgba(255,100,100,0.2)",
                borderRadius: 12, padding: "10px 16px",
                fontSize: 12, color: "rgba(255,140,140,0.9)",
              }}
            >
              <span>Не удалось обновить состояние сервера: {statusError}</span>
              <button
                onClick={loadStatus}
                style={{
                  background: "transparent", border: "1px solid rgba(255,140,140,0.3)",
                  borderRadius: 8, padding: "4px 10px", fontSize: 11,
                  color: "rgba(255,140,140,0.9)", cursor: "pointer",
                }}
              >
                Повторить
              </button>
            </motion.div>
          )}

          {/* Stats row */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {statusLoading && !status ? (
              <>
                <CardSkeleton delay={0.18} />
                <CardSkeleton delay={0.22} />
                <CardSkeleton delay={0.26} />
              </>
            ) : status ? (
              <>
                <ClientsCard clients={status.clients} delay={0.18} />
                <StorageCard storage={status.storage} delay={0.22} />
                <LoadCard load={status.load} delay={0.26} />
              </>
            ) : null}
          </div>

          {/* Status + Activity row */}
          <div style={{ display: "flex", gap: 12 }}>

            {/* Server status */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16, padding: "18px 20px",
              }}
            >
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>
                Состояние
              </div>

              {statusLoading && !status ? (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", padding: "8px 0" }}>
                  Загрузка…
                </div>
              ) : (
                (status?.services ?? []).map((item) => (
                  <div key={item.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                  }}>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{item.label}</span>
                    <span style={{
                      display: "flex", alignItems: "center", gap: 5,
                      fontSize: 10, color: item.ok ? "rgba(62,207,110,0.8)" : "rgba(255,100,100,0.8)",
                    }}>
                      <span style={{
                        width: 5, height: 5, borderRadius: "50%",
                        background: item.ok ? "#3ecf6e" : "#ff6464",
                        boxShadow: item.ok ? "0 0 6px #3ecf6e88" : "none",
                        display: "inline-block",
                      }} />
                      {item.ok ? "Online" : "Offline"}
                    </span>
                  </div>
                ))
              )}
            </motion.div>

            {/* Activity feed */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.34, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              style={{
                flex: 1.4,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16, padding: "18px 20px",
              }}
            >
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>
                Последние события
              </div>

              {statusLoading && !status ? (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", padding: "8px 0" }}>
                  Загрузка…
                </div>
              ) : (status?.activity ?? []).length === 0 ? (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", padding: "8px 0" }}>
                  Пока нет событий
                </div>
              ) : (
                (status?.activity ?? []).map((a, i, arr) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "7px 0",
                    borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                      background: a.type === "ok" ? "#3ecf6e" : a.type === "error" ? "#ff6464" : a.type === "warn" ? "#ffbd2e" : "rgba(255,182,210,0.6)",
                      boxShadow: a.type === "ok" ? "0 0 5px #3ecf6e66" : "none",
                    }} />
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", flex: 1 }}>{a.msg}</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.18)", fontVariantNumeric: "tabular-nums" }}>
                      {a.time}
                    </span>
                  </div>
                ))
              )}
            </motion.div>
          </div>

          {/* Greeting banner */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            style={{
              background: "linear-gradient(135deg, rgba(255,182,210,0.07) 0%, rgba(180,120,255,0.05) 100%)",
              border: "1px solid rgba(255,182,210,0.12)",
              borderRadius: 16, padding: "18px 22px",
              display: "flex", alignItems: "center", gap: 14,
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: "linear-gradient(135deg, rgba(255,182,210,0.3), rgba(180,120,255,0.3))",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "rgba(255,182,210,0.8)",
            }}>
              <LeafIcon />
            </div>
            <div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>
                Привет, {session?.display_name || session?.username} 👋
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", marginTop: 3 }}>
                {statusError
                  ? "Добро пожаловать в Loza. Не удалось связаться с сервером."
                  : status && status.services.every((s) => s.ok)
                  ? "Добро пожаловать в Loza. Всё работает штатно."
                  : "Добро пожаловать в Loza. Проверьте состояние сервисов ниже."}
              </div>
            </div>
          </motion.div>

        </div>
      </main>
    </div>
  );
}