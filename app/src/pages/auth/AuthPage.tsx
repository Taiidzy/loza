import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { authLogin } from "../../api/auth";
import { CheckIcon, EyeIcon } from "../../shared/icons/Icons";
import { logger } from "../../shared/utils/logger";
import ParticlesBackground from "./ParticlesBackground";
import styles from "./AuthPage.module.css";

type LoginState = "idle" | "loading" | "success" | "error";

/** Известные коды ошибок, которые может вернуть Rust-бэкенд, и их локализация. */
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "Неверный логин или пароль",
  SERVER_UNREACHABLE: "Сервер недоступен",
  EMPTY_FIELDS: "Заполните все поля",
  NO_SERVER_URL: "Сначала укажите адрес сервера",
  PARSE_ERROR: "Сервер прислал неожиданный ответ",
};

/**
 * Превращает ошибку invoke() (строка от Rust, либо произвольное значение) в
 * понятный пользователю текст. Для неизвестных кодов (в т.ч. "UNKNOWN: ...")
 * показываем raw-текст как есть, а не что-то generic — он теперь содержит
 * HTTP-статус и код ошибки от сервера (см. auth.rs::login), так что сам по
 * себе уже подсказывает, что не так, вместо бесполезного "Login failed".
 * Полную трассировку смотреть в devtools console (api/auth.ts логирует
 * каждый invoke) и в терминале, где запущено приложение.
 */
function resolveErrorMessage(err: unknown): string {
  const raw = typeof err === "string" ? err : JSON.stringify(err);
  logger.error("auth-page", "login error", err);
  const knownCode = Object.keys(ERROR_MESSAGES).find((code) => raw.includes(code));
  return knownCode ? ERROR_MESSAGES[knownCode] : raw;
}

/** Экран входа: форма логин/пароль поверх анимированного фона с частицами. */
export default function AuthPage() {
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [loginState, setLoginState] = useState<LoginState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

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
      // authLogin сохраняет сессию (включая токен) в Rust-хранилище сам;
      // сюда возвращается только безопасный UserInfo, который здесь не нужен.
      await authLogin(username.trim(), password);

      setLoginState("success");
      // Короткая вспышка "успеха" перед переходом на главный экран
      setTimeout(() => navigate("/"), 800);
    } catch (err: unknown) {
      setErrorMsg(resolveErrorMessage(err));
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
      hasEyeToggle: false,
    },
    {
      id: "password",
      label: "пароль",
      placeholder: "••••••••",
      type: showPassword ? "text" : "password",
      value: password,
      onChange: setPassword,
      hasEyeToggle: true,
    },
  ];

  return (
    <div className={styles.page}>
      <ParticlesBackground />

      <div className={styles.blobTopRight} />
      <div className={styles.blobBottomLeft} />

      <motion.div
        className={styles.cardWrap}
        initial={{ opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className={styles.cardGlow} />

        <div className={`${styles.card}`}>
          <div className={styles.cardShimmer} />

          <div className={styles.cardInner}>
            {/* Брендинг */}
            <motion.div
              className={styles.brand}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
            >
              <h2 className={styles.brandTitle}>Loza</h2>
              <p className={styles.brandSubtitle}>С возвращением</p>
            </motion.div>

            {/* Поля формы */}
            <div className={styles.fields}>
              {fields.map((field, i) => (
                <motion.div
                  key={field.id}
                  className={styles.field}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.12 + i * 0.07, duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                >
                  <div
                    className={[
                      styles.fieldBg,
                      focusedField === field.id ? styles.focused : "",
                      loginState === "error" ? styles.error : "",
                    ].join(" ")}
                  />

                  <div className={styles.fieldContent}>
                    <span className={styles.fieldLabel}>{field.label}</span>

                    <input
                      type={field.type}
                      value={field.value}
                      placeholder={field.placeholder}
                      autoComplete="off"
                      onChange={(e) => field.onChange(e.target.value)}
                      onFocus={() => setFocusedField(field.id)}
                      onBlur={() => setFocusedField(null)}
                      onKeyDown={handleKeyDown}
                      className={`${styles.fieldInput} ${field.hasEyeToggle ? styles.withEyeButton : ""}`}
                    />
                  </div>

                  {field.hasEyeToggle && (
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className={`${styles.eyeButton} ${showPassword ? styles.active : ""}`}
                    >
                      <EyeIcon open={showPassword} />
                    </button>
                  )}
                </motion.div>
              ))}
            </div>

            {/* Сообщение об ошибке */}
            <AnimatePresence>
              {loginState === "error" && errorMsg && (
                <motion.div
                  className={styles.errorMessage}
                  initial={{ opacity: 0, y: -4, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {errorMsg}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Кнопка отправки */}
            <motion.div
              className={styles.submitWrap}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.35 }}
            >
              <motion.button
                onClick={handleSubmit}
                disabled={loginState === "loading"}
                whileHover={{ scale: loginState === "loading" ? 1 : 1.013 }}
                whileTap={{ scale: loginState === "loading" ? 1 : 0.974 }}
                transition={{ type: "spring", stiffness: 440, damping: 22 }}
                className={[
                  styles.submitButton,
                  loginState === "success" ? styles.success : "",
                  loginState === "error" ? styles.error : "",
                ].join(" ")}
              >
                <div className={styles.submitButtonSheen} />
                <span className={styles.submitButtonContent}>
                  {loginState === "success" ? (
                    <>
                      <CheckIcon />
                      Добро пожаловать
                    </>
                  ) : loginState === "loading" ? (
                    <>
                      <motion.div
                        className={styles.submitSpinner}
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
                      />
                      <span className={styles.submitLoadingLabel}>Вход</span>
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
