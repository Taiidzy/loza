import { CustomCalendar } from "../../../components/Calendar/CalendarCard";





export default function Activity({}) {
    return (
    // Родительский контейнер на всю страницу
    <div className="flex h-full w-full gap-4 p-4">
      
      {/* Левая колонка (70% ширины) */}
      <div className="flex flex-col w-[70%] gap-4 h-full">
        
        {/* Блок календаря (70% высоты левой колонки) */}
        <div className="h-[70%] w-full">
          <CustomCalendar />
        </div>

        {/* Блок дополнительной информации (30% высоты левой колонки) */}
        <div className="card h-[30%] w-full">
          <h3 className="cardLabel">Статистика / Информация</h3>
          {/* Контент инфо-блока */}
        </div>
        
      </div>

      {/* Правая колонка (30% ширины) */}
      <div className="card w-[30%] h-full">
        <h3 className="cardLabel">Ближайшие события</h3>
        {/* Контент событий */}
      </div>

    </div>
  );
}