/** Форматирует байты в гигабайты: >=100 ГБ — целое число, иначе один знак после запятой. */
export function formatGB(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 100 ? Math.round(gb).toString() : gb.toFixed(1);
}

export function formatBytes(bytes: number): string {
    const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];

    let value = bytes;
    let i = 0;

    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }

    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
};