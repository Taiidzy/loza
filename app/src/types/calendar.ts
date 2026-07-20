/**
 * Доменные типы модуля календаря.
 */

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface CalendarEvent {
  id: string;
  title: string;
  /** Дата в формате "YYYY-MM-DD". Для однодневных событий startDate === endDate. */
  startDate: string;
  /** Дата в формате "YYYY-MM-DD". */
  endDate: string;
  /** Время в формате "HH:mm", либо null, если isAllDay = true. */
  startTime: string | null;
  /** Время в формате "HH:mm", либо null, если isAllDay = true. */
  endTime: string | null;
  color: string;
  recurrence: Recurrence;
  /** Событие занимает диапазон дат (startDate..endDate), а не один день. */
  isMultiDay: boolean;
  /**
   * У события нет конкретного времени (например, день рождения) —
   * в отличие от события с временем начала/конца (например, "сдача
   * отчёта, 9:00–18:00"). Независим от isMultiDay: событие может быть
   * одновременно многодневным и с конкретным временем каждый день
   * (например, конференция 10:00–18:00 три дня подряд).
   */
  isAllDay: boolean;
}

/** Данные для создания события — без id (назначается сервером). */
export type CalendarEventDraft = Omit<CalendarEvent, 'id'>;

/** Развёрнутое (материализованное) вхождение повторяющегося события. */
export interface ExpandedCalendarEvent extends CalendarEvent {
  /** id исходного (родительского) события — для открытия на редактирование. */
  sourceId: string;
}
