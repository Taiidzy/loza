import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface Field {
  id: string;
  label: string;
  placeholder: string;
  type: string;
  eye?: boolean;
}

const EyeIcon = ({ open }: { open: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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

const inputVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.06, duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] as number[] },
  }),
};

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fields, setFields] = useState({ email: "", username: "", password: "", confirm: "" });
  const [showPass, setShowPass] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loginFields: Field[] = [
    { id: "email",    label: "メールアドレス", placeholder: "email address", type: "email" },
    { id: "password", label: "パスワード",      placeholder: "password",      type: showPass ? "text" : "password", eye: true },
  ];

  const signupFields: Field[] = [
    { id: "email",    label: "メールアドレス", placeholder: "email address",    type: "email" },
    { id: "username", label: "ユーザー名",      placeholder: "username",          type: "text" },
    { id: "password", label: "パスワード",      placeholder: "password",          type: showPass ? "text" : "password", eye: true },
    { id: "confirm",  label: "確認",            placeholder: "confirm password",  type: "password" },
  ];

  const currentFields = mode === "login" ? loginFields : signupFields;

  const handleSubmit = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 1800);
  };

  return (
    <div className="w-full h-full flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm relative"
      >
        {/* Outer glow */}
        <div
          className="absolute -inset-px rounded-[28px] pointer-events-none"
          style={{
            background: "linear-gradient(135deg, rgba(255,182,193,0.15) 0%, rgba(180,160,255,0.1) 50%, rgba(135,206,250,0.08) 100%)",
            filter: "blur(1px)",
          }}
        />

        {/* Glass card */}
        <div
          className="relative rounded-[26px] overflow-hidden"
          style={{
            background: "rgba(255, 255, 255, 0.06)",
            backdropFilter: "blur(40px) saturate(160%)",
            WebkitBackdropFilter: "blur(40px) saturate(160%)",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(255,255,255,0.04)",
          }}
        >
          {/* Top shimmer */}
          <div
            className="absolute top-0 left-10 right-10 h-px pointer-events-none"
            style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)" }}
          />
          {/* Inner tint */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: "linear-gradient(155deg, rgba(255,255,255,0.05) 0%, transparent 45%, rgba(180,160,255,0.03) 100%)" }}
          />

          <div className="relative px-8 pt-9 pb-8">

            {/* Brand */}
            <motion.div
              className="mb-7"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.38, delay: 0.08 }}
            >
              <div className="flex items-center gap-2.5 mb-1">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    background: "rgba(255,255,255,0.1)",
                    border: "1px solid rgba(255,255,255,0.18)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path d="M12 3C10.5 7 7 9 3 9c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12-4 0-7.5-2-9-6z"
                      fill="rgba(255,210,220,0.88)" />
                  </svg>
                </div>
                <span className="text-[15px] font-medium tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.85)", fontFamily: "Georgia, serif" }}>
                  Loza
                </span>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={mode}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.2 }}
                >
                  <h2 className="text-[21px] font-light mt-3 leading-snug" style={{ color: "rgba(255,255,255,0.9)", letterSpacing: "-0.01em" }}>
                    {mode === "login" ? "おかえりなさい" : "はじめまして"}
                  </h2>
                  <p className="text-[12px] mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                    {mode === "login" ? "Welcome back" : "Nice to meet you"}
                  </p>
                </motion.div>
              </AnimatePresence>
            </motion.div>

            {/* Segment */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="flex gap-1 rounded-xl p-1 mb-6"
              style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {(["login", "signup"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="relative flex-1 py-[7px] text-[12px] font-medium rounded-[10px] transition-colors duration-150 cursor-pointer"
                  style={{ color: mode === m ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.28)" }}
                >
                  {mode === m && (
                    <motion.div
                      layoutId="seg"
                      className="absolute inset-0 rounded-[10px]"
                      style={{
                        background: "rgba(255,255,255,0.1)",
                        border: "1px solid rgba(255,255,255,0.14)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16)",
                      }}
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span className="relative z-10">{m === "login" ? "ログイン" : "登録"}</span>
                </button>
              ))}
            </motion.div>

            {/* Fields */}
            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                className="space-y-2.5"
              >
                {currentFields.map((f, i) => (
                  <motion.div key={f.id} custom={i} variants={inputVariants} className="relative">
                    <div
                      className="absolute inset-0 rounded-xl pointer-events-none"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: focused === f.id ? "1px solid rgba(255,192,210,0.5)" : "1px solid rgba(255,255,255,0.09)",
                        boxShadow: focused === f.id
                          ? "0 0 0 3px rgba(255,182,193,0.08), inset 0 1px 0 rgba(255,255,255,0.1)"
                          : "inset 0 1px 0 rgba(255,255,255,0.05)",
                        transition: "border-color 0.2s, box-shadow 0.2s",
                      }}
                    />
                    <div className="relative flex flex-col px-3.5 pt-2.5 pb-2">
                      <label
                        className="text-[9px] tracking-[0.14em] mb-0.5 font-mono"
                        style={{
                          color: focused === f.id ? "rgba(255,192,210,0.75)" : "rgba(255,255,255,0.28)",
                          transition: "color 0.2s",
                        }}
                      >
                        {f.label}
                      </label>
                      <input
                        type={f.type}
                        value={fields[f.id as keyof typeof fields]}
                        placeholder={f.placeholder}
                        onChange={e => setFields(p => ({ ...p, [f.id]: e.target.value }))}
                        onFocus={() => setFocused(f.id)}
                        onBlur={() => setFocused(null)}
                        className="bg-transparent outline-none text-[13px] w-full placeholder:opacity-25"
                        style={{ color: "rgba(255,255,255,0.88)", caretColor: "rgba(255,182,193,0.9)" }}
                      />
                    </div>
                    {f.eye && (
                      <button
                        onClick={() => setShowPass(v => !v)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer transition-colors duration-150"
                        style={{ color: showPass ? "rgba(255,182,193,0.65)" : "rgba(255,255,255,0.22)" }}
                      >
                        <EyeIcon open={showPass} />
                      </button>
                    )}
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>

            {/* Forgot */}
            {mode === "login" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.32 }}
                className="text-right mt-2"
              >
                <button
                  className="text-[11px] transition-colors duration-150 cursor-pointer"
                  style={{ color: "rgba(255,182,193,0.45)" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,182,193,0.8)")}
                  onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,182,193,0.45)")}
                >
                  パスワードを忘れた？
                </button>
              </motion.div>
            )}

            {/* Submit */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.32 }}
              className="mt-5"
            >
              <motion.button
                onClick={handleSubmit}
                disabled={loading}
                whileHover={{ scale: 1.012 }}
                whileTap={{ scale: 0.975 }}
                transition={{ type: "spring", stiffness: 420, damping: 22 }}
                className="w-full py-[11px] rounded-xl text-[13px] font-medium relative overflow-hidden cursor-pointer"
                style={{
                  background: "rgba(255,255,255,0.09)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  color: "rgba(255,255,255,0.88)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 16px rgba(0,0,0,0.18)",
                  letterSpacing: "0.05em",
                }}
              >
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 100%)" }}
                />
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {loading ? (
                    <>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 0.85, ease: "linear" }}
                        className="w-[14px] h-[14px] rounded-full"
                        style={{ border: "1.5px solid rgba(255,255,255,0.18)", borderTopColor: "rgba(255,255,255,0.75)" }}
                      />
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>処理中...</span>
                    </>
                  ) : (
                    mode === "login" ? "ログイン" : "アカウント作成"
                  )}
                </span>
              </motion.button>
            </motion.div>

            {/* Divider */}
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
              <span className="text-[10px] tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.18)" }}>OR</span>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
            </div>

            {/* Google */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.985 }}
              className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl text-[12px] cursor-pointer transition-colors duration-150"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.09)",
                color: "rgba(255,255,255,0.55)",
              }}
              onHoverStart={e => ((e.target as HTMLElement).style.background = "rgba(255,255,255,0.07)")}
              onHoverEnd={e => ((e.target as HTMLElement).style.background = "rgba(255,255,255,0.04)")}
            >
              <svg width="15" height="15" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google でログイン
            </motion.button>

            {/* Footer */}
            <p className="text-center text-[11px] mt-5" style={{ color: "rgba(255,255,255,0.2)" }}>
              {mode === "login" ? "アカウントをお持ちでない方 " : "すでにアカウントをお持ちの方 "}
              <button
                onClick={() => setMode(mode === "login" ? "signup" : "login")}
                className="cursor-pointer transition-colors duration-150"
                style={{ color: "rgba(255,182,193,0.55)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,182,193,0.88)")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,182,193,0.55)")}
              >
                {mode === "login" ? "登録する" : "ログイン"}
              </button>
            </p>

          </div>
        </div>
      </motion.div>
    </div>
  );
}