import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import * as calendarService from '../../api/calendarService';
import { eventEnd, eventStart } from '../utils/calendarDateUtils';
import type { CalendarEvent, CalendarEventDraft, ExpandedCalendarEvent } from '../../types/calendar';

/**
 * Хук данных календаря: обёртка над calendarService (аналогично тому, как
 * DashboardPage оборачивает api/serverStatus через useState/useCallback).
 *
 * Отвечает за:
 *  - загрузку и CRUD событий через сервис;
 *  - разворачивание повторяющихся событий в конкретные вхождения
 *    в пределах видимого диапазона дат;
 *  - индексацию вхождений по дню (Map), чтобы компонент мог получать
 *    события конкретного дня за O(1) вместо фильтрации всего списка
 *    на каждый из 42 дней сетки.
 */
export function useCalendarEvents(visibleRangeStart: Dayjs, visibleRangeEnd: Dayjs) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await calendarService.getEvents();
      setEvents(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить события');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const createEvent = useCallback(async (draft: CalendarEventDraft) => {
    const created = await calendarService.createEvent(draft);
    setEvents((prev) => [...prev, created]);
    return created;
  }, []);

  const updateEvent = useCallback(async (event: CalendarEvent) => {
    const updated = await calendarService.updateEvent(event);
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    return updated;
  }, []);

  const deleteEvent = useCallback(async (id: string) => {
    await calendarService.deleteEvent(id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // --- Разворачивание recurring-событий в пределах видимого диапазона (с запасом в месяц) ---
  const expandedEvents = useMemo<ExpandedCalendarEvent[]>(() => {
    const expanded: ExpandedCalendarEvent[] = [];
    const windowStart = visibleRangeStart.subtract(1, 'month');
    const windowEnd = visibleRangeEnd.add(1, 'month');

    events.forEach((evt) => {
      if (evt.recurrence === 'none') {
        expanded.push({ ...evt, sourceId: evt.id });
        return;
      }

      // Сдвигаем именно даты (не время) — время начала/конца остаётся тем же
      // на каждом повторении, меняется только календарный день.
      let currStart = dayjs(evt.startDate, 'YYYY-MM-DD');
      const dayOffset = dayjs(evt.endDate, 'YYYY-MM-DD').diff(currStart, 'day');

      while (currStart.isBefore(windowEnd)) {
        if (currStart.isAfter(windowStart)) {
          const occurrenceStartDate = currStart.format('YYYY-MM-DD');
          const occurrenceEndDate = currStart.add(dayOffset, 'day').format('YYYY-MM-DD');
          expanded.push({
            ...evt,
            id: `${evt.id}-${currStart.valueOf()}`,
            sourceId: evt.id,
            startDate: occurrenceStartDate,
            endDate: occurrenceEndDate,
          });
        }
        if (evt.recurrence === 'daily') currStart = currStart.add(1, 'day');
        else if (evt.recurrence === 'weekly') currStart = currStart.add(1, 'week');
        else if (evt.recurrence === 'monthly') currStart = currStart.add(1, 'month');
        else currStart = currStart.add(1, 'year');
      }
    });

    return expanded;
  }, [events, visibleRangeStart, visibleRangeEnd]);

  // --- Индекс "день -> события этого дня" + вертикальные слоты для многодневных линий ---
  const { eventsByDay, eventSlots } = useMemo(() => {
    const byDay = new Map<string, { singleDay: ExpandedCalendarEvent[]; multiDay: ExpandedCalendarEvent[] }>();

    const multiDay = expandedEvents
      .filter((e) => e.isMultiDay)
      .sort((a, b) => eventStart(a).valueOf() - eventStart(b).valueOf());

    const slots: Record<string, number> = {};
    const assignedRanges: { start: number; end: number; slot: number }[] = [];
    multiDay.forEach((evt) => {
      const s = eventStart(evt).startOf('day').valueOf();
      const e = eventEnd(evt).endOf('day').valueOf();
      let slot = 0;
      while (assignedRanges.some((r) => r.slot === slot && Math.max(s, r.start) <= Math.min(e, r.end))) {
        slot++;
      }
      slots[evt.id] = slot;
      assignedRanges.push({ start: s, end: e, slot });
    });

    expandedEvents.forEach((evt) => {
      const s = eventStart(evt).startOf('day');
      const e = eventEnd(evt).endOf('day');
      let cursor = s;
      while (cursor.isBefore(e) || cursor.isSame(e, 'day')) {
        const key = cursor.format('YYYY-MM-DD');
        if (!byDay.has(key)) byDay.set(key, { singleDay: [], multiDay: [] });
        const bucket = byDay.get(key)!;
        if (evt.isMultiDay) bucket.multiDay.push(evt);
        else bucket.singleDay.push(evt);
        cursor = cursor.add(1, 'day');
      }
    });

    return { eventsByDay: byDay, eventSlots: slots };
  }, [expandedEvents]);

  const getEventsForDay = useCallback(
    (day: Dayjs) => eventsByDay.get(day.format('YYYY-MM-DD')) ?? { singleDay: [], multiDay: [] },
    [eventsByDay]
  );

  /** Ближайшие предстоящие события (для agenda-панели), развёрнутые и отсортированные. */
  const upcoming = useMemo(() => {
    const now = dayjs();
    return expandedEvents
      .filter((e) => eventEnd(e).isAfter(now))
      .sort((a, b) => eventStart(a).valueOf() - eventStart(b).valueOf());
  }, [expandedEvents]);

  return {
    events,
    isLoading,
    error,
    createEvent,
    updateEvent,
    deleteEvent,
    getEventsForDay,
    eventSlots,
    upcoming,
    reload,
  };
}
