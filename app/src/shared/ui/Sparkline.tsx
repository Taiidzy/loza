interface SparklineProps {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}

/** Компактный линейный график без осей — для показа тренда (например, нагрузки CPU) в карточке. */
export default function Sparkline({ values, color, width = 80, height = 28 }: SparklineProps) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1; // защита от деления на 0, если все значения одинаковы

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });

  const lastValue = values[values.length - 1];
  const lastY = height - ((lastValue - min) / range) * height;

  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <polyline
        points={points.join(" ")}
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
