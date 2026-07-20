import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { CustomCalendar } from "../../../components/Calendar/CalendarCard";
import AgendaPanel from "../../../components/Calendar/AgendaPanel";
import DayEventsPanel from "../../../components/Calendar/DayEventsPanel";
import EventDetailsModal from "../../../components/Calendar/EventDetailsModal";
import EventFormModal from "../../../components/Calendar/EventFormModal";
import { useCalendarEvents } from "../../../shared/hooks/useCalendarEvents";
import type { CalendarEvent, ExpandedCalendarEvent } from "../../../types/calendar";
import styles from "../DashboardPage.module.css";

export default function Activity({}) {
  const [currentDate, setCurrentDate] = useState<Dayjs>(dayjs());
  const [selectedDate, setSelectedDate] = useState<Dayjs | null>(dayjs());

  // Единственный владелец данных/CRUD календаря на этом экране: сетка месяца
  // (CustomCalendar) — презентационная и получает всё через пропсы, а панель
  // "События дня" и agenda-панель ("Ближайшие события") используют те же
  // CRUD-колбэки и открывают модальные окна вместо инлайн-редактирования.
  const startDate = currentDate.startOf("month").startOf("week");
  const endDate = currentDate.endOf("month").endOf("week");
  const { events, isLoading, createEvent, updateEvent, deleteEvent, getEventsForDay, eventSlots, upcoming } =
    useCalendarEvents(startDate, endDate);

  const selectedDayEvents: ExpandedCalendarEvent[] = selectedDate
    ? [...getEventsForDay(selectedDate).multiDay, ...getEventsForDay(selectedDate).singleDay]
    : [];

  // Модалка деталей/редактирования события, открытого из agenda-панели
  // ("Ближайшие события" справа). У DayEventsPanel — своя пара модалок,
  // так как она уже владеет выбранным днём; здесь состояние отдельное,
  // потому что клик может прийти по событию любого дня, не только выбранного.
  const [agendaModal, setAgendaModal] = useState<
    { kind: "none" } | { kind: "details"; event: ExpandedCalendarEvent } | { kind: "edit"; event: ExpandedCalendarEvent }
  >({ kind: "none" });

  const handleAgendaSelect = (evt: ExpandedCalendarEvent) => {
    setAgendaModal({ kind: "details", event: evt });
  };

  const agendaOriginalEvent = (evt: ExpandedCalendarEvent): CalendarEvent | null =>
    events.find((e) => e.id === evt.sourceId) ?? null;

  const handleAgendaDelete = async (evt: ExpandedCalendarEvent) => {
    const original = agendaOriginalEvent(evt);
    if (!original) return;
    await deleteEvent(original.id);
    setAgendaModal({ kind: "none" });
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

        {/* Блок "События дня" (30% высоты левой колонки): список событий
            выбранного дня, создание/редактирование/просмотр — через модальные
            окна (см. DayEventsPanel). */}
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

      {/* Модалки для событий, открытых из agenda-панели */}
      <EventDetailsModal
        event={agendaModal.kind === "details" ? agendaModal.event : null}
        onEdit={() => agendaModal.kind === "details" && setAgendaModal({ kind: "edit", event: agendaModal.event })}
        onDelete={() => agendaModal.kind === "details" && handleAgendaDelete(agendaModal.event)}
        onClose={() => setAgendaModal({ kind: "none" })}
      />
      <EventFormModal
        isOpen={agendaModal.kind === "edit"}
        selectedDate={agendaModal.kind === "edit" ? dayjs(agendaModal.event.startDate, "YYYY-MM-DD") : dayjs()}
        existingEvent={agendaModal.kind === "edit" ? agendaOriginalEvent(agendaModal.event) : null}
        onSave={async (draft) => {
          if (agendaModal.kind !== "edit") return;
          const original = agendaOriginalEvent(agendaModal.event);
          if (original) await updateEvent({ ...draft, id: original.id });
          setAgendaModal({ kind: "none" });
        }}
        onClose={() => setAgendaModal({ kind: "none" })}
      />

    </div>
  );
}
