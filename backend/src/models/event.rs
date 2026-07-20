use serde::{Deserialize, Serialize};

/// Зеркалит `Recurrence` из app/src/types/calendar.ts.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Recurrence {
    None,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

/// Зеркалит `CalendarEvent` из app/src/types/calendar.ts.
///
/// Дата и время хранятся раздельно (а не единым ISO-datetime):
///   - startDate/endDate — календарные даты в формате "YYYY-MM-DD".
///     Для однодневных событий startDate === endDate.
///   - startTime/endTime — время в формате "HH:mm", либо `null`, если
///     событие идёт весь день (isAllDay = true).
///
/// isMultiDay и isAllDay — независимые флаги:
///   - isMultiDay: событие занимает диапазон дат (startDate..endDate),
///     а не один день.
///   - isAllDay: у события нет конкретного времени (например, день
///     рождения), в отличие от события с временем начала/конца
///     (например, "сдача отчёта, 9:00–18:00").
/// Событие может быть одновременно многодневным и с конкретным временем
/// каждый день (например, конференция 10:00–18:00 три дня подряд).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    #[serde(rename = "startDate")]
    pub start_date: String,
    #[serde(rename = "endDate")]
    pub end_date: String,
    #[serde(rename = "startTime")]
    pub start_time: Option<String>,
    #[serde(rename = "endTime")]
    pub end_time: Option<String>,
    pub color: String,
    pub recurrence: Recurrence,
    #[serde(rename = "isMultiDay")]
    pub is_multi_day: bool,
    #[serde(rename = "isAllDay")]
    pub is_all_day: bool,
}

/// Зеркалит `CalendarEventDraft` (= CalendarEvent без id) — тело запроса на создание.
#[derive(Clone, Debug, Deserialize)]
pub struct CalendarEventDraft {
    pub title: String,
    #[serde(rename = "startDate")]
    pub start_date: String,
    #[serde(rename = "endDate")]
    pub end_date: String,
    #[serde(rename = "startTime")]
    pub start_time: Option<String>,
    #[serde(rename = "endTime")]
    pub end_time: Option<String>,
    pub color: String,
    pub recurrence: Recurrence,
    #[serde(rename = "isMultiDay")]
    pub is_multi_day: bool,
    #[serde(rename = "isAllDay")]
    pub is_all_day: bool,
}
