import dayjs from 'dayjs';
import type { CalendarEvent, CalendarEventDraft } from './types';

/**
 * In-memory слой хранения событий календаря.
 *
 * Сознательно повторяет форму будущего API-клиента: все операции — async
 * и возвращают Promise, ошибки выбрасываются как Error. Когда появится
 * backend, этот файл можно заменить на обёртку над fetch/axios с тем же
 * набором экспортов (getEvents/createEvent/updateEvent/deleteEvent) —
 * остальной код модуля (useCalendarEvents) менять не придётся.
 *
 * Данные живут в памяти модуля (module-level переменная), поэтому переживают
 * ре-рендеры и переключение вкладок, но сбрасываются при перезагрузке страницы —
 * это ожидаемо для текущего этапа (см. ТЗ: без localStorage/IndexedDB).
 */

const ACCENT_PINK = '#ffb6d2';
const ACCENT_VIOLET = '#b478ff';
const STATUS_GREEN = '#3ecf6e';
const STATUS_AMBER = '#ffbd2e';
const STATUS_BLUE = '#4fc3f7';

/** Палитра цветов событий, доступная в UI. Первые два связаны с токенами бренда. */
export const EVENT_COLORS = [ACCENT_PINK, ACCENT_VIOLET, STATUS_GREEN, STATUS_AMBER, STATUS_BLUE] as const;

let seq = 100;
const nextId = () => `evt-${seq++}`;

/** Реалистичные mock-данные: релиз, конференция, регулярные встречи, дедлайн. */
let store: CalendarEvent[] = [
  {
    id: 'evt-1',
    title: 'Релиз v2.4',
    startDate: dayjs().toISOString(),
    endDate: dayjs().toISOString(),
    color: ACCENT_PINK,
    recurrence: 'none',
    isMultiDay: false,
  },
  {
    id: 'evt-2',
    title: 'Конференция DevConf',
    startDate: dayjs().subtract(1, 'day').toISOString(),
    endDate: dayjs().add(2, 'day').toISOString(),
    color: ACCENT_VIOLET,
    recurrence: 'none',
    isMultiDay: true,
  },
  {
    id: 'evt-3',
    title: 'Синк с командой',
    startDate: dayjs().hour(10).minute(0).toISOString(),
    endDate: dayjs().hour(10).minute(30).toISOString(),
    color: STATUS_BLUE,
    recurrence: 'weekly',
    isMultiDay: false,
  },
  {
    id: 'evt-4',
    title: 'Сдача отчёта',
    startDate: dayjs().add(5, 'day').toISOString(),
    endDate: dayjs().add(5, 'day').toISOString(),
    color: STATUS_AMBER,
    recurrence: 'monthly',
    isMultiDay: false,
  },
  {
    id: 'evt-5',
    title: 'Ретро спринта',
    startDate: dayjs().add(9, 'day').toISOString(),
    endDate: dayjs().add(9, 'day').toISOString(),
    color: STATUS_GREEN,
    recurrence: 'none',
    isMultiDay: false,
  },
];

/** Искусственная задержка сети — чтобы UI (лоадеры) вели себя так же, как будут вести с реальным API. */
const NETWORK_DELAY_MS = 120;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getEvents(): Promise<CalendarEvent[]> {
  await wait(NETWORK_DELAY_MS);
  return [...store];
}

export async function createEvent(draft: CalendarEventDraft): Promise<CalendarEvent> {
  await wait(NETWORK_DELAY_MS);
  const event: CalendarEvent = { ...draft, id: nextId() };
  store = [...store, event];
  return event;
}

export async function updateEvent(event: CalendarEvent): Promise<CalendarEvent> {
  await wait(NETWORK_DELAY_MS);
  const exists = store.some((e) => e.id === event.id);
  if (!exists) {
    throw new Error(`Событие с id "${event.id}" не найдено`);
  }
  store = store.map((e) => (e.id === event.id ? event : e));
  return event;
}

export async function deleteEvent(id: string): Promise<void> {
  await wait(NETWORK_DELAY_MS);
  store = store.filter((e) => e.id !== id);
}
