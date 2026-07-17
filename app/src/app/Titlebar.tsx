import styles from "./AppShell.module.css";

/** true, если приложение запущено внутри Tauri (а не в обычном браузере). */
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

/**
 * Кастомный titlebar в стиле macOS (кнопки close/minimize/maximize слева).
 * Управляет нативным окном Tauri; в браузере (dev-режим без Tauri) кнопки
 * рендерятся, но ничего не делают — это ожидаемо для веб-превью.
 */
export default function Titlebar() {
  const handleClose = async () => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  };

  const handleMinimize = async () => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().toggleMaximize();
  };

  return (
    <div className={styles.titlebar}>
      <div className={styles.titlebarControls}>
        <button
          className={`${styles.ctrlBtn} ${styles.ctrlBtnClose}`}
          onClick={handleClose}
          title="Закрыть"
        />
        <button
          className={`${styles.ctrlBtn} ${styles.ctrlBtnMinimize}`}
          onClick={handleMinimize}
          title="Свернуть"
        />
        <button
          className={`${styles.ctrlBtn} ${styles.ctrlBtnMaximize}`}
          onClick={handleMaximize}
          title="Развернуть"
        />
      </div>
      <div className={styles.titlebarDrag} data-tauri-drag-region>
        <span className={styles.titlebarTitle}>Loza</span>
      </div>
    </div>
  );
}
