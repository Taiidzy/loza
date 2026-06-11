import { Navigate } from "react-router-dom";
import { loadSession } from "../api/auth";

interface Props {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: Props) {
  const session = loadSession();

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}