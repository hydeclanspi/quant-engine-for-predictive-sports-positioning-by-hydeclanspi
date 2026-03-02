/**
 * 简单垃圾桶图标
 * 极简设计，只用基础线条
 */

export default function SimpleBinIcon({ size = 12, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="0.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* 盖子 */}
      <line x1="2" y1="2" x2="10" y2="2" />
      {/* 把手 */}
      <line x1="4" y1="1.5" x2="4" y2="2" />
      <line x1="8" y1="1.5" x2="8" y2="2" />
      {/* 桶身 */}
      <path d="M 3 2.5 L 3.2 10 Q 3.2 10.5 3.7 10.5 L 8.3 10.5 Q 8.8 10.5 8.8 10 L 9 2.5" />
      {/* 内部竖线 */}
      <line x1="5" y1="3.5" x2="5" y2="9" />
      <line x1="7" y1="3.5" x2="7" y2="9" />
    </svg>
  )
}
