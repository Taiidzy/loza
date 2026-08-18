import { useCallback, useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { authLogout, getCurrentUser, type UserInfo } from "../../api/auth";
import { fetchServerStatus, subscribeServerStatus } from "../../api/serverStatus";
import { ActivityIcon, GridIcon, LeafIcon, LogoutIcon, SettingsIcon } from "../../shared/icons/Icons";
import { type DashboardSection } from "../../components/Dashboard/DashboardNav";
import DashboardOverview from "./tabs/DashboardTab";
import styles from "./DashboardPage.module.css";
import Activity from "./tabs/ActivityTab";
import SettingsPanel from "./tabs/SettingsPanel";
import { ServerStatus } from "../../types/serverStatus";
import LozaTab from "./tabs/LozaTab";

const NAV_SECTIONS: { id: DashboardSection; label: string; icon: ReactNode }[] = [
  { id: "dashboard", label: "Обзор", icon: <GridIcon /> },
  { id: "activity", label: "Активность", icon: <ActivityIcon /> },
  { id: "loza", label: "Loza", icon: <LeafIcon /> },
  { id: "settings", label: "Настройки", icon: <SettingsIcon /> },
];

const MenuToggleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="12" x2="21" y2="12"></line>
    <line x1="3" y1="6" x2="21" y2="6"></line>
    <line x1="3" y1="18" x2="21" y2="18"></line>
  </svg>
);

export default function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | null>(null);

  const [activeSection, setActiveSection] = useState<DashboardSection>("dashboard");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [time, setTime] = useState(new Date());

  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const isDashboardActive = activeSection === "dashboard";

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    getCurrentUser().then(setUser).catch(() => setUser(null));
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

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    subscribeServerStatus((data) => {
      setStatus(data);
      setStatusError(null);
      setStatusLoading(false);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadStatus]);

  const handleLogout = async () => {
    await authLogout();
    navigate("/auth");
  };

  const timeStr = time.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = time.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

  const userDisplayName = user?.display_name || user?.username;

  return (
    <div className={styles.page}>
      {/* ── Сайдбар ── */}
      <motion.aside
        className={styles.sidebar}
        initial={false}
        animate={{ width: isSidebarOpen ? 220 : 64 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className={styles.userBadge}>
          <motion.div 
            className={styles.profileWrapper}
            initial={false}
            animate={{ 
              opacity: isSidebarOpen ? 1 : 0, 
              width: isSidebarOpen ? 154 : 0 // Анимируем к жестко заданному значению
            }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className={styles.profileInner}>
              <div className={styles.userAvatar}>{(userDisplayName || "U")[0].toUpperCase()}</div>
              <div className={styles.userInfo}>
                <div className={styles.userName}>{userDisplayName}</div>
                <div className={styles.userRole}>{user?.role}</div>
              </div>
            </div>
          </motion.div>

          <button className={styles.toggleBtn} onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            <MenuToggleIcon />
          </button>
        </div>

        <div className={styles.sidebarNav}>
          {NAV_SECTIONS.map((section) => (
            <div key={section.id} onClick={() => setActiveSection(section.id)} className={`${styles.navItem} ${activeSection === section.id ? styles.active : ""}`}>
              {section.icon}
              <motion.span 
                 initial={false}
                 animate={{ opacity: isSidebarOpen ? 1 : 0, width: isSidebarOpen ? "auto" : 0, marginLeft: isSidebarOpen ? 12 : 0 }}
                 style={{ overflow: "hidden", whiteSpace: "nowrap" }}
                 transition={{ duration: 0.25, ease: "easeInOut" }}
              >
                {section.label}
              </motion.span>
            </div>
          ))}
        </div>

        <AnimatePresence>
          {!isDashboardActive && (
            <motion.div
              className={styles.sidebarDateTime}
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: "auto", marginTop: "auto" }}
              exit={{ opacity: 0, height: 0, marginTop: 0, overflow: "hidden" }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              {isSidebarOpen ? (
                <>
                  <div className={styles.sidebarDate}>{dateStr}</div>
                  <div className={styles.sidebarTime}>{timeStr}</div>
                </>
              ) : (
                <div className={styles.sidebarTime} style={{ fontSize: "11px" }}>{timeStr.substring(0, 5)}</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <button onClick={handleLogout} className={styles.logoutButton}>
          <LogoutIcon />
          <motion.span 
            initial={false}
            animate={{ opacity: isSidebarOpen ? 1 : 0, width: isSidebarOpen ? "auto" : 0, marginLeft: isSidebarOpen ? 12 : 0 }}
            style={{ overflow: "hidden", whiteSpace: "nowrap" }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            Выйти
          </motion.span>
        </button>
      </motion.aside>

      {/* ── Основной контент ── */}
      <main className={styles.main}>
        <AnimatePresence initial={false}>
          {isDashboardActive && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              style={{ overflow: "hidden", flexShrink: 0 }}
            >
              <div className={styles.header}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div className={styles.greetingIcon}>
                    <LeafIcon />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className={styles.headerTitle}>Обзор системы</div>
                    <div className={styles.headerDate}>{dateStr}</div>
                  </div>
                </div>
                <div className={styles.headerTime}>{timeStr}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className={styles.body}>
          {activeSection === "dashboard" && (
            <DashboardOverview
              status={status}
              statusError={statusError}
              statusLoading={statusLoading}
              onRetry={loadStatus}
              userDisplayName={userDisplayName}
            />
          )}

          {activeSection === "activity" && <Activity />}
          {activeSection === "loza" && <LozaTab />}
          {activeSection === "settings" && <SettingsPanel />}
        </div>
      </main>
    </div>
  );
}