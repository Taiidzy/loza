import type { ReactNode } from "react";
import styles from "./DashboardPage.module.css";

/** Разделы дашборда, доступные через сайдбар/таббар. */
export type DashboardSection = "dashboard" | "activity" | "loza" | "settings";

interface NavEntryProps {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

/** Пункт навигации в боковой панели (десктоп). */
export function NavItem({ icon, label, active, onClick }: NavEntryProps) {
  return (
    <button onClick={onClick} className={`${styles.navItem} ${active ? styles.active : ""}`}>
      {icon}
      {label}
    </button>
  );
}

/** Пункт навигации в нижнем таббаре (мобильный). */
export function TabItem({ icon, label, active, onClick }: NavEntryProps) {
  return (
    <button onClick={onClick} className={`${styles.tabItem} ${active ? styles.active : ""}`}>
      {icon}
      {label}
    </button>
  );
}
