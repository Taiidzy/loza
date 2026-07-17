import { useState, useMemo } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
import { motion, AnimatePresence } from 'motion/react';
import 'dayjs/locale/ru';
import styles from './CalendarCard.module.css';

dayjs.extend(isBetween);
dayjs.locale('ru');

// --- Типы данных ---
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface CalendarEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  color: string;
  recurrence: Recurrence;
  isMultiDay: boolean;
}

const calendarVariants = {
  initial: (direction: number) => ({ x: direction * 40, opacity: 0, filter: 'blur(4px)' }),
  animate: { x: 0, opacity: 1, filter: 'blur(0px)' },
  exit: (direction: number) => ({ x: direction * -40, opacity: 0, filter: 'blur(4px)' }),
};

const COLORS = ['#ffb6d2', '#b478ff', '#3ecf6e', '#ffbd2e', '#4fc3f7'];

export const CustomCalendar = () => {
  const [currentDate, setCurrentDate] = useState<Dayjs>(dayjs());
  const [selectedDate, setSelectedDate] = useState<Dayjs | null>(null);
  const [direction, setDirection] = useState(0);

  // --- Состояние событий (CRUD) ---
  const [events, setEvents] = useState<CalendarEvent[]>([
    { id: '1', title: 'Релиз', startDate: dayjs().toISOString(), endDate: dayjs().toISOString(), color: '#ffb6d2', recurrence: 'none', isMultiDay: false },
    { id: '2', title: 'Конференция', startDate: dayjs().subtract(1, 'day').toISOString(), endDate: dayjs().add(2, 'day').toISOString(), color: '#b478ff', recurrence: 'none', isMultiDay: true },
  ]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

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

  // --- Развертывание повторяющихся событий и распределение слотов ---
  const visibleEvents = useMemo(() => {
    const expanded: CalendarEvent[] = [];
    events.forEach(evt => {
      if (evt.recurrence === 'none') {
        expanded.push(evt);
        return;
      }
      
      let currStart = dayjs(evt.startDate);
      let currEnd = dayjs(evt.endDate);
      const duration = currEnd.diff(currStart, 'millisecond');

      // Генерируем события в рамках видимого окна (с запасом)
      const limit = endDate.add(1, 'month');
      while (currStart.isBefore(limit)) {
        if (currStart.isAfter(startDate.subtract(1, 'month'))) {
          expanded.push({ ...evt, id: `${evt.id}-${currStart.valueOf()}`, startDate: currStart.toISOString(), endDate: currEnd.toISOString() });
        }
        if (evt.recurrence === 'daily') currStart = currStart.add(1, 'day');
        else if (evt.recurrence === 'weekly') currStart = currStart.add(1, 'week');
        else if (evt.recurrence === 'monthly') currStart = currStart.add(1, 'month');
        else if (evt.recurrence === 'yearly') currStart = currStart.add(1, 'year');
        currEnd = currStart.add(duration, 'millisecond');
      }
    });

    // Вычисляем вертикальные слоты для многодневных событий
    const multiDayEvents = expanded.filter(e => e.isMultiDay).sort((a, b) => dayjs(a.startDate).valueOf() - dayjs(b.startDate).valueOf());
    const eventSlots: Record<string, number> = {};
    const assignedRanges: { start: number, end: number, slot: number }[] = [];

    multiDayEvents.forEach(evt => {
      const s = dayjs(evt.startDate).startOf('day').valueOf();
      const e = dayjs(evt.endDate).endOf('day').valueOf();
      let slot = 0;
      while (assignedRanges.some(r => r.slot === slot && Math.max(s, r.start) <= Math.min(e, r.end))) {
        slot++;
      }
      eventSlots[evt.id] = slot;
      assignedRanges.push({ start: s, end: e, slot });
    });

    return { expanded, eventSlots };
  }, [events, currentDate]);

  const getEventsForDay = (targetDay: Dayjs) => {
    const dayEvents = visibleEvents.expanded.filter(e => {
      const s = dayjs(e.startDate).startOf('day');
      const ed = dayjs(e.endDate).endOf('day');
      return targetDay.isBetween(s, ed, 'day', '[]');
    });

    return {
      singleDay: dayEvents.filter(e => !e.isMultiDay),
      multiDay: dayEvents.filter(e => e.isMultiDay),
    };
  };

  const nextMonth = () => { setDirection(1); setCurrentDate(currentDate.add(1, 'month')); };
  const prevMonth = () => { setDirection(-1); setCurrentDate(currentDate.subtract(1, 'month')); };
  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  return (
    <div className="card h-full w-full flex flex-col relative overflow-hidden backdrop-blur-xl">
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
        {weekDays.map(d => <div key={d} className="cardLabel text-center !mb-0 !text-[11px]">{d}</div>)}
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
                    // ЛКМ теперь просто выделяет день
                    onClick={() => setSelectedDate(dayItem)}
                    // ПКМ по дню вызывает модалку для создания НОВОГО события
                    onContextMenu={(e) => {
                        e.preventDefault(); 
                        setSelectedDate(dayItem);
                        setEditingEvent(null);
                        setIsModalOpen(true);
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

                  {/* Отрисовка событий */}
                  <div className={styles.eventLayer}>
                    {/* Линии */}
                    {multiDay.map(evt => {
                      const slot = visibleEvents.eventSlots[evt.id] || 0;
                      const isStart = dayjs(evt.startDate).isSame(dayItem, 'day');
                      const isEnd = dayjs(evt.endDate).isSame(dayItem, 'day');
                      
                      let lineClass = styles.lineMiddle;
                      if (isStart && isEnd) lineClass = styles.lineFull;
                      else if (isStart) lineClass = styles.lineStart;
                      else if (isEnd) lineClass = styles.lineEnd;

                      return (
                        <div key={evt.id} className={styles.eventLineWrapper} style={{ top: `${slot * 6}px` }}>
                          <div className={`${styles.eventLine} ${lineClass}`} style={{ backgroundColor: evt.color, boxShadow: `0 0 6px ${evt.color}40` }} />
                        </div>
                      );
                    })}

                    {/* Точки */}
                    <div className={styles.dotsContainer}>
                      {singleDay.map(evt => (
                        <div key={evt.id} className={styles.eventDot} style={{ backgroundColor: evt.color, boxShadow: `0 0 4px ${evt.color}80` }} />
                      ))}
                    </div>
                  </div>
                  
                  {isSelected && <div className="absolute inset-0 bg-[var(--color-accent)] opacity-10 blur-md rounded-[var(--radius-sm)] pointer-events-none" />}
                  {isToday && !isSelected && <div className="absolute top-1.5 right-1.5 w-1 h-1 rounded-full bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent-glow)] pointer-events-none" />}
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Модальное окно CRUD */}
      <AnimatePresence>
        {isModalOpen && (
          <EventModal 
            onClose={() => setIsModalOpen(false)}
            selectedDate={selectedDate || dayjs()}
            existingEvent={editingEvent}
            onSave={(newEvent) => {
              if (editingEvent) setEvents(events.map(e => e.id === newEvent.id ? newEvent : e));
              else setEvents([...events, { ...newEvent, id: Date.now().toString() }]);
              setIsModalOpen(false);
            }}
            onDelete={(id) => {
              setEvents(events.filter(e => e.id !== id));
              setIsModalOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Модальное окно (Вынесено для читаемости) ---
const EventModal = ({ onClose, selectedDate, existingEvent, onSave, onDelete }: any) => {
  const [title, setTitle] = useState(existingEvent?.title || '');
  const [startDate, setStartDate] = useState(existingEvent?.startDate || selectedDate.toISOString());
  const [endDate, setEndDate] = useState(existingEvent?.endDate || selectedDate.toISOString());
  const [isMultiDay, setIsMultiDay] = useState(existingEvent?.isMultiDay || false);
  const [recurrence, setRecurrence] = useState<Recurrence>(existingEvent?.recurrence || 'none');
  const [color, setColor] = useState(existingEvent?.color || COLORS[0]);

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <motion.div 
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        className="w-[320px] bg-[rgba(28,28,38,0.95)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-lg)] p-5 shadow-2xl flex flex-col gap-4"
      >
        <h3 className="text-[var(--color-text-primary)] font-medium text-[14px]">
          {existingEvent ? 'Редактировать событие' : 'Новое событие'}
        </h3>
        
        <input 
          type="text" placeholder="Название" value={title} onChange={e => setTitle(e.target.value)}
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

        <div className="flex gap-2 justify-center py-2">
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} className={`w-5 h-5 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-transparent'}`} style={{ backgroundColor: c, boxShadow: color === c ? `0 0 8px ${c}80` : 'none' }} />
          ))}
        </div>

        <div className="flex gap-2 mt-2">
          {existingEvent && (
            <button onClick={() => onDelete(existingEvent.id)} className="px-3 py-2 rounded-[var(--radius-sm)] bg-[rgba(255,100,100,0.1)] text-[#ff6464] text-[12px] hover:bg-[rgba(255,100,100,0.2)] transition-colors">
              Удалить
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] text-[12px] hover:bg-[var(--color-surface-hover)] transition-colors">
            Отмена
          </button>
          <button onClick={() => onSave({ id: existingEvent?.id, title, startDate, endDate: isMultiDay ? endDate : startDate, color, recurrence, isMultiDay })} className="px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent-border)] text-[12px] hover:bg-[var(--color-accent)] hover:text-black transition-colors font-medium">
            Сохранить
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};