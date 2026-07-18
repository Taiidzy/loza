import dayjs from 'dayjs';
import type { ExpandedCalendarEvent } from './types';
import styles from './CalendarCard.module.css';

interface AgendaPanelProps {
  events: ExpandedCalendarEvent[];
  onSelect?: (event: ExpandedCalendarEvent) => void;
  isLoading?: boolean;
  /** Максимум пунктов списка (по умолчанию 6, чтобы не переполнять узкую колонку). */
  limit?: number;
}

/** Человекочитаемая метка даты: "Сегодня", "Завтра" или "12 июля". */
function formatDayLabel(date: dayjs.Dayjs): string {
  const now = dayjs();
  if (date.isSame(now, 'day')) return 'Сегодня';
  if (date.isSame(now.add(1, 'day'), 'day')) return 'Завтра';
  return date.format('D MMMM');
}

/**
 * Список ближайших событий. Используется в правой колонке экрана календаря
 * (ActivityTab), чтобы не дублировать разметку и логику форматирования дат
 * в самой странице.
 */
export default function AgendaPanel({ events, onSelect, isLoading, limit = 6 }: AgendaPanelProps) {
  const items = events.slice(0, limit);

  if (isLoading) {
    return <div className={styles.agendaEmpty}>Загрузка…</div>;
  }

  if (items.length === 0) {
    return <div className={styles.agendaEmpty}>Нет предстоящих событий</div>;
  }

  return (
    <div className={styles.agendaList}>
      {items.map((evt) => (
        <button
          key={evt.id}
          type="button"
          onClick={() => onSelect?.(evt)}
          className={styles.agendaItem}
        >
          <span className={styles.agendaDot} style={{ backgroundColor: evt.color, boxShadow: `0 0 6px ${evt.color}80` }} />
          <span className={styles.agendaText}>
            <span className={styles.agendaTitle}>{evt.title}</span>
            <span className={styles.agendaDate}>
              {formatDayLabel(dayjs(evt.startDate))}
              {evt.isMultiDay ? ` – ${formatDayLabel(dayjs(evt.endDate))}` : ''}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
