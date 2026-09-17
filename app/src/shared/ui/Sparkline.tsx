interface SparklineProps {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}

/** Компактный линейный график без осей — для показа тренда (например, нагрузки CPU) в карточке. */
export default function Sparkline({ values, color, width = 80, height = 28 }: SparklineProps) {
  // Пустой массив → ничего не рисуем (иначе min/max дают ±Infinity и NaN-точки).
  if (values.length === 0) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1; // защита от деления на 0, если все значения одинаковы

  const yFor = (v: number) => height - ((v - min) / range) * height;

  const pointList =
    values.length === 1
      ? `0,${yFor(values[0])} ${width},${yFor(values[0])}`
      : values
          .map((v, i) => {
            const x = (i / (values.length - 1)) * width;
            return `${x},${yFor(v)}`;
          })
          .join(" ");

  const lastY = yFor(values[values.length - 1]);

  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <polyline
        points={pointList}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />
      {/* Точка на последнем значении — подчёркивает "текущее" состояние */}
      <circle cx={width} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}
