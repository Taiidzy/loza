import { motion } from "motion/react";
import { type ServerStatus } from "../../../types/serverStatus";
import { CardSkeleton, ClientsCard, LoadCard, StorageCard } from "../../../components/Dashboard/DashboardCards";
import styles from "../DashboardPage.module.css";

// ─── Содержимое вкладки "Обзор" ─────────────────────────────────────────────

interface DashboardOverviewProps {
  isMobile: boolean;
  status: ServerStatus | null;
  statusError: string | null;
  statusLoading: boolean;
  onRetry: () => void;
  userDisplayName?: string;
}

/**
 * Основной контент дашборда: карточки статистики, статус сервисов,
 * лента активности и приветственный баннер.
 *
 * Вынесен из тела DashboardPage, чтобы остальные разделы навигации
 * (activity/loza/settings) не показывали этот контент — раньше переключение
 * вкладок вообще не влияло на то, что отображается на экране.
 */
export default function DashboardOverview({
  isMobile,
  status,
  statusError,
  statusLoading,
  onRetry,
}: DashboardOverviewProps) {
  const isFirstLoad = statusLoading && !status;

  return (
    <>
      {statusError && (
        <motion.div className={styles.errorBanner} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <span>Не удалось обновить состояние сервера: {statusError}</span>
          <button onClick={onRetry} className={styles.errorRetryButton}>
            Повторить
          </button>
        </motion.div>
      )}

      {/* Строка карточек статистики */}
      <div className={`${styles.statsRow} ${isMobile ? styles.mobile : ""}`}>
        {isFirstLoad ? (
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

      {/* Статус сервисов + лента активности */}
      <div className={`${styles.panelsRow} ${isMobile ? styles.mobile : ""}`}>

        <motion.div
          className={`${styles.panel} ${styles.activityPanel} ${isMobile ? styles.mobile : ""}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.34, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className={styles.panelTitle}>Последние события</div>

          {isFirstLoad ? (
            <div className={styles.panelLoading}>Загрузка…</div>
          ) : (status?.activity ?? []).length === 0 ? (
            <div className={styles.panelEmpty}>Пока нет событий</div>
          ) : (
            (status?.activity ?? []).map((event, i) => (
              <div key={i} className={styles.activityRow}>
                <span
                  className={styles.activityDot}
                  style={{ background: activityDotColor(event.type) }}
                />
                <span className={styles.activityMessage}>{event.msg}</span>
                <span className={styles.activityTime}>{event.time}</span>
              </div>
            ))
          )}
        </motion.div>
      </div>
    </>
  );
}

/** Цвет индикатора события в ленте активности по его типу. */
function activityDotColor(type: "info" | "ok" | "warn" | "error"): string {
  switch (type) {
    case "ok":
      return "#3ecf6e";
    case "error":
      return "#ff6464";
    case "warn":
      return "#ffbd2e";
    default:
      return "rgba(255,182,210,0.6)";
  }
}