import { useEffect, useState } from "react";

const DEFAULT_BREAKPOINT = 768;

/** Совпадает с User-Agent реальных телефонов/планшетов. */
const MOBILE_UA_PATTERN = /iPhone|iPad|Android/;

function detectMobile(breakpoint: number): boolean {
  if (typeof window === "undefined") return false;

  // UA ловит настоящие iPhone/Android; ширина окна — подстраховка для
  // эмуляции в DevTools и для узких десктоп-окон/split-view на iPad.
  const isMobileUA = MOBILE_UA_PATTERN.test(navigator.userAgent);
  const isNarrowViewport = window.innerWidth <= breakpoint;

  return isMobileUA || isNarrowViewport;
}

/**
 * Определяет, следует ли показывать мобильную версию интерфейса.
 *
 * До рефакторинга эта логика была продублирована в App.tsx (с проверкой
 * User-Agent) и отдельно в AuthPage.tsx/MainPage.tsx (только по ширине окна).
 * Из-за рассинхронизации `<App>` мог считать layout десктопным, пока
 * `<MainPage>` уже переключался на мобильный — теперь источник истины один.
 */
export function useIsMobile(breakpoint: number = DEFAULT_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(() => detectMobile(breakpoint));

  useEffect(() => {
    const update = () => setIsMobile(detectMobile(breakpoint));

    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [breakpoint]);

  return isMobile;
}
