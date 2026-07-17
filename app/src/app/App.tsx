import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import Titlebar from "./Titlebar";
import AuthPage from "../pages/auth/AuthPage";
import DashboardPage from "../pages/dashboard/DashboardPage";
import { useIsMobile } from "../shared/hooks/useIsMobile";
import styles from "./AppShell.module.css";

/**
 * Корневой компонент приложения: определяет платформу (десктоп/мобильный),
 * рисует кастомный titlebar (только на десктопе) и настраивает роутинг.
 */
export default function App() {
  const isMobile = useIsMobile();

  // Класс на <html> нужен для CSS-переопределений вне React-дерева
  // (например, в index.css для мобильных safe-area отступов).
  useEffect(() => {
    document.documentElement.classList.toggle("mobile", isMobile);
  }, [isMobile]);

  return (
    <div className={`${styles.shell} ${isMobile ? styles.mobile : ""}`}>
      {!isMobile && <Titlebar />}

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
    </div>
  );
}
