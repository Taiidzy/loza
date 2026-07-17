import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimation } from "motion/react";
import type { StorageInfo } from "../../api/serverStatus";
import styles from "./StorageOrb.module.css";

/** Форматирует байты в гигабайты: >=100 ГБ — целое число, иначе один знак после запятой. */
function formatGB(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 100 ? Math.round(gb).toString() : gb.toFixed(1);
}

interface StorageOrbProps {
  storage: StorageInfo;
}

/** Ширина всплывающей подсказки в пикселях — используется при расчёте позиции. */
const TOOLTIP_WIDTH = 260;

/** Геометрия SVG-орба. */
const ORB_SIZE = 96;
const ORB_RADIUS = 40;

/**
 * Разлёт брызг при "ударе капли" о поверхность жидкости.
 * dx/dy — смещение от центра, r — радиус капли, delay — задержка старта анимации.
 */
const SPLASH_DROPLETS = [
  { id: 1, dx: -16, dy: -22, r: 1.5, delay: 0.4 },
  { id: 2, dx: -8, dy: -14, r: 1.0, delay: 0.42 },
  { id: 3, dx: 14, dy: -18, r: 1.2, delay: 0.41 },
  { id: 4, dx: 10, dy: -12, r: 0.8, delay: 0.43 },
];

/**
 * Круглый индикатор занятого места на диске — "орб с жидкостью".
 *
 * Уровень жидкости внутри круга отражает процент занятого места, внешнее
 * кольцо разбито на цветные сегменты по категориям (фото/видео/документы...).
 * При наведении (или тапе на тач-устройствах) показывается детальный тултип.
 * При росте usedBytes проигрывается анимация "капли", падающей на поверхность.
 */
export default function StorageOrb({ storage }: StorageOrbProps) {
  const [hovered, setHovered] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const gradientId = useId();
  const clipPathId = useId();

  const showTooltip = hovered || tapped;

  // На тач-устройствах тултип открывается тапом, поэтому его нужно
  // закрывать отдельным обработчиком клика/тапа вне компонента.
  useEffect(() => {
    if (!tapped) return;

    const handleOutsideInteraction = (event: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setTapped(false);
      }
    };

    document.addEventListener("touchstart", handleOutsideInteraction);
    document.addEventListener("mousedown", handleOutsideInteraction);
    return () => {
      document.removeEventListener("touchstart", handleOutsideInteraction);
      document.removeEventListener("mousedown", handleOutsideInteraction);
    };
  }, [tapped]);

  // ── Анимация "капли" при увеличении занятого места ──
  const prevUsedBytes = useRef(storage.usedBytes);
  const [splashTrigger, setSplashTrigger] = useState(0);
  const impactControls = useAnimation(); // реакция поверхности жидкости на удар

  useEffect(() => {
    if (storage.usedBytes > prevUsedBytes.current) {
      setSplashTrigger((prev) => prev + 1);

      // Прогиб поверхности вниз и пружинный возврат — синхронизирован
      // по времени с моментом "касания" капли (см. delay ниже).
      impactControls.start({
        y: [0, 6, -2, 0],
        transition: {
          delay: 0.4,
          duration: 0.8,
          times: [0, 0.25, 0.6, 1],
          ease: "easeInOut",
        },
      });
    }
    prevUsedBytes.current = storage.usedBytes;
  }, [storage.usedBytes, impactControls]);

  const usedPercent = Math.min(100, Math.round((storage.usedBytes / storage.totalBytes) * 100));
  const freeBytes = storage.totalBytes - storage.usedBytes;

  // ── Сегменты внешнего кольца по категориям хранилища ──
  const categoriesTotal = storage.categories.reduce((sum, c) => sum + c.bytes, 0) || 1;
  let accumulatedBytes = 0;
  const segments = storage.categories.map((category) => {
    const start = accumulatedBytes / categoriesTotal;
    accumulatedBytes += category.bytes;
    const end = accumulatedBytes / categoriesTotal;
    return { ...category, start, end, share: category.bytes / categoriesTotal };
  });

  const center = ORB_SIZE / 2;
  const ringCircumference = 2 * Math.PI * ORB_RADIUS;
  const liquidLevel = ORB_SIZE - (usedPercent / 100) * ORB_SIZE;

  const handleMouseMove = (event: React.MouseEvent) => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setHoverPos({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const handleOrbClick = () => {
    if (!wrapRef.current) return;
    // На тач-устройствах курсора мыши нет — открываем тултип от центра орба.
    setHoverPos({ x: ORB_SIZE / 2, y: ORB_SIZE / 2 });
    setTapped((prev) => !prev);
  };

  // Не даём тултипу (ширина TOOLTIP_WIDTH) вылезти за края экрана по горизонтали.
  const tooltipLeft = (() => {
    if (!wrapRef.current) return hoverPos.x - TOOLTIP_WIDTH / 2;

    const rect = wrapRef.current.getBoundingClientRect();
    const desiredLeft = rect.left + hoverPos.x - TOOLTIP_WIDTH / 2;
    const margin = 8;
    const clampedLeft = Math.min(
      Math.max(desiredLeft, margin),
      window.innerWidth - TOOLTIP_WIDTH - margin
    );

    return hoverPos.x - TOOLTIP_WIDTH / 2 + (clampedLeft - desiredLeft);
  })();

  return (
    <div
      ref={wrapRef}
      className={styles.wrap}
      onMouseEnter={(e) => {
        setHovered(true);
        handleMouseMove(e);
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHovered(false)}
      onClick={handleOrbClick}
    >
      <svg width={ORB_SIZE} height={ORB_SIZE} viewBox={`0 0 ${ORB_SIZE} ${ORB_SIZE}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(180,120,255,0.9)" />
            <stop offset="100%" stopColor="rgba(255,182,210,0.9)" />
          </linearGradient>
          <clipPath id={clipPathId}>
            <circle cx={center} cy={center} r={ORB_RADIUS} />
          </clipPath>
        </defs>

        {/* Фоновый круг орба */}
        <circle
          cx={center}
          cy={center}
          r={ORB_RADIUS}
          fill="rgba(255,255,255,0.04)"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />

        {/* Внешнее кольцо: сегменты по категориям хранилища */}
        {segments.map((segment) => {
          const dash = segment.share * ringCircumference;
          const gap = ringCircumference - dash;
          const offset = -segment.start * ringCircumference;
          return (
            <circle
              key={segment.id}
              cx={center}
              cy={center}
              r={ORB_RADIUS + 5}
              fill="none"
              stroke={segment.color}
              strokeWidth="3"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${center} ${center})`}
              opacity={showTooltip ? 1 : 0.85}
              style={{ transition: "opacity 0.25s ease" }}
            />
          );
        })}

        <g clipPath={`url(#${clipPathId})`}>
          {/* Базовый уровень жидкости с двумя бегущими волнами разной скорости */}
          <motion.g
            initial={false}
            animate={{ y: liquidLevel }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Отдельная группа — реагирует только на "удар" капли (см. impactControls) */}
            <motion.g animate={impactControls}>
              <motion.path
                d={`M 0 0 Q ${ORB_SIZE * 0.25} 4 ${ORB_SIZE * 0.5} 0 T ${ORB_SIZE} 0 T ${ORB_SIZE * 1.5} 0 T ${ORB_SIZE * 2} 0 V ${ORB_SIZE} H 0 Z`}
                fill={`url(#${gradientId})`}
                opacity={0.35}
                animate={{ x: [-ORB_SIZE, 0] }}
                transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
              />
              <motion.path
                d={`M 0 0 Q ${ORB_SIZE * 0.25} -4 ${ORB_SIZE * 0.5} 0 T ${ORB_SIZE} 0 T ${ORB_SIZE * 1.5} 0 T ${ORB_SIZE * 2} 0 V ${ORB_SIZE} H 0 Z`}
                fill={`url(#${gradientId})`}
                opacity={0.65}
                animate={{ x: [0, -ORB_SIZE] }}
                transition={{ repeat: Infinity, duration: 2.5, ease: "linear" }}
              />
            </motion.g>
          </motion.g>

          {/* Капля + всплеск при увеличении занятого места (key меняется, чтобы перезапустить анимацию) */}
          {splashTrigger > 0 && (
            <g key={`splash-${splashTrigger}`}>
              {/* Капля вытягивается при падении и сплющивается в момент удара */}
              <motion.path
                d="M 0 -4 C 2.5 -1 3.5 1 3.5 3.5 A 3.5 3.5 0 0 1 -3.5 3.5 C -3.5 1 -2.5 -1 0 -4 Z"
                fill={`url(#${gradientId})`}
                initial={{ x: center, y: -15, scaleY: 1.4, scaleX: 0.8, opacity: 1 }}
                animate={{
                  x: center,
                  y: liquidLevel,
                  scaleY: [1.4, 1.4, 0.4],
                  scaleX: [0.8, 0.8, 1.6],
                  opacity: [1, 1, 0],
                }}
                transition={{
                  duration: 0.4,
                  ease: "easeIn",
                  scaleY: { times: [0, 0.9, 1] },
                  scaleX: { times: [0, 0.9, 1] },
                  opacity: { times: [0, 0.95, 1] },
                }}
              />

              {/* Расходящиеся волны на поверхности после удара */}
              <motion.ellipse
                cx={center}
                cy={liquidLevel}
                initial={{ rx: 0, ry: 0, opacity: 0.8 }}
                animate={{ rx: 28, ry: 7, opacity: 0 }}
                transition={{ delay: 0.4, duration: 0.8, ease: "easeOut" }}
                stroke={`url(#${gradientId})`}
                strokeWidth={1.5}
                fill="none"
              />
              <motion.ellipse
                cx={center}
                cy={liquidLevel}
                initial={{ rx: 0, ry: 0, opacity: 0.5 }}
                animate={{ rx: 18, ry: 4.5, opacity: 0 }}
                transition={{ delay: 0.5, duration: 0.8, ease: "easeOut" }}
                stroke={`url(#${gradientId})`}
                strokeWidth={1}
                fill="none"
              />

              {/* Брызги, разлетающиеся по параболической траектории */}
              {SPLASH_DROPLETS.map((droplet) => (
                <motion.circle
                  key={droplet.id}
                  r={droplet.r}
                  fill={`url(#${gradientId})`}
                  initial={{ x: center, y: liquidLevel, opacity: 0 }}
                  animate={{
                    x: center + droplet.dx,
                    y: [liquidLevel, liquidLevel + droplet.dy, liquidLevel + 2],
                    opacity: [0, 1, 1, 0],
                  }}
                  transition={{
                    delay: droplet.delay,
                    x: { duration: 0.5, ease: "easeOut" },
                    y: { duration: 0.5, times: [0, 0.4, 1], ease: ["easeOut", "easeIn"] },
                    opacity: { duration: 0.5, times: [0, 0.1, 0.8, 1] },
                  }}
                />
              ))}
            </g>
          )}
        </g>

        {/* Подпись в центре орба: процент занятого места */}
        <text
          x={center}
          y={center - 3}
          textAnchor="middle"
          fontSize="20"
          fontWeight="300"
          fill="#fff"
          className={styles.orbPercent}
        >
          {usedPercent}%
        </text>
        <text
          x={center}
          y={center + 14}
          textAnchor="middle"
          fontSize="8"
          fill="rgba(255,255,255,0.4)"
          letterSpacing="0.04em"
        >
          занято
        </text>
      </svg>

      <AnimatePresence>
        {showTooltip && (
          <motion.div
            className={styles.tooltip}
            initial={{ opacity: 0, scale: 0.96, x: tooltipLeft, y: hoverPos.y + 16 }}
            animate={{ opacity: 1, scale: 1, x: tooltipLeft, y: hoverPos.y + 16 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{
              opacity: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
              scale: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
              x: { type: "spring", stiffness: 700, damping: 40 },
              y: { type: "spring", stiffness: 700, damping: 40 },
            }}
          >
            <div className={styles.tooltipArrow} />

            <div className={styles.tooltipHeader}>
              <span className={styles.tooltipUsed}>
                {formatGB(storage.usedBytes)} ГБ из {formatGB(storage.totalBytes)} ГБ
              </span>
              <span className={styles.tooltipFree}>{formatGB(freeBytes)} ГБ свободно</span>
            </div>

            <div className={styles.tooltipBar}>
              {segments.map((segment) => (
                <motion.div
                  key={segment.id}
                  className={styles.tooltipBarSegment}
                  initial={{ width: 0 }}
                  animate={{ width: `${segment.share * 100}%` }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  style={{ background: segment.color }}
                />
              ))}
            </div>

            <div className={styles.tooltipLegend}>
              {segments.map((segment) => (
                <div key={segment.id} className={styles.tooltipLegendRow}>
                  <span className={styles.tooltipLegendDot} style={{ background: segment.color }} />
                  <span className={styles.tooltipLegendLabel}>{segment.label}</span>
                  <span className={styles.tooltipLegendValue}>{formatGB(segment.bytes)} ГБ</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
