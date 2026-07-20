import dayjs, { type Dayjs } from 'dayjs';
import type { CalendarEvent } from '../../types/calendar';

/**
 * Собирает dayjs-объект начала события из startDate + startTime.
 * Если isAllDay (startTime === null), время считается началом дня (00:00).
 */
export function eventStart(evt: Pick<CalendarEvent, 'startDate' | 'startTime'>): Dayjs {
  const base = dayjs(evt.startDate, 'YYYY-MM-DD');
  if (!evt.startTime) return base.startOf('day');
  const [h, m] = evt.startTime.split(':').map(Number);
  return base.hour(h).minute(m).second(0).millisecond(0);
}

/**
 * Собирает dayjs-объект конца события из endDate + endTime.
 * Если isAllDay (endTime === null), время считается концом дня (23:59:59.999) —
 * так однодневное all-day событие корректно длится весь день при сравнениях.
 */
export function eventEnd(evt: Pick<CalendarEvent, 'endDate' | 'endTime'>): Dayjs {
  const base = dayjs(evt.endDate, 'YYYY-MM-DD');
  if (!evt.endTime) return base.endOf('day');
  const [h, m] = evt.endTime.split(':').map(Number);
  return base.hour(h).minute(m).second(0).millisecond(0);
}

/** Короткая подпись времени события для UI: "весь день" либо "9:00–18:00". */
export function eventTimeLabel(evt: Pick<CalendarEvent, 'isAllDay' | 'startTime' | 'endTime'>): string {
  if (evt.isAllDay || !evt.startTime) return 'Весь день';
  return evt.endTime ? `${evt.startTime}–${evt.endTime}` : evt.startTime;
}