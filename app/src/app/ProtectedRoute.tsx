import type { PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";
import { loadSession } from "../api/auth";

/**
 * Пропускает к дочернему контенту только пользователей с активной сессией.
 * Если сессии нет (или истёк срок токена) — редиректит на /auth.
 */
export default function ProtectedRoute({ children }: PropsWithChildren) {
  const session = loadSession();

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}
