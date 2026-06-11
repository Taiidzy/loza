import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router-dom";
import { authLogin, saveSession } from "../api/auth";

// ─── Icons ────────────────────────────────────────────────────────────────────

const EyeIcon = ({ open }: { open: boolean }) => (
  <svg
    width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round"
  >
    {open ? (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ) : (
      <>
        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </>
    )}
  </svg>
);

// ─── Particle canvas ──────────────────────────────────────────────────────────

function Particles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const dots = Array.from({ length: 55 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.6 + 0.4,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      o: Math.random() * 0.4 + 0.1,
    }));

    let raf: number;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const d of dots) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0) d.x = canvas.width;
        if (d.x > canvas.width) d.x = 0;
        if (d.y < 0) d.y = canvas.height;
        if (d.y > canvas.height) d.y = 0;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 182, 210, ${d.o})`;
        ctx.fill();
      }
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x;
          const dy = dots[i].y - dots[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 90) {
            ctx.beginPath();
            ctx.moveTo(dots[i].x, dots[i].y);
            ctx.lineTo(dots[j].x, dots[j].y);
            ctx.strokeStyle = `rgba(200, 160, 255, ${0.12 * (1 - dist / 90)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}

// ─── AuthPage ─────────────────────────────────────────────────────────────────

type LoginState = "idle" | "loading" | "success" | "error";

export default function AuthPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [loginState, setLoginState] = useState<LoginState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const accent      = "rgba(255, 182, 210, 1)";
  const accentDim   = "rgba(255, 182, 210, 0.45)";
  const accentBorder = "rgba(255, 182, 210, 0.5)";
  const accentGlow  = "rgba(255, 182, 210, 0.12)";

  const handleSubmit = async () => {
    if (loginState === "loading") return;
    if (!username.trim() || !password) {
      setErrorMsg("Заполните все поля");
      setLoginState("error");
      setTimeout(() => setLoginState("idle"), 2000);
      return;
    }

    setLoginState("loading");
    setErrorMsg("");

    try {
      const resp = await authLogin(username.trim(), password);

      saveSession({
        token: resp.token,
        username: resp.username,
        display_name: resp.display_name,
        role: resp.role,
        expires_at: resp.expires_at,
      });

      setLoginState("success");
      // Brief success flash, then navigate
      setTimeout(() => navigate("/"), 800);
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : "Ошибка сервера";

      // Parse Rust error codes for friendly messages
      if (msg.includes("INVALID_CREDENTIALS")) {
        setErrorMsg("Неверный логин или пароль");
      } else if (msg.includes("SERVER_UNREACHABLE")) {
        setErrorMsg("Сервер недоступен");
      } else if (msg.includes("EMPTY_FIELDS")) {
        setErrorMsg("Заполните все поля");
      } else {
        setErrorMsg(msg);
      }

      setLoginState("error");
      setTimeout(() => setLoginState("idle"), 3000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  const fields = [
    {
      id: "login",
      label: "логин",
      placeholder: "Loza",
      type: "text",
      value: username,
      onChange: setUsername,
      eye: false,
    },
    {
      id: "password",
      label: "пароль",
      placeholder: "••••••••",
      type: showPass ? "text" : "password",
      value: password,
      onChange: setPassword,
      eye: true,
    },
  ];

  return (
    <div
      style={{
        width: "100%", height: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative", overflow: "hidden", background: "transparent",
      }}
    >
      <Particles />

      {/* Decorative blobs */}
      <div style={{
        position: "absolute", width: 420, height: 420, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(180,100,255,0.18) 0%, transparent 70%)",
        top: "-80px", right: "-60px", pointerEvents: "none", filter: "blur(40px)",
      }} />
      <div style={{
        position: "absolute", width: 320, height: 320, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,120,180,0.14) 0%, transparent 70%)",
        bottom: "-60px", left: "-40px", pointerEvents: "none", filter: "blur(40px)",
      }} />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        style={{ width: "100%", maxWidth: 368, padding: "0 20px", position: "relative", zIndex: 10 }}
      >
        {/* Outer glow */}
        <div style={{
          position: "absolute", inset: -1, borderRadius: 28, pointerEvents: "none",
          background: "linear-gradient(135deg, rgba(255,182,210,0.2) 0%, rgba(180,120,255,0.12) 50%, rgba(100,180,255,0.08) 100%)",
          filter: "blur(1px)",
        }} />

        {/* Glass card */}
        <div style={{
          position: "relative", borderRadius: 26, overflow: "hidden",
          background: "rgba(255,255,255,0.055)",
          backdropFilter: "blur(48px) saturate(180%)",
          WebkitBackdropFilter: "blur(48px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.13)",
          boxShadow: "0 12px 48px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(255,255,255,0.04)",
          padding: "32px 32px 28px",
        }}>
          {/* Top shimmer */}
          <div style={{
            position: "absolute", top: 0, left: 32, right: 32, height: 1,
            pointerEvents: "none",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)",
          }} />

          <div style={{ position: "relative" }}>
            {/* Brand */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              style={{ marginBottom: 28 }}
            >
              <h2 style={{
                fontSize: 22, fontWeight: 300, margin: "0",
                color: "rgba(255,255,255,0.92)", letterSpacing: "-0.015em",
              }}>
                Loza
              </h2>
              <p style={{
                fontSize: 12, marginTop: 3,
                color: "rgba(255,255,255,0.32)", letterSpacing: "0.04em",
              }}>
                С возвращением
              </p>
            </motion.div>

            {/* Fields */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {fields.map((f, i) => (
                <motion.div
                  key={f.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.12 + i * 0.07, duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                  style={{ position: "relative" }}
                >
                  {/* Field bg */}
                  <div style={{
                    position: "absolute", inset: 0, borderRadius: 13, pointerEvents: "none",
                    background: "rgba(255,255,255,0.04)",
                    border: focused === f.id
                      ? `1px solid ${accentBorder}`
                      : loginState === "error"
                        ? "1px solid rgba(255, 100, 100, 0.4)"
                        : "1px solid rgba(255,255,255,0.09)",
                    boxShadow: focused === f.id
                      ? `0 0 0 3px ${accentGlow}, inset 0 1px 0 rgba(255,255,255,0.1)`
                      : "inset 0 1px 0 rgba(255,255,255,0.04)",
                    transition: "border-color 0.2s, box-shadow 0.2s",
                  }} />

                  <div style={{
                    position: "relative", display: "flex", flexDirection: "column",
                    padding: "9px 14px 8px",
                  }}>
                    <span style={{
                      fontSize: 9, letterSpacing: "0.1em",
                      color: "rgba(255,255,255,0.16)",
                      textTransform: "uppercase", marginBottom: 2,
                    }}>
                      {f.label}
                    </span>

                    <input
                      type={f.type}
                      value={f.value}
                      placeholder={f.placeholder}
                      autoComplete="off"
                      onChange={(e) => f.onChange(e.target.value)}
                      onFocus={() => setFocused(f.id)}
                      onBlur={() => setFocused(null)}
                      onKeyDown={handleKeyDown}
                      style={{
                        background: "transparent", border: "none", outline: "none",
                        fontSize: 13, color: "rgba(255,255,255,0.88)",
                        caretColor: accent, width: "100%",
                        paddingRight: f.eye ? 28 : 0,
                      }}
                      className="placeholder:text-white/20"
                    />
                  </div>

                  {f.eye && (
                    <button
                      onClick={() => setShowPass((v) => !v)}
                      style={{
                        position: "absolute", right: 12, top: "50%",
                        transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer",
                        padding: 2,
                        color: showPass ? accentDim : "rgba(255,255,255,0.22)",
                        transition: "color 0.18s",
                        display: "flex", alignItems: "center",
                      }}
                    >
                      <EyeIcon open={showPass} />
                    </button>
                  )}
                </motion.div>
              ))}
            </div>

            {/* Error message */}
            <AnimatePresence>
              {loginState === "error" && errorMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -4, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    marginTop: 10,
                    fontSize: 11,
                    color: "rgba(255, 120, 120, 0.85)",
                    textAlign: "center",
                    letterSpacing: "0.02em",
                  }}
                >
                  {errorMsg}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.35 }}
              style={{ marginTop: 16 }}
            >
              <motion.button
                onClick={handleSubmit}
                disabled={loginState === "loading"}
                whileHover={{ scale: loginState === "loading" ? 1 : 1.013 }}
                whileTap={{ scale: loginState === "loading" ? 1 : 0.974 }}
                transition={{ type: "spring", stiffness: 440, damping: 22 }}
                style={{
                  width: "100%", padding: "11px 0",
                  borderRadius: 14, fontSize: 13, fontWeight: 500,
                  letterSpacing: "0.06em",
                  cursor: loginState === "loading" ? "default" : "pointer",
                  position: "relative", overflow: "hidden",
                  background: loginState === "success"
                    ? "rgba(62, 207, 110, 0.2)"
                    : loginState === "error"
                      ? "rgba(255, 80, 80, 0.12)"
                      : "rgba(255,255,255,0.09)",
                  border: loginState === "success"
                    ? "1px solid rgba(62,207,110,0.4)"
                    : loginState === "error"
                      ? "1px solid rgba(255, 80, 80, 0.3)"
                      : "1px solid rgba(255,255,255,0.18)",
                  color: loginState === "success"
                    ? "rgba(62,207,110,0.9)"
                    : loginState === "error"
                      ? "rgba(255,120,120,0.85)"
                      : "rgba(255,255,255,0.88)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 20px rgba(0,0,0,0.2)",
                  transition: "background 0.3s, border-color 0.3s, color 0.3s",
                }}
              >
                <div style={{
                  position: "absolute", inset: 0, pointerEvents: "none",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 100%)",
                }} />
                <span style={{
                  position: "relative", zIndex: 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}>
                  {loginState === "success" ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Добро пожаловать
                    </>
                  ) : loginState === "loading" ? (
                    <>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
                        style={{
                          width: 13, height: 13, borderRadius: "50%",
                          border: "1.5px solid rgba(255,255,255,0.18)",
                          borderTopColor: "rgba(255,255,255,0.78)",
                        }}
                      />
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>Вход</span>
                    </>
                  ) : (
                    "Войти"
                  )}
                </span>
              </motion.button>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}