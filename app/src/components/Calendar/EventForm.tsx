import { useState } from 'react';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { motion } from 'motion/react';
import { EVENT_COLORS } from './calendarService';
import type { CalendarEvent, CalendarEventDraft, Recurrence } from './types';
import styles from './CalendarCard.module.css';

interface EventFormProps {
  selectedDate: Dayjs;
  existingEvent: CalendarEvent | null;
  onSave: (draft: CalendarEventDraft) => void;
  onCancel: () => void;
}

/**
 * Форма создания/редактирования события. Раньше рендерилась как модальное
 * окно поверх календаря; теперь — инлайн-содержимое панели "События дня"
 * (см. DayEventsPanel), без затемнения и оверлея.
 */
export default function EventForm({ selectedDate, existingEvent, onSave, onCancel }: EventFormProps) {
  const [title, setTitle] = useState(existingEvent?.title || '');
  const [startDate, setStartDate] = useState(existingEvent?.startDate || selectedDate.toISOString());
  const [endDate, setEndDate] = useState(existingEvent?.endDate || selectedDate.toISOString());
  const [isMultiDay, setIsMultiDay] = useState(existingEvent?.isMultiDay || false);
  const [recurrence, setRecurrence] = useState<Recurrence>(existingEvent?.recurrence || 'none');
  const [color, setColor] = useState(existingEvent?.color || EVENT_COLORS[0]);

  const canSave = title.trim().length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={styles.formWrap}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
    >
      <input
        type="text" placeholder="Название" value={title} onChange={e => setTitle(e.target.value)}
        autoFocus
        className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-sm)] px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[var(--color-accent)] transition-colors"
      />

      <div className="flex items-center gap-3">
        <label className="text-[12px] text-[var(--color-text-secondary)] flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={isMultiDay} onChange={e => setIsMultiDay(e.target.checked)} className="accent-[var(--color-accent)]" />
          Многодневное
        </label>
      </div>

      <div className="flex gap-2">
        <input
          type="date" value={dayjs(startDate).format('YYYY-MM-DD')}
          onChange={e => setStartDate(dayjs(e.target.value).toISOString())}
          className="flex-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[12px] text-[var(--color-text-secondary)]"
        />
        {isMultiDay && (
          <input
            type="date" value={dayjs(endDate).format('YYYY-MM-DD')}
            onChange={e => setEndDate(dayjs(e.target.value).toISOString())}
            className="flex-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[12px] text-[var(--color-text-secondary)]"
          />
        )}
      </div>

      <select
        value={recurrence} onChange={e => setRecurrence(e.target.value as Recurrence)}
        className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-sm)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)] focus:outline-none"
      >
        <option value="none">Один раз</option>
        <option value="daily">Каждый день</option>
        <option value="weekly">Раз в неделю</option>
        <option value="monthly">Раз в месяц</option>
        <option value="yearly">Раз в год</option>
      </select>

      <div className="flex gap-2 justify-center py-1">
        {EVENT_COLORS.map(c => (
          <button
            key={c} type="button" onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
            style={{ backgroundColor: c, boxShadow: color === c ? `0 0 8px ${c}80` : 'none' }}
          />
        ))}
      </div>

      <div className="flex gap-2 justify-end mt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] text-[12px] hover:bg-[var(--color-surface-hover)] transition-colors">
          Отмена
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onSave({ title: title.trim(), startDate, endDate: isMultiDay ? endDate : startDate, color, recurrence, isMultiDay })}
          className="px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent-border)] text-[12px] hover:bg-[var(--color-accent)] hover:text-black transition-colors font-medium disabled:opacity-40 disabled:pointer-events-none"
        >
          Сохранить
        </button>
      </div>
    </motion.div>
  );
}
