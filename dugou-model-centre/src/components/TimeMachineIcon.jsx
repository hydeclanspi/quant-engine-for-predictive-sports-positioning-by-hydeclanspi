/**
 * 科幻时光穿梭图标 - PVZ 风格
 * 特点：斜体时钟 + 多层发光圆 + 时空扭曲感
 * 灵感：时空传送门、魔幻能量场
 */

export default function TimeMachineIcon({ size = 24, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={{
        filter: 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.3))',
      }}
      aria-hidden="true"
    >
      {/* 外层光晕圆 1 - 最大，最淡 */}
      <circle
        cx="12"
        cy="12"
        r="11"
        stroke="url(#outerGradient)"
        strokeWidth="1"
        opacity="0.3"
      />

      {/* 外层光晕圆 2 - 中等 */}
      <circle
        cx="12"
        cy="12"
        r="10.2"
        stroke="url(#outerGradient)"
        strokeWidth="1"
        opacity="0.5"
      />

      {/* 主体圆 - 边框 */}
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="url(#mainGradient)"
        strokeWidth="1.5"
        opacity="0.9"
      />

      {/* 斜体时钟外壳 */}
      <g style={{ transform: 'skewX(-15deg) skewY(5deg)', transformOrigin: '12px 12px' }}>
        {/* 时钟刻度圆 */}
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="url(#mainGradient)" strokeWidth="1" opacity="0.4" />

        {/* 12点位置标记 */}
        <line x1="12" y1="4.5" x2="12" y2="3.5" stroke="url(#mainGradient)" strokeWidth="1.2" opacity="0.8" />

        {/* 时针 - 短针 */}
        <line
          x1="12"
          y1="12"
          x2="12"
          y2="7"
          stroke="url(#mainGradient)"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.9"
        />

        {/* 分针 - 长针，指向右下 */}
        <line
          x1="12"
          y1="12"
          x2="16.5"
          y2="14"
          stroke="url(#accentGradient)"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.85"
        />
      </g>

      {/* 时空扭曲波纹 - 下方 */}
      <path
        d="M 6 14 Q 9 15.5 12 14 Q 15 12.5 18 14"
        stroke="url(#accentGradient)"
        strokeWidth="1"
        fill="none"
        opacity="0.5"
        strokeLinecap="round"
      />

      {/* 中心能量点 */}
      <circle cx="12" cy="12" r="1.5" fill="url(#centerGlow)" opacity="0.9" />

      {/* 梯度定义 */}
      <defs>
        {/* 主梯度：蓝 → 青 */}
        <linearGradient id="mainGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>

        {/* 外层梯度：更淡的蓝青 */}
        <linearGradient id="outerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#60a5fa" opacity="0.4" />
          <stop offset="100%" stopColor="#22d3ee" opacity="0.3" />
        </linearGradient>

        {/* 强调梯度：青 → 紫 */}
        <linearGradient id="accentGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>

        {/* 中心发光 */}
        <radialGradient id="centerGlow">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#3b82f6" />
        </radialGradient>
      </defs>
    </svg>
  )
}
