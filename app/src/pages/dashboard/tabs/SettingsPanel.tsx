import { useEffect, useState } from "react";
import { clearServerUrl, getServerUrl } from "../../../api/auth";
import { SettingsIcon } from "../../../shared/icons/Icons";
import styles from "./SettingsPanel.module.css";

export default function SettingsPanel() {
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  const [confirmingChange, setConfirmingChange] = useState(false);


  useEffect(() => {
    getServerUrl().then(setServerUrlState).catch(() => setServerUrlState(null));
  }, []);

  const handleChangeServer = async () => {
    await clearServerUrl();
    window.location.reload();
  };

  return (
    <div className={styles.panel}>
      <div className={styles.card}>
        <div className={styles.cardLabel}>Подключение</div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>
            <SettingsIcon size={13} />
            Сервер
          </span>
          <span className={styles.rowValue}>{serverUrl ?? "-"}</span>
        </div>

        {!confirmingChange ? (
          <button className={styles.changeServerButton} onClick={() => setConfirmingChange(true)}>
            Сменить сервер
          </button>
        ) : (
          <div className={styles.confirmBar}>
            <span className={styles.confirmText}>Потребуется войти заново. Продолжить?</span>
            <div className={styles.confirmActions}>
              <button className={`${styles.confirmButton} ${styles.confirmButtonDanger}`} onClick={handleChangeServer}>
                Сменить
              </button>
              <button className={`${styles.confirmButton} ${styles.confirmButtonNeutral}`} onClick={() => setConfirmingChange(false)}>
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
