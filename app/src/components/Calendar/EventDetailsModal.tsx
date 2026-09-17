import dayjs from 'dayjs';
import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { eventTimeLabel } from '../../shared/utils/calendarDateUtils';
import type { ExpandedCalendarEvent, Recurrence } from '../../types/calendar';
import styles from './EventModals.module.css';

interface EventDetailsModalProps {
  /** Событие для просмотра, либо null — модалка закрыта. */
  event: ExpandedCalendarEvent | null;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  /** Ошибка последней операции удаления (показывается над кнопками). */
  error?: string | null;
}

const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: 'Не повторяется',
  daily: 'Повторяется каждый день',
  weekly: 'Повторяется раз в неделю',
  monthly: 'Повторяется раз в месяц',
  yearly: 'Повторяется раз в год',
};

/** Диапазон дат события в виде "12 июля" или "12 – 15 июля". */
function dateRangeLabel(evt: ExpandedCalendarEvent): string {
  const start = dayjs(evt.startDate, 'YYYY-MM-DD');
  if (!evt.isMultiDay) return start.format('D MMMM');
  const end = dayjs(evt.endDate, 'YYYY-MM-DD');
  return `${start.format('D MMMM')} – ${end.format('D MMMM')}`;
}

/**
 * Модальное окно с подробностями события: открывается при клике по событию
 * в панели "События дня" или в списке "Ближайшие события" — вместо простого
 * выбора строки в списке.
 */
export default function EventDetailsModal({ event, onEdit, onDelete, onClose, error }: EventDetailsModalProps) {
  const isOpen = event !== null;
  const panelRef = useRef<HTMLDivElement | null>(null);

  // При открытии переносим фокус в диалог и слушаем Escape на уровне window:
  // onKeyDown на самом motion.div не работает, пока фокус остаётся на фоне
  // (нефокусируемый контейнер не получает клавиатурных событий).
  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={event.title}
            tabIndex={-1}
            className={styles.modal}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>{event.title}</h3>
              <button type="button" onClick={onClose} className={styles.closeButton} aria-label="Закрыть">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className={styles.detailsColorBar} style={{ backgroundColor: event.color, boxShadow: `0 0 10px ${event.color}80` }} />

            <div className={styles.detailRow}>
              <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              <span className={styles.detailValue}>{dateRangeLabel(event)}</span>
            </div>

            <div className={styles.detailRow}>
              <svg className={styles.detailIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 3" />
              </svg>
              <span className={styles.detailValue}>{eventTimeLabel(event)}</span>
            </div>

            {event.recurrence !== 'none' && (
              <div className={styles.detailRow}>
                <span className={styles.recurrenceBadge}>{RECURRENCE_LABELS[event.recurrence]}</span>
              </div>
            )}

            {error && <div className={styles.formError}>{error}</div>}

            <div className={styles.actions}>
              <button type="button" onClick={onDelete} className={styles.dangerButton}>
                Удалить
              </button>
              <button type="button" onClick={onEdit} className={styles.primaryButton}>
                Редактировать
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
