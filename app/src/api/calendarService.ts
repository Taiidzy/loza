import { invoke } from '@tauri-apps/api/core';
import type { CalendarEvent, CalendarEventDraft } from '../types/calendar';

/**
 * Слой данных календаря поверх Tauri.
 *
 * React не знает о сервере, транспорте или токене — это ответственность
 * Rust-слоя (см. app/src-tauri/src/calendar.rs), который сам подставляет
 * токен сессии в запросы к backend'у.
 */

const ACCENT_PINK = '#ffb6d2';
const ACCENT_VIOLET = '#b478ff';
const STATUS_GREEN = '#3ecf6e';
const STATUS_AMBER = '#ffbd2e';
const STATUS_BLUE = '#4fc3f7';
const STATUS_RED = '#ff5252';
const STATUS_TEAL = '#26a69a';
const STATUS_ORANGE = '#ff7043';
const NEUTRAL_GRAY = '#9e9e9e';
const STATUS_INDIGO = '#5c6bc0';
const STATUS_LIME = '#d4e157';
const STATUS_CYAN = '#26c6da';
const STATUS_BROWN = '#8d6e63';

/** Палитра цветов событий, доступная в UI. Первые два связаны с токенами бренда. */
export const EVENT_COLORS = [
  ACCENT_PINK, 
  ACCENT_VIOLET, 
  STATUS_GREEN, 
  STATUS_AMBER, 
  STATUS_BLUE,
  STATUS_RED,
  STATUS_TEAL,
  STATUS_ORANGE,
  NEUTRAL_GRAY,
  STATUS_INDIGO,
  STATUS_LIME,
  STATUS_CYAN,
  STATUS_BROWN
] as const;

export async function getEvents(): Promise<CalendarEvent[]> {
  return await invoke<CalendarEvent[]>('get_calendar_events');
}

export async function createEvent(draft: CalendarEventDraft): Promise<CalendarEvent> {
  return await invoke<CalendarEvent>('create_calendar_event', { draft });
}

export async function updateEvent(event: CalendarEvent): Promise<CalendarEvent> {
  return await invoke<CalendarEvent>('update_calendar_event', { event });
}

export async function deleteEvent(id: string): Promise<void> {
  await invoke<void>('delete_calendar_event', { id });
}