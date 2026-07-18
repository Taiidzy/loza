import { useState, useEffect } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { AnimatePresence, motion } from 'motion/react';
import EventForm from './EventForm';
import type { CalendarEvent, CalendarEventDraft, ExpandedCalendarEvent } from './types';
import styles from './CalendarCard.module.css';

interface DayEventsPanelProps {
  selectedDate: Dayjs | null;
  /** События выбранного дня (уже развёрнутые, single+multi day вместе). */
  dayEvents: ExpandedCalendarEvent[];
  events: CalendarEvent[];
  onCreate: (draft: CalendarEventDraft) => Promise<unknown>;
  onUpdate: (event: CalendarEvent) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

type Mode = 'list' | 'create' | 'edit';

/**
 * Панель управления событиями выбранного дня. Заменяет прежнюю модалку
 * CRUD и пустую карточку "Статистика / Информация": теперь это
 * "События дня" — список событий выбранной даты с формой создания/
 * редактирования, встроенной прямо в карточку, без затемнения экрана.
 */
export default function DayEventsPanel({ selectedDate, dayEvents, events, onCreate, onUpdate, onDelete }: DayEventsPanelProps) {
  const [mode, setMode] = useState<Mode>('list');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // При смене выбранного дня сбрасываем режим редактирования и выбор события.
  useEffect(() => {
    setMode('list');
    setSelectedEventId(null);
  }, [selectedDate?.format('YYYY-MM-DD')]);

  const selectedEvent = dayEvents.find((e) => e.id === selectedEventId) ?? null;
  const originalForEdit = selectedEvent
    ? events.find((e) => e.id === selectedEvent.sourceId) ?? null
    : null;

  const handleSave = async (draft: CalendarEventDraft) => {
    if (mode === 'edit' && originalForEdit) {
      await onUpdate({ ...draft, id: originalForEdit.id });
    } else {
      await onCreate(draft);
    }
    setMode('list');
    setSelectedEventId(null);
  };

  const handleDelete = async () => {
    if (!originalForEdit) return;
    await onDelete(originalForEdit.id);
    setMode('list');
    setSelectedEventId(null);
  };

  if (!selectedDate) {
    return (
      <div className={styles.dayPanelEmpty}>
        Выберите день в календаре
      </div>
    );
  }

  if (mode === 'create' || mode === 'edit') {
    return (
      <div className={styles.dayPanelScroll}>
        <EventForm
          selectedDate={selectedDate}
          existingEvent={mode === 'edit' ? originalForEdit : null}
          onSave={handleSave}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {dayEvents.length === 0 ? (
        <div className={styles.dayPanelCenter}>
          <button type="button" onClick={() => setMode('create')} className={styles.createBigButton}>
            + Создать событие
          </button>
        </div>
      ) : (
        <>
          <div className={styles.dayPanelScroll}>
            <AnimatePresence initial={false}>
              {dayEvents.map((evt) => (
                <motion.button
                  key={evt.id}
                  type="button"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  onClick={() => setSelectedEventId(evt.id === selectedEventId ? null : evt.id)}
                  className={`${styles.dayEventRow} ${selectedEventId === evt.id ? styles.dayEventRowSelected : ''}`}
                >
                  <span className={styles.agendaDot} style={{ backgroundColor: evt.color, boxShadow: `0 0 6px ${evt.color}80` }} />
                  <span className={styles.agendaText}>
                    <span className={styles.agendaTitle}>{evt.title}</span>
                    <span className={styles.agendaDate}>
                      {evt.isMultiDay ? `${dayjs(evt.startDate).format('D MMM')} – ${dayjs(evt.endDate).format('D MMM')}` : dayjs(evt.startDate).format('D MMMM')}
                      {evt.recurrence !== 'none' ? ' · повторяется' : ''}
                    </span>
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>

          <div className={styles.dayPanelActions}>
            <button type="button" onClick={() => setMode('create')} className={styles.dayActionButton}>
              Добавить
            </button>
            <button
              type="button"
              disabled={!selectedEvent}
              onClick={() => setMode('edit')}
              className={styles.dayActionButton}
            >
              Редактировать
            </button>
            <button
              type="button"
              disabled={!selectedEvent}
              onClick={handleDelete}
              className={styles.dayActionButtonDanger}
            >
              Удалить
            </button>
          </div>
        </>
      )}
    </div>
  );
}
