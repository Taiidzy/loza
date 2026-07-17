import { useCallback, useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { authLogout, loadSession } from "../../api/auth";
import { fetchServerStatus, type ServerStatus } from "../../api/serverStatus";
import { useIsMobile } from "../../shared/hooks/useIsMobile";
import { ActivityIcon, GridIcon, LeafIcon, LogoutIcon, SettingsIcon } from "../../shared/icons/Icons";
import { NavItem, TabItem, type DashboardSection } from "../../components/Dashboard/DashboardNav";
import DashboardOverview from "./tabs/DashboardTab";
import styles from "./DashboardPage.module.css";
import Activity from "./tabs/ActivityTab";

/** Как часто опрашивать сервер за свежим статусом. */
const STATUS_POLL_INTERVAL_MS = 2000;

/** Подписи и иконки для каждого раздела — общий источник для сайдбара и таббара. */
const NAV_SECTIONS: { id: DashboardSection; label: string; icon: ReactNode }[] = [
  { id: "dashboard", label: "Обзор", icon: <GridIcon /> },
  { id: "activity", label: "Активность", icon: <ActivityIcon /> },
  { id: "loza", label: "Loza", icon: <LeafIcon /> },
  { id: "settings", label: "Настройки", icon: <SettingsIcon /> },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const session = loadSession();
  const isMobile = useIsMobile();

  const [activeSection, setActiveSection] = useState<DashboardSection>("dashboard");
  const [time, setTime] = useState(new Date());

  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Часы в шапке — обновляются раз в секунду
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

  // Первичная загрузка статуса + периодический опрос сервера
  useEffect(() => {
    loadStatus();
    const id = setInterval(loadStatus, STATUS_POLL_INTERVAL_MS);
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

  const userDisplayName = session?.display_name || session?.username;

  return (
    <div className={`${styles.page} ${isMobile ? styles.mobile : ""}`}>
      {/* ── Сайдбар (десктоп) ── */}
      {!isMobile && (
        <motion.aside
          className={styles.sidebar}
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className={styles.userBadge}>
            <div className={styles.userAvatar}>{(userDisplayName || "U")[0].toUpperCase()}</div>
            <div style={{ minWidth: 0 }}>
              <div className={styles.userName}>{userDisplayName}</div>
              <div className={styles.userRole}>{session?.role}</div>
            </div>
          </div>

          <div className={styles.sidebarNav}>
            {NAV_SECTIONS.map((section) => (
              <NavItem
                key={section.id}
                icon={section.icon}
                label={section.label}
                active={activeSection === section.id}
                onClick={() => setActiveSection(section.id)}
              />
            ))}
          </div>

          <button onClick={handleLogout} className={styles.logoutButton}>
            <LogoutIcon />
            Выйти
          </button>
        </motion.aside>
      )}

      {/* ── Основной контент ── */}
      <main className={styles.main}>
        <motion.div
          className={`${styles.header} ${isMobile ? styles.mobile : ""}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.35 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div className={styles.greetingIcon}>
              <LeafIcon />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className={`${styles.headerTitle} ${isMobile ? styles.mobile : ""}`}>Обзор системы</div>
              <div className={styles.headerDate}>{dateStr}</div>
            </div>
          </div>
          <div className={styles.headerTime}>{timeStr}</div>
        </motion.div>

        <div className={`${styles.body} ${isMobile ? styles.mobile : ""}`}>
          {activeSection === "dashboard" && (
            <DashboardOverview
              isMobile={isMobile}
              status={status}
              statusError={statusError}
              statusLoading={statusLoading}
              onRetry={loadStatus}
              userDisplayName={userDisplayName}
            />
          )}

          {activeSection === "activity" && (
            <Activity />
          )}

          {activeSection === "loza" && (
            <DashboardPlaceholder section={activeSection} />
          )}

          {activeSection === "settings" && (
            <DashboardPlaceholder section={activeSection} />
          )}
        </div>

        {/* ── Таббар (мобильный) ── */}
        {isMobile && (
          <motion.nav
            className={styles.tabBar}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            {NAV_SECTIONS.map((section) => (
              <TabItem
                key={section.id}
                icon={section.icon}
                label={section.label}
                active={activeSection === section.id}
                onClick={() => setActiveSection(section.id)}
              />
            ))}
            <TabItem icon={<LogoutIcon />} label="Выйти" active={false} onClick={handleLogout} />
          </motion.nav>
        )}
      </main>
    </div>
  );
}

// ─── Заглушка для разделов без контента ─────────────────────────────────────

const PLACEHOLDER_LABELS: Record<Exclude<DashboardSection, "dashboard">, string> = {
  activity: "Раздел «Активность» в разработке",
  loza: "Раздел «Loza» в разработке",
  settings: "Раздел «Настройки» в разработке",
};

/**
 * Временная заглушка для разделов навигации, у которых ещё нет контента.
 * Раньше клик по этим вкладкам в сайдбаре/таббаре подсвечивал пункт меню,
 * но экран не менялся вообще — выглядело как баг. Явная заглушка честно
 * показывает пользователю, что раздел ещё не готов.
 */
function DashboardPlaceholder({ section }: { section: DashboardSection }) {
  if (section === "dashboard") return null;

  return <div className={styles.placeholderPanel}>{PLACEHOLDER_LABELS[section]}</div>;
}