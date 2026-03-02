/**
 * 科幻时钟回溯图标 - 动态旋转效果
 * 设计灵感：Google Gemini + 硅谷科技感
 * 梯度：蓝 → 青色，带顺时针旋转动画
 */

export default function TimeMachineIcon({ size = 24, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`${className} animate-spin-reverse`}
      style={{
        animation: 'spinReverse 3s linear infinite',
      }}
      aria-hidden="true"
    >
      {/* 外圆：梯度边框 */}
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="url(#timeMachineGradient)"
        strokeWidth="2"
      />

      {/* 时针（12点方向）*/}
      <path
        d="M 12 12 L 12 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* 分针（3点方向）*/}
      <path
        d="M 12 12 L 16 12"
        stroke="url(#timeMachineGradient)"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* 中心点 */}
      <circle cx="12" cy="12" r="2" fill="currentColor" />

      {/* 回溯箭头弧线 */}
      <path
        d="M 6 12 C 6 9 8 7 11 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          animation: 'pulse 2s ease-in-out infinite',
        }}
      />

      {/* 回溯箭头头部 */}
      <path
        d="M 8 9 L 6 7 L 7 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 梯度定义：蓝 → 青 */}
      <defs>
        <linearGradient
          id="timeMachineGradient"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
        >
          <stop offset="0%" stopColor="#3b82f6" /> {/* blue-500 */}
          <stop offset="100%" stopColor="#06b6d4" /> {/* cyan-500 */}
        </linearGradient>
      </defs>
    </svg>
  )
}
