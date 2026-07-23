import { useEffect, useMemo, useState } from "react";
import { clearServerUrl, getServerUrl, type UserInfo } from "../../../api/auth";
import {
  changeUserPassword,
  createUser,
  deleteUser,
  listUsers,
  updateUserQuota,
  type ManagedUser,
} from "../../../api/users";
import { SettingsIcon } from "../../../shared/icons/Icons";
import styles from "./SettingsPanel.module.css";

const GB = 1024 ** 3;

const QUOTA_OPTIONS = [
  { label: "10 GB", value: 10 * GB },
  { label: "50 GB", value: 50 * GB },
  { label: "100 GB", value: 100 * GB },
  { label: "Unlimited", value: null },
];

function formatQuota(bytes: number | null) {
  if (bytes === null) return "Unlimited";
  return `${Math.round(bytes / GB)} GB`;
}

function parseQuota(value: string) {
  if (value === "custom") return undefined;
  if (value === "unlimited") return null;
  return Number(value);
}

export default function SettingsPanel({ user }: { user: UserInfo | null }) {
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  const [confirmingChange, setConfirmingChange] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState(user?.username ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [createForm, setCreateForm] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "user" as "admin" | "user",
    quota: String(10 * GB),
    customQuotaGb: "",
  });

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    getServerUrl().then(setServerUrlState).catch(() => setServerUrlState(null));
  }, []);

  const loadUsers = async () => {
    if (!isAdmin) return;
    try {
      setUsersError(null);
      setUsers(await listUsers());
    } catch (err) {
      setUsersError(String(err));
    }
  };

  useEffect(() => {
    loadUsers();
  }, [isAdmin]);

  useEffect(() => {
    if (user?.username) setPasswordTarget(user.username);
  }, [user?.username]);

  const quotaValue = useMemo(() => {
    if (createForm.quota === "custom") {
      const gb = Number(createForm.customQuotaGb);
      return Number.isFinite(gb) && gb > 0 ? Math.round(gb * GB) : 10 * GB;
    }
    return parseQuota(createForm.quota) ?? null;
  }, [createForm.quota, createForm.customQuotaGb]);

  const handleChangeServer = async () => {
    await clearServerUrl();
    window.location.reload();
  };

  const handleCreateUser = async () => {
    setBusy(true);
    try {
      await createUser({
        username: createForm.username,
        password: createForm.password,
        display_name: createForm.displayName || undefined,
        role: createForm.role,
        quota_bytes: quotaValue,
      });
      setCreateForm({ username: "", displayName: "", password: "", role: "user", quota: String(10 * GB), customQuotaGb: "" });
      await loadUsers();
    } catch (err) {
      setUsersError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!passwordTarget || !newPassword) return;
    setBusy(true);
    try {
      await changeUserPassword(passwordTarget, {
        current_password: passwordTarget === user?.username ? currentPassword : undefined,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      await loadUsers();
    } catch (err) {
      setUsersError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleQuota = async (target: string, value: string) => {
    setBusy(true);
    try {
      await updateUserQuota(target, parseQuota(value) ?? null);
      await loadUsers();
    } catch (err) {
      setUsersError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (target: string) => {
    if (!window.confirm(`Удалить пользователя ${target}? Его активные сессии будут отозваны.`)) return;
    setBusy(true);
    try {
      await deleteUser(target);
      await loadUsers();
    } catch (err) {
      setUsersError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.card}>
        <div className={styles.cardLabel}>Аккаунт</div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Пользователь</span>
          <span className={styles.rowValue}>{user?.display_name || user?.username || "-"}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Роль</span>
          <span className={styles.rowValue}>{user?.role || "-"}</span>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardLabel}>Управление пользователями</div>
        {!isAdmin ? (
          <div className={styles.notice}>Раздел доступен только администратору.</div>
        ) : (
          <>
            {usersError && <div className={styles.errorText}>{usersError}</div>}
            <div className={styles.userTable}>
              {users.map((item) => (
                <div key={item.username} className={styles.userRow}>
                  <div className={styles.userMeta}>
                    <span className={styles.userTitle}>{item.display_name || item.username}</span>
                    <span className={styles.userSub}>{item.username} · {item.role} · {formatQuota(item.quota_bytes)}</span>
                  </div>
                  <select
                    className={styles.select}
                    value={item.quota_bytes === null ? "unlimited" : String(item.quota_bytes)}
                    disabled={busy}
                    onChange={(e) => handleQuota(item.username, e.target.value)}
                  >
                    {QUOTA_OPTIONS.map((option) => (
                      <option key={option.label} value={option.value === null ? "unlimited" : option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className={styles.iconDangerButton}
                    disabled={busy || item.username === user?.username}
                    onClick={() => handleDelete(item.username)}
                    title="Удалить пользователя"
                  >
                    Удалить
                  </button>
                </div>
              ))}
            </div>

            <div className={styles.formGrid}>
              <input className={styles.input} placeholder="Логин" value={createForm.username} onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))} />
              <input className={styles.input} placeholder="Отображаемое имя" value={createForm.displayName} onChange={(e) => setCreateForm((f) => ({ ...f, displayName: e.target.value }))} />
              <input className={styles.input} placeholder="Пароль" type="password" value={createForm.password} onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))} />
              <select className={styles.select} value={createForm.role} onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as "admin" | "user" }))}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <select className={styles.select} value={createForm.quota} onChange={(e) => setCreateForm((f) => ({ ...f, quota: e.target.value }))}>
                {QUOTA_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value === null ? "unlimited" : option.value}>{option.label}</option>
                ))}
                <option value="custom">Своя квота</option>
              </select>
              {createForm.quota === "custom" && (
                <input className={styles.input} placeholder="GB" inputMode="numeric" value={createForm.customQuotaGb} onChange={(e) => setCreateForm((f) => ({ ...f, customQuotaGb: e.target.value }))} />
              )}
              <button className={styles.changeServerButton} disabled={busy} onClick={handleCreateUser}>
                Создать пользователя
              </button>
            </div>

            <div className={styles.passwordBox}>
              <select className={styles.select} value={passwordTarget} onChange={(e) => setPasswordTarget(e.target.value)}>
                {users.map((item) => <option key={item.username} value={item.username}>{item.username}</option>)}
              </select>
              {passwordTarget === user?.username && (
                <input className={styles.input} placeholder="Текущий пароль" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              )}
              <input className={styles.input} placeholder="Новый пароль" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <button className={styles.changeServerButton} disabled={busy || !newPassword || (passwordTarget === user?.username && !currentPassword)} onClick={handlePasswordChange}>
                Сменить пароль
              </button>
            </div>
          </>
        )}
      </div>

      <div className={`${styles.card} ${styles.disabledCard}`}>
        <div className={styles.cardLabel}>База данных</div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Источник данных</span>
          <span className={styles.badge}>В разработке</span>
        </div>
        <div className={styles.notice}>Подключение внешней PostgreSQL/mycelium будет добавлено в следующей версии.</div>
      </div>

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
