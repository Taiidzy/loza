import { useState, useRef, useId, useEffect } from "react";
import { motion, AnimatePresence, useAnimation } from "motion/react";
import type { StorageInfo } from "../api/serverStatus";

function formatGB(bytes: number) {
  const gb = bytes / 1024 ** 3;
  return gb >= 100 ? Math.round(gb).toString() : gb.toFixed(1);
}

interface StorageOrbProps {
  storage: StorageInfo;
}

export default function StorageOrb({ storage }: StorageOrbProps) {
  const [hovered, setHovered] = useState(false);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const gradId = useId();
  const clipId = useId();

  const prevUsed = useRef(storage.usedBytes);
  const [splashTrigger, setSplashTrigger] = useState(0);
  
  // Контроллер для анимации удара по поверхности жидкости
  const impactControls = useAnimation();

  useEffect(() => {
    if (storage.usedBytes > prevUsed.current) {
      setSplashTrigger((prev) => prev + 1);
      
      // Запускаем реакцию жидкости на удар (прогиб вниз и пружинный возврат)
      impactControls.start({
        y: [0, 6, -2, 0],
        transition: { 
          delay: 0.4, // Синхронизация с моментом касания капли
          duration: 0.8, 
          times: [0, 0.25, 0.6, 1], 
          ease: "easeInOut" 
        }
      });
    }
    prevUsed.current = storage.usedBytes;
  }, [storage.usedBytes, impactControls]);

  const pct = Math.min(100, Math.round((storage.usedBytes / storage.totalBytes) * 100));
  const freeBytes = storage.totalBytes - storage.usedBytes;

  const total = storage.categories.reduce((s, c) => s + c.bytes, 0) || 1;
  let acc = 0;
  const segments = storage.categories.map((c) => {
    const start = acc / total;
    acc += c.bytes;
    const end = acc / total;
    return { ...c, start, end, share: c.bytes / total };
  });

  const size = 96;
  const r = 40;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  const liquidLevel = size - (pct / 100) * size;

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setHoverPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  // Конфигурация брызг (разлет в разные стороны)
  const droplets = [
    { id: 1, dx: -16, dy: -22, r: 1.5, delay: 0.4 },
    { id: 2, dx: -8,  dy: -14, r: 1.0, delay: 0.42 },
    { id: 3, dx: 14,  dy: -18, r: 1.2, delay: 0.41 },
    { id: 4, dx: 10,  dy: -12, r: 0.8, delay: 0.43 }
  ];

  return (
    <div
      ref={wrapRef}
      onMouseEnter={(e) => {
        setHovered(true);
        handleMouseMove(e);
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHovered(false)}
      style={{ position: "relative", display: "inline-flex", cursor: "default" }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(180,120,255,0.9)" />
            <stop offset="100%" stopColor="rgba(255,182,210,0.9)" />
          </linearGradient>
          <clipPath id={clipId}>
            <circle cx={cx} cy={cy} r={r} />
          </clipPath>
        </defs>

        <circle
          cx={cx} cy={cy} r={r}
          fill="rgba(255,255,255,0.04)"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />

        {segments.map((s) => {
          const dash = s.share * circumference;
          const gap = circumference - dash;
          const offset = -s.start * circumference;
          return (
            <circle
              key={s.id}
              cx={cx} cy={cy} r={r + 5}
              fill="none"
              stroke={s.color}
              strokeWidth="3"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${cx} ${cy})`}
              opacity={hovered ? 1 : 0.85}
              style={{ transition: "opacity 0.25s ease" }}
            />
          );
        })}

        <g clipPath={`url(#${clipId})`}>
          {/* Базовый уровень жидкости */}
          <motion.g
            initial={false}
            animate={{ y: liquidLevel }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Группа, отвечающая только за реакцию на удар капли */}
            <motion.g animate={impactControls}>
              <motion.path
                d={`M 0 0 Q ${size * 0.25} 4 ${size * 0.5} 0 T ${size} 0 T ${size * 1.5} 0 T ${size * 2} 0 V ${size} H 0 Z`}
                fill={`url(#${gradId})`}
                opacity={0.35}
                animate={{ x: [-size, 0] }}
                transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
              />
              <motion.path
                d={`M 0 0 Q ${size * 0.25} -4 ${size * 0.5} 0 T ${size} 0 T ${size * 1.5} 0 T ${size * 2} 0 V ${size} H 0 Z`}
                fill={`url(#${gradId})`}
                opacity={0.65}
                animate={{ x: [0, -size] }}
                transition={{ repeat: Infinity, duration: 2.5, ease: "linear" }}
              />
            </motion.g>
          </motion.g>

          {/* ── Эффект падения капли и всплеска ── */}
          {splashTrigger > 0 && (
            <g key={`splash-${splashTrigger}`}>
              {/* Настоящая форма капли, вытягивающаяся при падении и сплющивающаяся при ударе */}
              <motion.path
                d="M 0 -4 C 2.5 -1 3.5 1 3.5 3.5 A 3.5 3.5 0 0 1 -3.5 3.5 C -3.5 1 -2.5 -1 0 -4 Z"
                fill={`url(#${gradId})`}
                initial={{ x: cx, y: -15, scaleY: 1.4, scaleX: 0.8, opacity: 1 }}
                animate={{ 
                  x: cx, 
                  y: liquidLevel, 
                  scaleY: [1.4, 1.4, 0.4], 
                  scaleX: [0.8, 0.8, 1.6],
                  opacity: [1, 1, 0] 
                }}
                transition={{ 
                  duration: 0.4, 
                  ease: "easeIn",
                  scaleY: { times: [0, 0.9, 1] },
                  scaleX: { times: [0, 0.9, 1] },
                  opacity: { times: [0, 0.95, 1] }
                }}
              />

              {/* Расходящиеся волны на поверхности */}
              <motion.ellipse
                cx={cx} cy={liquidLevel}
                initial={{ rx: 0, ry: 0, opacity: 0.8 }}
                animate={{ rx: 28, ry: 7, opacity: 0 }}
                transition={{ delay: 0.4, duration: 0.8, ease: "easeOut" }}
                stroke={`url(#${gradId})`}
                strokeWidth={1.5}
                fill="none"
              />
              <motion.ellipse
                cx={cx} cy={liquidLevel}
                initial={{ rx: 0, ry: 0, opacity: 0.5 }}
                animate={{ rx: 18, ry: 4.5, opacity: 0 }}
                transition={{ delay: 0.5, duration: 0.8, ease: "easeOut" }}
                stroke={`url(#${gradId})`}
                strokeWidth={1}
                fill="none"
              />

              {/* Брызги с параболической траекторией */}
              {droplets.map((d) => (
                <motion.circle
                  key={d.id}
                  r={d.r}
                  fill={`url(#${gradId})`}
                  initial={{ x: cx, y: liquidLevel, opacity: 0 }}
                  animate={{ 
                    x: cx + d.dx, 
                    y: [liquidLevel, liquidLevel + d.dy, liquidLevel + 2], 
                    opacity: [0, 1, 1, 0] 
                  }}
                  transition={{ 
                    delay: d.delay, 
                    x: { duration: 0.5, ease: "easeOut" },
                    y: { duration: 0.5, times: [0, 0.4, 1], ease: ["easeOut", "easeIn"] },
                    opacity: { duration: 0.5, times: [0, 0.1, 0.8, 1] }
                  }}
                />
              ))}
            </g>
          )}
        </g>

        <text
          x={cx} y={cy - 3}
          textAnchor="middle"
          fontSize="20"
          fontWeight="300"
          fill="#fff"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {pct}%
        </text>
        <text
          x={cx} y={cy + 14}
          textAnchor="middle"
          fontSize="8"
          fill="rgba(255,255,255,0.4)"
          letterSpacing="0.04em"
        >
          занято
        </text>
      </svg>

      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, x: hoverPos.x - 130, y: hoverPos.y + 16 }}
            animate={{ opacity: 1, scale: 1, x: hoverPos.x - 130, y: hoverPos.y + 16 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{
              opacity: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
              scale: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
              x: { type: "spring", stiffness: 700, damping: 40 },
              y: { type: "spring", stiffness: 700, damping: 40 }
            }}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 260,
              background: "rgba(28,28,38,0.92)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 14,
              padding: "16px 16px 14px",
              zIndex: 30,
              boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
              pointerEvents: "none",
            }}
          >
            <div style={{
              position: "absolute", top: -5, left: "50%", transform: "translateX(-50%) rotate(45deg)",
              width: 10, height: 10,
              background: "rgba(28,28,38,0.92)",
              borderLeft: "1px solid rgba(255,255,255,0.1)",
              borderTop: "1px solid rgba(255,255,255,0.1)",
            }} />

            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.85)" }}>
                {formatGB(storage.usedBytes)} ГБ из {formatGB(storage.totalBytes)} ГБ
              </span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                {formatGB(freeBytes)} ГБ свободно
              </span>
            </div>

            <div style={{
              display: "flex", width: "100%", height: 7, borderRadius: 4, overflow: "hidden",
              background: "rgba(255,255,255,0.06)", marginBottom: 14, gap: 1,
            }}>
              {segments.map((s) => (
                <motion.div
                  key={s.id}
                  initial={{ width: 0 }}
                  animate={{ width: `${s.share * 100}%` }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  style={{ background: s.color, height: "100%" }}
                />
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {segments.map((s) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)", flex: 1 }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontVariantNumeric: "tabular-nums" }}>
                    {formatGB(s.bytes)} ГБ
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}