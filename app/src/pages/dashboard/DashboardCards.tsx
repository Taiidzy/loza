import type { ReactNode } from "react";
import { motion } from "motion/react";
import type { ClientInfo, LoadInfo, ServerStatus, StorageInfo } from "../../api/serverStatus";
import StorageOrb from "../../components/StorageOrb/StorageOrb";
import Sparkline from "../../shared/ui/Sparkline";
import styles from "./DashboardPage.module.css";

// ─── Базовая карточка ───────────────────────────────────────────────────────

interface CardProps {
  children: ReactNode;
  delay: number;
  flex?: number;
  className?: string;
}

/** Карточка-контейнер с общей анимацией появления (fade + slide up). */
export function Card({ children, delay, flex = 1, className = "" }: CardProps) {
  return (
    <motion.div
      className={`${styles.card} ${className}`}
      style={{ flex }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function CardLabel({ children }: { children: ReactNode }) {
  return <div className={styles.cardLabel}>{children}</div>;
}

/** Плейсхолдер карточки на время первой загрузки данных. */
export function CardSkeleton({ delay }: { delay: number }) {
  return (
    <motion.div
      className={styles.cardSkeleton}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    />
  );
}

// ─── Карточка клиентов ──────────────────────────────────────────────────────

export function ClientsCard({ clients, delay }: { clients: ClientInfo[]; delay: number }) {
  const activeCount = clients.filter((c) => c.active).length;

  return (
    <Card delay={delay}>
      <CardLabel>Клиенты</CardLabel>
      <div className={styles.clientsCount}>
        <span className={styles.clientsCountValue}>{activeCount}</span>
        <span className={styles.clientsCountLabel}>активно из {clients.length}</span>
      </div>

      <div className={styles.clientsList}>
        {clients.length === 0 ? (
          <div className={styles.clientsEmpty}>Нет подключённых устройств</div>
        ) : (
          clients.map((client) => (
            <div key={client.id} className={styles.clientRow}>
              <span className={`${styles.clientStatusDot} ${client.active ? styles.active : ""}`} />
              <div className={styles.clientInfo}>
                <div className={styles.clientName}>{client.name}</div>
                <div className={styles.clientDevice}>{client.device}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ─── Карточка хранилища ─────────────────────────────────────────────────────

export function StorageCard({ storage, delay }: { storage: StorageInfo; delay: number }) {
  const usedPercent = Math.min(100, Math.round((storage.usedBytes / storage.totalBytes) * 100));
  const freeGB = Math.round((storage.totalBytes - storage.usedBytes) / 1024 ** 3);

  return (
    <Card delay={delay} flex={1.1} className={styles.storageCard}>
      <StorageOrb storage={storage} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <CardLabel>Хранилище</CardLabel>
        <div className={styles.storageValue}>{usedPercent}%</div>
        <div className={styles.storageFree}>свободно {freeGB} ГБ</div>
      </div>
    </Card>
  );
}

// ─── Карточка нагрузки ──────────────────────────────────────────────────────

export function LoadCard({ load, delay }: { load: LoadInfo; delay: number }) {
  const bars = [
    { label: "CPU", pct: load.cpuPercent, color: "rgba(180,120,255,0.75)" },
    { label: "RAM", pct: load.memPercent, color: "rgba(255,182,210,0.75)" },
  ];

  return (
    <Card delay={delay}>
      <CardLabel>Нагрузка</CardLabel>
      <div className={styles.loadHeader}>
        <div>
          <div className={styles.loadCpuValue}>
            <span className={styles.loadCpuNumber}>{load.cpuPercent}%</span>
            <span className={styles.loadCpuLabel}>CPU</span>
          </div>
          <div className={styles.loadRam}>RAM {load.memPercent}%</div>
        </div>
        <Sparkline values={load.history} color="rgba(180,120,255,0.8)" />
      </div>

      <div className={styles.loadBars}>
        {bars.map((row) => (
          <div key={row.label} className={styles.loadBarRow}>
            <span className={styles.loadBarLabel}>{row.label}</span>
            <div className={styles.loadBarTrack}>
              <motion.div
                className={styles.loadBarFill}
                style={{ background: row.color }}
                initial={{ width: 0 }}
                animate={{ width: `${row.pct}%` }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function StatusService({ isFirstLoad, status }: { isFirstLoad: boolean, status: ServerStatus }) {
  return(
    <motion.div
      className={`${styles.panel} ${styles.statusPanel}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className={styles.panelTitle}>Состояние</div>

      {isFirstLoad ? (
        <div className={styles.panelLoading}>Загрузка…</div>
      ) : (
        (status?.services ?? []).map((service) => (
          <div key={service.id} className={styles.serviceRow}>
            <span className={styles.serviceLabel}>{service.label}</span>
            <span className={`${styles.serviceStatus} ${service.ok ? styles.online : styles.offline}`}>
              <span className={`${styles.serviceStatusDot} ${service.ok ? styles.online : styles.offline}`} />
              {service.ok ? "Online" : "Offline"}
            </span>
          </div>
        ))
      )}
    </motion.div>
  );
}
