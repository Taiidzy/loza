import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import styles from './EventModals.module.css';

export interface CustomSelectOption<T extends string> {
  value: T;
  label: string;
}

interface CustomSelectProps<T extends string> {
  value: T;
  options: CustomSelectOption<T>[];
  onChange: (value: T) => void;
}

/**
 * Стилизованная замена нативному <select>. Нативный select в Tauri/Webview
 * рендерит выпадающий список системными стилями ОС (белый фон, нечитаемый
 * текст на тёмной теме) — CSS не может их переопределить, поэтому вместо
 * него используется кнопка + кастомный popover со списком опций.
 *
 * Popover рендерится через портал прямо в document.body (а не как дочерний
 * элемент кнопки) и позиционируется абсолютными координатами экрана,
 * посчитанными от кнопки-триггера. Это важно, когда CustomSelect используется
 * внутри модалки со своим overflow-y: auto (EventFormModal) — будучи потомком
 * скроллящегося контейнера, position:absolute popover раздувал бы его
 * scrollHeight и прокручивалось бы всё окно, а не список опций.
 */
export default function CustomSelect<T extends string>({ value, options, onChange }: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);

  const openPopover = () => {
    const el = triggerRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setRect({ top: r.bottom + 6, left: r.left, width: r.width });
    }
    setIsOpen(true);
  };

  // Если окно ресайзится/скроллится где-то ещё, пока popover открыт — просто
  // закрываем его, а не пытаемся отслеживать позицию кнопки в реальном времени.
  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [isOpen]);

  return (
    <div className={styles.selectAnchor}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : openPopover())}
        className={styles.selectTrigger}
      >
        <span>{current?.label ?? value}</span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`${styles.selectChevron} ${isOpen ? styles.selectChevronOpen : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {createPortal(
        <AnimatePresence>
          {isOpen && rect && (
            <>
              <div className={styles.selectOverlay} onMouseDown={() => setIsOpen(false)} />
              <motion.div
                className={styles.selectPopoverFixed}
                style={{ top: rect.top, left: rect.left, width: rect.width }}
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -2, scale: 0.99 }}
                transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
              >
                {options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { onChange(opt.value); setIsOpen(false); }}
                    className={`${styles.selectOption} ${opt.value === value ? styles.selectOptionActive : ''}`}
                  >
                    {opt.label}
                    {opt.value === value && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
