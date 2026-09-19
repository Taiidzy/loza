import { useState } from "react";
import { motion } from "motion/react";
import { checkServerHealth, setServerUrl } from "../../api/auth";
import { CheckIcon } from "../../shared/icons/Icons";
import ParticlesBackground from "../auth/ParticlesBackground";
import styles from "../auth/AuthPage.module.css";

type SetupState = "idle" | "loading" | "success" | "saved" | "error";

/**
 * Первый экран флоу входа: ввод адреса Loza-сервера. Раньше адрес был
 * вкопан в Rust-константу (SERVER_URL = "http://localhost:4242") — теперь
 * вводится один раз здесь и хранится в Rust (server_config.rs). Токен сессии
 * хранится отдельно в системном credential storage. Визуально — та же карточка/фон/анимации, что и
 * AuthPage, чтобы два шага читались как один непрерывный флоу, а не как
 * два разных экрана.
 *
 * onConfigured вызывается после успешного сохранения — App.tsx решает,
 * что показать дальше (AuthPage, так как сессии пока не будет).
 */
export default function ServerSetupPage({ onConfigured }: { onConfigured: () => void }) {

  const [input, setInput] = useState("");
  const [state, setState] = useState<SetupState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [noticeMsg, setNoticeMsg] = useState("");

  const handleSubmit = async () => {
    if (state === "loading") return;

    if (!input.trim()) {
      showError("Введите адрес сервера");
      return;
    }

    setState("loading");
    setErrorMsg("");
    setNoticeMsg("");

    try {
      // set_server_url сам нормализует адрес (добавляет схему, убирает
      // конечный слэш) и валидирует его — если адрес совсем некорректный,
      // вернёт ошибку, не сохраняя ничего.
      const normalized = await setServerUrl(input.trim());

      // Не блокируем переход, если сервер временно недоступен — адрес
      // мог быть введён верно, а NAS/сервер просто ещё не проснулся.
      // Но и не показываем ложный зелёный "Готово": вместо этого честно
      // сообщаем об отсутствии ответа и всё равно идём на экран логина.
      const healthy = await checkServerHealth(normalized);

      if (healthy) {
        setState("success");
        setTimeout(onConfigured, 500);
      } else {
        setState("saved");
        setNoticeMsg("Адрес сохранён, но сервер пока не отвечает. Вы сможете войти, когда он станет доступен.");
        setTimeout(onConfigured, 1300);
      }
    } catch (err: unknown) {
      const raw = typeof err === "string" ? err : "Некорректный адрес сервера";
      showError(raw.includes("INVALID_URL") ? "Некорректный адрес сервера" : raw);
    }
  };

  const showError = (message: string) => {
    setErrorMsg(message);
    setState("error");
    setTimeout(() => setState("idle"), 2500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

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
            <motion.div
              className={styles.brand}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
            >
              <h2 className={styles.brandTitle}>Loza</h2>
              <p className={styles.brandSubtitle}>Подключение к серверу</p>
            </motion.div>

            <div className={styles.fields}>
              <motion.div
                className={styles.field}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.12, duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <div
                  className={[
                    styles.fieldBg,
                    state === "error" ? styles.error : "",
                  ].join(" ")}
                />

                <div className={styles.fieldContent}>
                  <span className={styles.fieldLabel}>адрес сервера</span>

                  <input
                    type="text"
                    value={input}
                    placeholder="192.168.1.10:4242"
                    autoComplete="off"
                    autoFocus
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className={styles.fieldInput}
                  />
                </div>
              </motion.div>
            </div>

            <p
              style={{
                fontSize: 10.5,
                color: "rgba(255,255,255,0.22)",
                marginTop: 8,
                lineHeight: 1.4,
              }}
            >
              HTTP: 192.168.1.10:4242 или loza.мойдом.local · публичный сервер: https://cloud.example.com
            </p>

            {state === "error" && errorMsg && (
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

            {noticeMsg && state !== "error" && (
              <motion.div
                className={styles.errorMessage}
                style={{ color: "rgba(255,255,255,0.55)" }}
                initial={{ opacity: 0, y: -4, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                {noticeMsg}
              </motion.div>
            )}

            <motion.div
              className={styles.submitWrap}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.35 }}
            >
              <motion.button
                onClick={handleSubmit}
                disabled={state === "loading" || state === "saved"}
                whileHover={{ scale: state === "loading" ? 1 : 1.013 }}
                whileTap={{ scale: state === "loading" ? 1 : 0.974 }}
                transition={{ type: "spring", stiffness: 440, damping: 22 }}
                className={[
                  styles.submitButton,
                  state === "success" ? styles.success : "",
                  state === "error" ? styles.error : "",
                ].join(" ")}
              >
                <div className={styles.submitButtonSheen} />
                <span className={styles.submitButtonContent}>
                  {state === "success" ? (
                    <>
                      <CheckIcon />
                      Готово
                    </>
                  ) : state === "loading" ? (
                    <>
                      <motion.div
                        className={styles.submitSpinner}
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
                      />
                      <span className={styles.submitLoadingLabel}>Проверка</span>
                    </>
                  ) : (
                    "Продолжить"
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
