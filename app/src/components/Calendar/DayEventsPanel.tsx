import { useState, useEffect } from 'react';
import type { Dayjs } from 'dayjs';
import { AnimatePresence, motion } from 'motion/react';
import EventFormModal from './EventFormModal';
import EventDetailsModal from './EventDetailsModal';
import { eventTimeLabel } from '../../shared/utils/calendarDateUtils';
import type { CalendarEvent, CalendarEventDraft, ExpandedCalendarEvent } from '../../types/calendar';
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

type ModalState =
  | { kind: 'none' }
  | { kind: 'details'; event: ExpandedCalendarEvent }
  | { kind: 'create' }
  | { kind: 'edit'; event: ExpandedCalendarEvent };

/**
 * Панель управления событиями выбранного дня. Список событий дня; клик по
 * событию открывает модальное окно с подробностями (а не просто выделяет
 * строку), создание и редактирование происходят в отдельном модальном окне
 * поверх экрана — не инлайн внутри панели.
 */
export default function DayEventsPanel({ selectedDate, dayEvents, events, onCreate, onUpdate, onDelete }: DayEventsPanelProps) {
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });

  // При смене выбранного дня закрываем любые открытые модалки.
  useEffect(() => {
    setModal({ kind: 'none' });
  }, [selectedDate?.format('YYYY-MM-DD')]);

  const originalFor = (evt: ExpandedCalendarEvent): CalendarEvent | null =>
    events.find((e) => e.id === evt.sourceId) ?? null;

  const handleSave = async (draft: CalendarEventDraft) => {
    if (modal.kind === 'edit') {
      const original = originalFor(modal.event);
      if (original) await onUpdate({ ...draft, id: original.id });
    } else {
      await onCreate(draft);
    }
    setModal({ kind: 'none' });
  };

  const handleDelete = async (evt: ExpandedCalendarEvent) => {
    const original = originalFor(evt);
    if (!original) return;
    await onDelete(original.id);
    setModal({ kind: 'none' });
  };

  if (!selectedDate) {
    return (
      <div className={styles.dayPanelEmpty}>
        Выберите день в календаре
      </div>
    );
  }

  const editingEvent = modal.kind === 'edit' ? originalFor(modal.event) : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      {dayEvents.length === 0 ? (
        <div className={styles.dayPanelCenter}>
          <button type="button" onClick={() => setModal({ kind: 'create' })} className={styles.createBigButton}>
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
                  onClick={() => setModal({ kind: 'details', event: evt })}
                  className={styles.dayEventRow}
                >
                  <span className={styles.agendaDot} style={{ backgroundColor: evt.color, boxShadow: `0 0 6px ${evt.color}80` }} />
                  <span className={styles.agendaText}>
                    <span className={styles.agendaTitle}>{evt.title}</span>
                    <span className={styles.agendaDate}>
                      {eventTimeLabel(evt)}
                      {evt.recurrence !== 'none' ? ' · повторяется' : ''}
                    </span>
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>

          <div className={styles.dayPanelActions}>
            <button type="button" onClick={() => setModal({ kind: 'create' })} className={styles.dayActionButton}>
              Добавить
            </button>
          </div>
        </>
      )}

      <EventFormModal
        isOpen={modal.kind === 'create' || modal.kind === 'edit'}
        selectedDate={selectedDate}
        existingEvent={editingEvent}
        onSave={handleSave}
        onClose={() => setModal({ kind: 'none' })}
      />

      <EventDetailsModal
        event={modal.kind === 'details' ? modal.event : null}
        onEdit={() => modal.kind === 'details' && setModal({ kind: 'edit', event: modal.event })}
        onDelete={() => modal.kind === 'details' && handleDelete(modal.event)}
        onClose={() => setModal({ kind: 'none' })}
      />
    </div>
  );
}
