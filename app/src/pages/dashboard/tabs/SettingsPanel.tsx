import { useEffect, useState } from "react";
import { clearServerUrl, getServerUrl, type UserInfo } from "../../../api/auth";
import { SettingsIcon } from "../../../shared/icons/Icons";
import styles from "./SettingsPanel.module.css";

/**
 * Реальное содержимое раздела "Настройки" (раньше была заглушка). Пока
 * здесь только адрес сервера — единственная настройка, которая появилась
 * с введением ServerSetupPage — но структура (карточка + строки) рассчитана
 * на то, что сюда позже добавятся другие настройки.
 *
 * "Сменить сервер" стирает сохранённый адрес через server_config.rs
 * (clear_server_url) — App.tsx на следующем рендере обнаружит отсутствие
 * адреса и покажет ServerSetupPage, тем же путём, что и при самом первом
 * запуске. Обязательно требует подтверждения — это разрывает текущую
 * сессию тоже, раз сервер меняется, и должно происходить осознанно.
 */
export default function SettingsPanel({ user }: { user: UserInfo | null }) {
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  const [confirmingChange, setConfirmingChange] = useState(false);

  useEffect(() => {
    getServerUrl().then(setServerUrlState).catch(() => setServerUrlState(null));
  }, []);

  const handleChangeServer = async () => {
    await clearServerUrl();
    // Перезагружаем окно — самый надёжный способ вернуть App.tsx в
    // состояние "сервер не настроен" без протаскивания состояния
    // через контекст/пропсы через весь компонент-дерево ради одного
    // редкого действия.
    window.location.reload();
  };

  return (
    <div className={styles.panel}>
      <div className={styles.card}>
        <div className={styles.cardLabel}>Аккаунт</div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Пользователь</span>
          <span className={styles.rowValue}>{user?.display_name || user?.username || "—"}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Роль</span>
          <span className={styles.rowValue}>{user?.role || "—"}</span>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardLabel}>Подключение</div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>
            <SettingsIcon size={13} />
            Сервер
          </span>
          <span className={styles.rowValue}>{serverUrl ?? "—"}</span>
        </div>

        {!confirmingChange ? (
          <button className={styles.changeServerButton} onClick={() => setConfirmingChange(true)}>
            Сменить сервер
          </button>
        ) : (
          <div className={styles.confirmBar}>
            <span className={styles.confirmText}>
              Потребуется войти заново. Продолжить?
            </span>
            <div className={styles.confirmActions}>
              <button
                className={`${styles.confirmButton} ${styles.confirmButtonDanger}`}
                onClick={handleChangeServer}
              >
                Сменить
              </button>
              <button
                className={`${styles.confirmButton} ${styles.confirmButtonNeutral}`}
                onClick={() => setConfirmingChange(false)}
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
