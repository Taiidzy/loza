/**
 * Доменные типы модуля календаря.
 *
 * Вынесены из CalendarCard.tsx, чтобы сервис данных, хук и UI-компоненты
 * могли ссылаться на них без циклических импортов из компонента.
 */

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO-строка. Для однодневных событий startDate === endDate. */
  startDate: string;
  /** ISO-строка. */
  endDate: string;
  color: string;
  recurrence: Recurrence;
  isMultiDay: boolean;
}

/** Данные для создания события — без id (назначается сервисом). */
export type CalendarEventDraft = Omit<CalendarEvent, 'id'>;

/** Развёрнутое (материализованное) вхождение повторяющегося события. */
export interface ExpandedCalendarEvent extends CalendarEvent {
  /** id исходного (родительского) события — для открытия на редактирование. */
  sourceId: string;
}
