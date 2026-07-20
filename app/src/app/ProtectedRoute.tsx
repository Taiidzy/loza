import { useEffect, useState, type PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";
import { getCurrentUser } from "../api/auth";

type CheckState = "checking" | "authenticated" | "unauthenticated";

/**
 * Пропускает к дочернему контенту только пользователей с активной сессией.
 * Сессия целиком живёт в Rust (Tauri) — здесь мы только спрашиваем через
 * invoke, есть ли залогиненный пользователь. Проверка асинхронная, поэтому
 * на время запроса показываем простой экран загрузки.
 */
export default function ProtectedRoute({ children }: PropsWithChildren) {
  const [state, setState] = useState<CheckState>("checking");

  useEffect(() => {
    let cancelled = false;

    getCurrentUser()
      .then((user) => {
        if (!cancelled) setState(user ? "authenticated" : "unauthenticated");
      })
      .catch(() => {
        if (!cancelled) setState("unauthenticated");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "checking") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          width: "100vw",
          background: "#0d0d10",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "3px solid var(--color-text-faint)",
            borderTopColor: "var(--color-accent)",
            animation: "loza-spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes loza-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (state === "unauthenticated") {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}
