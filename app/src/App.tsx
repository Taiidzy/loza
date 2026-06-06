import { useState, useEffect, StrictMode } from "react";
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from "./components/ProtectedRoute";
import AuthPage from "./pages/AuthPage";

import "./App.css";

// Detect platform via Tauri globals
const isMobile = typeof window !== "undefined" &&
  ((window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label === undefined
    ? false
    : false) ||
  /iPhone|iPad|Android/.test(navigator.userAgent);

const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

export default function App() {
  const [platform, setPlatform] = useState("desktop");

  useEffect(() => {
    if (isMobile) {
      setPlatform("mobile");
      document.documentElement.classList.add("mobile");
    }
  }, []);

  const handleClose = async () => {
    if (isTauri) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    }
  };

  const handleMinimize = async () => {
    if (isTauri) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    }
  };

  const handleMaximize = async () => {
  if (isTauri) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().toggleMaximize();
  }
};

  return (
    <div className={`app-shell ${platform}`}>
      {/* Titlebar — only on desktop without decorations */}
      {platform !== "mobile" && (
        <div className="titlebar">
          <div className="titlebar-controls">
            <button
              className="ctrl-btn close"
              onClick={handleClose}
              title="Закрыть"
            />
            <button
              className="ctrl-btn minimize"
              onClick={handleMinimize}
              title="Свернуть"
            />
            <button
              className="ctrl-btn maximize"
              onClick={handleMaximize}
              title="Развернуть"
            />
          </div>

          <div className="titlebar-drag" data-tauri-drag-region>
            <span className="titlebar-title">Loza</span>
          </div>
        </div>
      )}
      <StrictMode>
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  {/* <MainScreen /> */}
                  <div>Main</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </StrictMode>
    </div>
  );
}