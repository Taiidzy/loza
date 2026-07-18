import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { CustomCalendar } from "../../../components/Calendar/CalendarCard";
import AgendaPanel from "../../../components/Calendar/AgendaPanel";
import DayEventsPanel from "../../../components/Calendar/DayEventsPanel";
import { useCalendarEvents } from "../../../components/Calendar/useCalendarEvents";
import type { ExpandedCalendarEvent } from "../../../components/Calendar/types";
import styles from "../DashboardPage.module.css";

export default function Activity({}) {
  const [currentDate, setCurrentDate] = useState<Dayjs>(dayjs());
  const [selectedDate, setSelectedDate] = useState<Dayjs | null>(dayjs());

  // Единственный владелец данных/CRUD календаря на этом экране: сетка месяца
  // (CustomCalendar) — презентационная и получает всё через пропсы, а панель
  // "События дня" справа-внизу использует те же CRUD-колбэки напрямую вместо
  // модального окна.
  const startDate = currentDate.startOf("month").startOf("week");
  const endDate = currentDate.endOf("month").endOf("week");
  const { events, isLoading, createEvent, updateEvent, deleteEvent, getEventsForDay, eventSlots, upcoming } =
    useCalendarEvents(startDate, endDate);

  const selectedDayEvents: ExpandedCalendarEvent[] = selectedDate
    ? [...getEventsForDay(selectedDate).multiDay, ...getEventsForDay(selectedDate).singleDay]
    : [];

  const handleAgendaSelect = (evt: ExpandedCalendarEvent) => {
    const date = dayjs(evt.startDate);
    setCurrentDate(date);
    setSelectedDate(date);
  };

  return (
    // Родительский контейнер на всю страницу
    <div className="flex h-full w-full gap-4 p-4">

      {/* Левая колонка (70% ширины) */}
      <div className="flex flex-col w-[70%] gap-4 h-full">

        {/* Блок календаря (70% высоты левой колонки) */}
        <div className="h-[70%] w-full">
          <CustomCalendar
            currentDate={currentDate}
            onMonthChange={setCurrentDate}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            getEventsForDay={getEventsForDay}
            eventSlots={eventSlots}
            isLoading={isLoading}
            hasAnyEvents={events.length > 0}
          />
        </div>

        {/* Блок "События дня" (30% высоты левой колонки) — заменяет прежнюю
            пустую заглушку "Статистика / Информация": здесь теперь список
            событий выбранного дня и управление ими (Добавить/Редактировать/Удалить). */}
        <div className={`${styles.card} h-[30%] w-full flex flex-col min-h-0`}>
          <h3 className={styles.cardLabel}>
            События дня{selectedDate ? ` · ${selectedDate.format("D MMMM")}` : ""}
          </h3>
          <DayEventsPanel
            selectedDate={selectedDate}
            dayEvents={selectedDayEvents}
            events={events}
            onCreate={createEvent}
            onUpdate={updateEvent}
            onDelete={deleteEvent}
          />
        </div>

      </div>

      {/* Правая колонка (30% ширины) */}
      <div className={`${styles.card} w-[30%] h-full overflow-y-auto`}>
        <h3 className={styles.cardLabel}>Ближайшие события</h3>
        <AgendaPanel events={upcoming} isLoading={isLoading} limit={8} onSelect={handleAgendaSelect} />
      </div>

    </div>
  );
}
