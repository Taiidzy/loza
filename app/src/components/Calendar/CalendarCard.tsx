import { useState } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import { motion, AnimatePresence } from 'motion/react';
import 'dayjs/locale/ru';
import styles from './CalendarCard.module.css';
import dashboardStyles from '../../pages/dashboard/DashboardPage.module.css';
import type { ExpandedCalendarEvent } from './types';

dayjs.locale('ru');

export type { CalendarEvent, Recurrence } from './types';

const calendarVariants = {
  initial: (direction: number) => ({ x: direction * 40, opacity: 0, filter: 'blur(4px)' }),
  animate: { x: 0, opacity: 1, filter: 'blur(0px)' },
  exit: (direction: number) => ({ x: direction * -40, opacity: 0, filter: 'blur(4px)' }),
};

export interface CustomCalendarProps {
  currentDate: Dayjs;
  onMonthChange: (date: Dayjs) => void;
  selectedDate: Dayjs | null;
  onSelectDate: (date: Dayjs) => void;
  getEventsForDay: (day: Dayjs) => { singleDay: ExpandedCalendarEvent[]; multiDay: ExpandedCalendarEvent[] };
  eventSlots: Record<string, number>;
  isLoading?: boolean;
  hasAnyEvents?: boolean;
}

/**
 * Сетка месяца календаря — презентационный компонент без собственного
 * состояния CRUD/выбранной даты. Выбор дня, диапазон видимых дат и данные
 * событий приходят через пропсы от родителя (ActivityTab), который владеет
 * useCalendarEvents. ЛКМ по дню — выбор (сообщается наверх через onSelectDate),
 * управление событиями теперь происходит в соседней панели "События дня",
 * а не в модалке поверх календаря.
 */
export const CustomCalendar = ({
  currentDate,
  onMonthChange,
  selectedDate,
  onSelectDate,
  getEventsForDay,
  eventSlots,
  isLoading,
  hasAnyEvents = true,
}: CustomCalendarProps) => {
  const [direction, setDirection] = useState(0);
  const [hoveredEvent, setHoveredEvent] = useState<ExpandedCalendarEvent | null>(null);

  const startOfMonth = currentDate.startOf('month');
  const endOfMonth = currentDate.endOf('month');
  const startDate = startOfMonth.startOf('week');
  const endDate = endOfMonth.endOf('week');

  const calendarDays: Dayjs[] = [];
  let day = startDate;
  while (day.isBefore(endDate, 'day') || day.isSame(endDate, 'day')) {
    calendarDays.push(day);
    day = day.add(1, 'day');
  }

  const nextMonth = () => { setDirection(1); onMonthChange(currentDate.add(1, 'month')); };
  const prevMonth = () => { setDirection(-1); onMonthChange(currentDate.subtract(1, 'month')); };
  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  return (
    <div className={`${dashboardStyles.card} h-full w-full flex flex-col relative overflow-hidden backdrop-blur-xl ${styles.calendarRoot}`}>
      <div className="flex justify-between items-center mb-5 shrink-0">
        <button onClick={prevMonth} className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors cursor-pointer">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h2 className="text-[var(--color-text-primary)] text-[15px] font-medium capitalize tracking-wide">
          {currentDate.format('MMMM YYYY')}
        </h2>
        <button onClick={nextMonth} className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors cursor-pointer">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-2 mb-2 shrink-0">
        {weekDays.map(d => <div key={d} className={`${dashboardStyles.cardLabel} text-center !mb-0 !text-[11px]`}>{d}</div>)}
      </div>

      <div className="flex-1 relative">
        <AnimatePresence mode="popLayout" custom={direction}>
          <motion.div
            key={currentDate.format('YYYY-MM')}
            custom={direction}
            variants={calendarVariants}
            initial="initial" animate="animate" exit="exit"
            transition={{ ease: [0.22, 1, 0.36, 1], duration: 0.35 }}
            className="grid grid-cols-7 grid-rows-[repeat(6,minmax(0,1fr))] gap-1.5 h-full absolute inset-0"
          >
            {calendarDays.map((dayItem) => {
              const isCurrentMonth = dayItem.month() === currentDate.month();
              const isSelected = selectedDate && dayItem.isSame(selectedDate, 'day');
              const isToday = dayItem.isSame(dayjs(), 'day');
              const { singleDay, multiDay } = getEventsForDay(dayItem);

              return (
                <button
                  key={dayItem.format('YYYY-MM-DD')}
                  type="button"
                  // ЛКМ и ПКМ теперь делают одно и то же — выбирают день;
                  // управление событиями дня происходит в панели "События дня" рядом.
                  onClick={() => onSelectDate(dayItem)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectDate(dayItem);
                  }}
                  className={`
                    relative flex flex-col items-center pt-1.5 rounded-[var(--radius-sm)] text-[13px] font-medium transition-all cursor-pointer
                    ${!isCurrentMonth ? 'text-[var(--color-text-faint)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'}
                    ${isSelected ? 'bg-[var(--color-accent-soft)] border border-[var(--color-accent-border)] text-[var(--color-accent)]' : 'border border-transparent'}
                  `}
                >
                  <span className={`z-10 ${isToday && !isSelected ? 'text-[var(--color-accent)]' : ''}`}>
                    {dayItem.date()}
                  </span>

                  <div className={styles.eventLayer}>
                    {/* Линии многодневных событий */}
                    {multiDay.map(evt => {
                      const slot = eventSlots[evt.id] || 0;
                      const isStart = dayjs(evt.startDate).isSame(dayItem, 'day');
                      const isEnd = dayjs(evt.endDate).isSame(dayItem, 'day');

                      let lineClass = styles.lineMiddle;
                      if (isStart && isEnd) lineClass = styles.lineFull;
                      else if (isStart) lineClass = styles.lineStart;
                      else if (isEnd) lineClass = styles.lineEnd;

                      return (
                        <div key={evt.id} className={styles.eventLineWrapper} style={{ top: `${slot * 6}px` }}>
                          <div
                            className={`${styles.eventLine} ${lineClass}`}
                            style={{ backgroundColor: evt.color, boxShadow: `0 0 6px ${evt.color}40`, pointerEvents: 'auto' }}
                            onMouseEnter={() => setHoveredEvent(evt)}
                            onMouseLeave={() => setHoveredEvent(null)}
                          />
                        </div>
                      );
                    })}

                    {/* Точки однодневных событий */}
                    <div className={styles.dotsContainer}>
                      {singleDay.map(evt => (
                        <div
                          key={evt.id}
                          className={styles.eventDot}
                          style={{ backgroundColor: evt.color, boxShadow: `0 0 4px ${evt.color}80`, pointerEvents: 'auto' }}
                          onMouseEnter={() => setHoveredEvent(evt)}
                          onMouseLeave={() => setHoveredEvent(null)}
                        />
                      ))}
                    </div>
                  </div>

                  {hoveredEvent && (singleDay.includes(hoveredEvent) || multiDay.includes(hoveredEvent)) && (
                    <div className={styles.tooltip}>{hoveredEvent.title}</div>
                  )}

                  {isSelected && <div className="absolute inset-0 bg-[var(--color-accent)] opacity-10 blur-md rounded-[var(--radius-sm)] pointer-events-none" />}
                  {isToday && !isSelected && <div className="absolute top-1.5 right-1.5 w-1 h-1 rounded-full bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent-glow)] pointer-events-none" />}
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      {isLoading && !hasAnyEvents && (
        <div className={styles.loadingOverlay}>Загрузка событий…</div>
      )}
    </div>
  );
};
