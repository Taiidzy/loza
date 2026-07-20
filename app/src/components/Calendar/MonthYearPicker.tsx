import { useEffect, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { AnimatePresence, motion } from 'motion/react';
import styles from './CalendarCard.module.css';

interface MonthYearPickerProps {
  isOpen: boolean;
  currentDate: Dayjs;
  onSelect: (date: Dayjs) => void;
  onClose: () => void;
}

const MONTH_LABELS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

/**
 * Быстрый переход к произвольному месяцу/году — открывается по клику на
 * заголовок месяца в CalendarCard. Решает неудобство пролистывания стрелками
 * далёких месяцев (например, из июля в декабрь или в другой год): сетка из
 * 12 месяцев текущего выбранного года плюс стрелки переключения года.
 */
export default function MonthYearPicker({ isOpen, currentDate, onSelect, onClose }: MonthYearPickerProps) {
  const [viewYear, setViewYear] = useState(currentDate.year());

  // При каждом открытии показываем год текущего выбранного месяца, а не тот,
  // на котором остановились в прошлый раз.
  useEffect(() => {
    if (isOpen) setViewYear(currentDate.year());
  }, [isOpen, currentDate]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Невидимый оверлей для закрытия по клику вне picker'а */}
          <div className={styles.pickerOverlay} onMouseDown={onClose} />

          <motion.div
            className={styles.pickerPopover}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className={styles.pickerYearRow}>
              <button
                type="button"
                onClick={() => setViewYear((y) => y - 1)}
                className={styles.pickerYearButton}
                aria-label="Предыдущий год"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <span className={styles.pickerYearLabel}>{viewYear}</span>
              <button
                type="button"
                onClick={() => setViewYear((y) => y + 1)}
                className={styles.pickerYearButton}
                aria-label="Следующий год"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
              </button>
            </div>

            <div className={styles.pickerMonthGrid}>
              {MONTH_LABELS.map((label, idx) => {
                const isActive = viewYear === currentDate.year() && idx === currentDate.month();
                const isCurrentRealMonth = viewYear === dayjs().year() && idx === dayjs().month();
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      onSelect(dayjs().year(viewYear).month(idx).date(1));
                      onClose();
                    }}
                    className={`${styles.pickerMonthButton} ${isActive ? styles.pickerMonthButtonActive : ''}`}
                  >
                    {label}
                    {isCurrentRealMonth && !isActive && <span className={styles.pickerMonthDot} />}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                onSelect(dayjs());
                onClose();
              }}
              className={styles.pickerTodayButton}
            >
              Сегодня
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
