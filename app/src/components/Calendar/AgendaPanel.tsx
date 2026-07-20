import dayjs from 'dayjs';
import { eventTimeLabel } from '../../shared/utils/calendarDateUtils';
import type { ExpandedCalendarEvent } from '../../types/calendar';
import styles from './CalendarCard.module.css';

interface AgendaPanelProps {
  events: ExpandedCalendarEvent[];
  /** Клик по событию — открывает модалку с подробностями (см. ActivityTab). */
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
 * (ActivityTab). Клик по событию открывает модальное окно с подробностями
 * (владелец состояния модалки — ActivityTab, этот компонент только сообщает
 * о клике через onSelect).
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
              {formatDayLabel(dayjs(evt.startDate, 'YYYY-MM-DD'))}
              {evt.isMultiDay ? ` – ${formatDayLabel(dayjs(evt.endDate, 'YYYY-MM-DD'))}` : ''}
              {' · '}{eventTimeLabel(evt)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
