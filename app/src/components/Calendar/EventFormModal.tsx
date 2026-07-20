import { useEffect, useState } from 'react';
import type { Dayjs } from 'dayjs';
import { AnimatePresence, motion } from 'motion/react';
import { EVENT_COLORS } from '../../api/calendarService';
import CustomSelect from './CustomSelect';
import type { CalendarEvent, CalendarEventDraft, Recurrence } from '../../types/calendar';
import styles from './EventModals.module.css';

interface EventFormModalProps {
  /** Открыта ли модалка. Компонент сам не рендерит ничего, если false. */
  isOpen: boolean;
  /** Дата, на которую создаётся новое событие (игнорируется при редактировании). */
  selectedDate: Dayjs;
  /** Событие для редактирования, либо null при создании нового. */
  existingEvent: CalendarEvent | null;
  onSave: (draft: CalendarEventDraft) => void | Promise<void>;
  onClose: () => void;
}

const DEFAULT_START_TIME = '09:00';
const DEFAULT_END_TIME = '10:00';

function buildInitialState(selectedDate: Dayjs, existingEvent: CalendarEvent | null) {
  return {
    title: existingEvent?.title || '',
    startDate: existingEvent?.startDate || selectedDate.format('YYYY-MM-DD'),
    endDate: existingEvent?.endDate || selectedDate.format('YYYY-MM-DD'),
    isMultiDay: existingEvent?.isMultiDay || false,
    isAllDay: existingEvent?.isAllDay ?? true,
    startTime: existingEvent?.startTime || DEFAULT_START_TIME,
    endTime: existingEvent?.endTime || DEFAULT_END_TIME,
    recurrence: (existingEvent?.recurrence || 'none') as Recurrence,
    color: existingEvent?.color || EVENT_COLORS[0],
  };
}

/**
 * Модальное окно создания/редактирования события — поверх всего экрана,
 * с оверлеем. Заменяет прежнюю инлайн-форму в панели "События дня".
 *
 * Компонент не размонтируется между открытиями (isOpen просто переключает
 * видимость через AnimatePresence), поэтому useState с начальным значением
 * из пропсов сам по себе не переинициализируется при смене selectedDate
 * или existingEvent. Чтобы форма всегда отражала актуальные данные при
 * каждом новом открытии, состояние явно пересобирается в useEffect по
 * изменению isOpen/selectedDate/existingEvent.
 *
 * "Весь день" (isAllDay) и "Многодневное" (isMultiDay) — независимые
 * переключатели: событие может длиться несколько дней и при этом иметь
 * конкретное время начала/конца в каждом из них (например, конференция
 * 10:00–18:00 три дня подряд), либо быть однодневным без времени
 * (например, день рождения).
 */
export default function EventFormModal({ isOpen, selectedDate, existingEvent, onSave, onClose }: EventFormModalProps) {
  const [form, setForm] = useState(() => buildInitialState(selectedDate, existingEvent));

  // Пересобираем состояние формы при каждом открытии модалки (а также если
  // родитель меняет selectedDate/existingEvent, пока она уже открыта) —
  // иначе поля "залипают" на значениях с первого маунта компонента.
  // Сравниваем selectedDate по отформатированной строке, а не по ссылке —
  // Dayjs создаёт новый объект на каждый рендер родителя, даже если дата
  // не изменилась.
  const selectedDateKey = selectedDate.format('YYYY-MM-DD');
  useEffect(() => {
    if (isOpen) {
      setForm(buildInitialState(selectedDate, existingEvent));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedDateKey, existingEvent?.id]);

  const canSave = form.title.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      title: form.title.trim(),
      startDate: form.startDate,
      endDate: form.isMultiDay ? form.endDate : form.startDate,
      startTime: form.isAllDay ? null : form.startTime,
      endTime: form.isAllDay ? null : form.endTime,
      color: form.color,
      recurrence: form.recurrence,
      isMultiDay: form.isMultiDay,
      isAllDay: form.isAllDay,
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            className={styles.modal}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
          >
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>{existingEvent ? 'Редактировать событие' : 'Новое событие'}</h3>
              <button type="button" onClick={onClose} className={styles.closeButton} aria-label="Закрыть">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className={styles.form}>
              <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>Название</span>
                <input
                  type="text"
                  autoFocus
                  value={form.title}
                  placeholder="Название события"
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className={styles.input}
                />
              </div>

              <div className={styles.toggleRow}>
                <label className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={form.isMultiDay}
                    onChange={(e) => setForm((f) => ({ ...f, isMultiDay: e.target.checked }))}
                  />
                  <span className={styles.switchTrack}>
                    <span className={styles.switchThumb} />
                  </span>
                  <span>Многодневное</span>
                </label>
                <label className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={form.isAllDay}
                    onChange={(e) => setForm((f) => ({ ...f, isAllDay: e.target.checked }))}
                  />
                  <span className={styles.switchTrack}>
                    <span className={styles.switchThumb} />
                  </span>
                  <span>Весь день</span>
                </label>
              </div>

              <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>{form.isMultiDay ? 'Дата начала' : 'Дата'}</span>
                <div className={styles.row}>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                    className={styles.input}
                  />
                  {form.isMultiDay && (
                    <input
                      type="date"
                      value={form.endDate}
                      min={form.startDate}
                      onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                      className={styles.input}
                    />
                  )}
                </div>
              </div>

              {!form.isAllDay && (
                <div className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>Время</span>
                  <div className={styles.row}>
                    <input
                      type="time"
                      value={form.startTime}
                      onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                      className={styles.input}
                    />
                    <input
                      type="time"
                      value={form.endTime}
                      onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                      className={styles.input}
                    />
                  </div>
                </div>
              )}

              <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>Повторение</span>
                <CustomSelect
                  value={form.recurrence}
                  onChange={(v) => setForm((f) => ({ ...f, recurrence: v }))}
                  options={[
                    { value: 'none', label: 'Один раз' },
                    { value: 'daily', label: 'Каждый день' },
                    { value: 'weekly', label: 'Раз в неделю' },
                    { value: 'monthly', label: 'Раз в месяц' },
                    { value: 'yearly', label: 'Раз в год' },
                  ]}
                />
              </div>

              <div className={styles.colorRow}>
                {EVENT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    className={`${styles.colorSwatch} ${form.color === c ? styles.colorSwatchActive : ''}`}
                    style={{ backgroundColor: c, boxShadow: form.color === c ? `0 0 8px ${c}80` : 'none' }}
                    aria-label={`Цвет ${c}`}
                  />
                ))}
              </div>

              <div className={styles.actions}>
                <button type="button" onClick={onClose} className={styles.secondaryButton}>
                  Отмена
                </button>
                <button type="button" disabled={!canSave} onClick={handleSave} className={styles.primaryButton}>
                  Сохранить
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
