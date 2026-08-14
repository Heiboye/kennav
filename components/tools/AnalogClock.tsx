import React from 'react';

interface AnalogClockProps {
  date: Date;
  timezone: string;
  size?: number; // 时钟直径 px
}

/**
 * 模拟时钟（piliapp 风格）：
 * - 表盘：白/深灰底 + 粗边框 + 阴影
 * - 12 个数字刻度（1-12）
 * - 箭头形指针（时针宽短、分针细长、秒针红色带尾）
 * - 亮/暗模式通过 CSS 变量适配
 */
const AnalogClock: React.FC<AnalogClockProps> = ({ date, timezone, size = 120 }) => {
  // 计算该时区的时/分/秒
  let hours = 0, minutes = 0, seconds = 0;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value || 0);
    hours = get('hour') % 12;
    minutes = get('minute');
    seconds = get('second');
  } catch {
    // 无效时区：按本地时间显示
    hours = date.getHours() % 12;
    minutes = date.getMinutes();
    seconds = date.getSeconds();
  }

  const secondDeg = seconds * 6;
  const minuteDeg = minutes * 6 + seconds * 0.1;
  const hourDeg = hours * 30 + minutes * 0.5;

  return (
    <div
      className="relative rounded-full shadow-md flex-shrink-0 [--cv-face:#ffffff] [--cv-border:#1e1e1e] [--cv-num:#1f2937] [--cv-hour:#1e1e1e] [--cv-min:#1d4ed8] dark:[--cv-face:#505050] dark:[--cv-border:#9aa5b1] dark:[--cv-num:#e2e8f0] dark:[--cv-hour:#f1f5f9] dark:[--cv-min:#93c5fd]"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        {/* 表盘 */}
        <circle cx="50" cy="50" r="48" fill="var(--cv-face)" stroke="var(--cv-border)" strokeWidth="3" />
        {/* 数字刻度 1-12（12 在顶部） */}
        {Array.from({ length: 12 }, (_, i) => {
          const num = i === 0 ? 12 : i;
          const angle = (i * 30 - 90) * Math.PI / 180;
          const x = 50 + Math.cos(angle) * 37;
          const y = 50 + Math.sin(angle) * 37;
          return (
            <text
              key={num}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="9.5"
              fontWeight="600"
              fill="var(--cv-num)"
              fontFamily="Arial, 'PingFang SC', sans-serif"
            >
              {num}
            </text>
          );
        })}
        {/* 时针（箭头形，指向 12 点方向，按角度旋转） */}
        <polygon
          points="44.5,49 55.5,49 50,21"
          fill="var(--cv-hour)"
          transform={`rotate(${hourDeg} 50 50)`}
        />
        {/* 分针（细长箭头） */}
        <polygon
          points="46.5,49 53.5,49 50,9"
          fill="var(--cv-min)"
          transform={`rotate(${minuteDeg} 50 50)`}
        />
        {/* 秒针（红色细线 + 尾部） */}
        <line
          x1="50" y1="58" x2="50" y2="11"
          stroke="#e11d48"
          strokeWidth="1.6"
          strokeLinecap="round"
          transform={`rotate(${secondDeg} 50 50)`}
        />
        {/* 中心点 */}
        <circle cx="50" cy="50" r="3" fill="var(--cv-hour)" />
        <circle cx="50" cy="50" r="1.4" fill="#e11d48" />
      </svg>
    </div>
  );
};

export default AnalogClock;
