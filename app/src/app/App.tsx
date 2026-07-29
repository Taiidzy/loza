import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import Titlebar from "./Titlebar";
import AuthPage from "../pages/auth/AuthPage";
import ServerSetupPage from "../pages/server-setup/ServerSetupPage";
import DashboardPage from "../pages/dashboard/DashboardPage";
import { getServerUrl } from "../api/auth";
import styles from "./AppShell.module.css";

/**
 * Корневой компонент приложения: определяет платформу (десктоп/мобильный),
 * рисует кастомный titlebar (только на десктопе) и настраивает роутинг.
 *
 * Перед всем остальным — гейт по адресу сервера: если он ещё не настроен
 * (первый запуск, server_config.rs хранилище пусто), показываем
 * ServerSetupPage вместо любого другого маршрута. Это аналог того, как
 * ProtectedRoute гейтит по сессии, только на уровень выше — без адреса
 * сервера ProtectedRoute всё равно не сможет ничего залогинить.
 */
export default function App() {
  const [serverConfigured, setServerConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getServerUrl()
      .then((url) => {
        if (!cancelled) setServerConfigured(url !== null);
      })
      .catch(() => {
        if (!cancelled) setServerConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={`${styles.shell}`}>

      {serverConfigured === null ? (
        // Мгновенная проверка стора при старте — обычно не видна пользователю,
        // но избегает "мигания" ServerSetupPage перед тем, как AuthPage
        // окажется настоящим экраном (сервер уже был настроен ранее).
        <div style={{ width: "100%", height: "100%", background: "transparent" }} />
      ) : !serverConfigured ? (
        <ServerSetupPage onConfigured={() => setServerConfigured(true)} />
      ) : (
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      )}
    </div>
  );
}
