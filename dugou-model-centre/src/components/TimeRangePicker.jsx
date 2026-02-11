import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

export default function TimeRangePicker({
  value,
  onChange,
  options,
  align = 'right',
  variant = 'default',
  buttonClassName = '',
  menuClassName = '',
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  const entries = useMemo(() => Object.entries(options || {}), [options])

  useEffect(() => {
    if (!open) return undefined

    const onDocMouseDown = (event) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(event.target)) {
        setOpen(false)
      }
    }

    const onDocKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('keydown', onDocKeyDown)
    return () => {
      window.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('keydown', onDocKeyDown)
    }
  }, [open])

  const isAiry = variant === 'airy'
  const isJelly = variant === 'jelly'
  const isAqua = variant === 'aqua'
  const buttonBaseClass = isJelly
    ? 'relative overflow-hidden font-display text-amber-700 text-[13px] leading-none hover:text-amber-800 flex items-center gap-1.5 px-3 h-9 rounded-lg border border-amber-200/75 bg-gradient-to-b from-amber-50/85 via-amber-50/60 to-orange-50/45 backdrop-blur-md transition-all active:scale-[0.985]'
    : isAqua
      ? 'relative overflow-hidden text-sky-700 text-sm font-medium hover:text-sky-800 flex items-center gap-1.5 px-3 h-9 rounded-lg border border-sky-200/70 bg-gradient-to-br from-sky-50/92 via-blue-50/80 to-cyan-50/62 backdrop-blur-md transition-all active:scale-[0.985]'
    : isAiry
      ? 'text-stone-600 text-sm hover:text-stone-800 flex items-center gap-1.5 bg-white/60 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-white/70 shadow-sm hover:bg-white/80 transition-all'
      : 'text-stone-500 text-sm hover:text-amber-600 flex items-center gap-1 bg-white px-3 py-1.5 rounded-lg border border-stone-200 shadow-sm btn-hover'
  const menuBaseClass = isJelly
    ? 'absolute top-full mt-1.5 bg-orange-50/88 backdrop-blur-xl rounded-lg shadow-xl border border-amber-100/90 py-1 z-50 min-w-28 animate-fade-in'
    : isAqua
      ? 'absolute top-full mt-1.5 bg-sky-50/88 backdrop-blur-xl rounded-lg shadow-xl border border-sky-100/90 py-1 z-50 min-w-28 animate-fade-in'
    : isAiry
      ? 'absolute top-full mt-1.5 bg-white/90 backdrop-blur-md rounded-lg shadow-xl border border-white/80 py-1 z-50 min-w-28 animate-fade-in'
      : 'absolute top-full mt-1 bg-white rounded-lg shadow-xl border border-stone-200 py-1 z-50 min-w-28 animate-fade-in'
  const activeItemClass = isJelly
    ? 'font-display bg-amber-100/70 text-amber-800 font-medium'
    : isAqua
      ? 'bg-sky-100/85 text-sky-800 font-medium'
    : isAiry
      ? 'bg-white text-stone-700 font-medium'
      : 'bg-amber-50 text-amber-600'
  const inactiveItemClass = isJelly
    ? 'font-display text-stone-600 hover:bg-amber-50/80 hover:text-amber-700'
    : isAqua
      ? 'text-stone-600 hover:bg-sky-50/85 hover:text-sky-700'
    : isAiry
      ? 'text-stone-500 hover:bg-white hover:text-stone-700'
      : 'text-stone-600 hover:bg-stone-50'
  const currentLabel = options?.[value] ?? entries?.[0]?.[1] ?? ''
  const jellyButtonStyle = isJelly
    ? {
        boxShadow:
          'inset 0 1px 0 rgba(255,247,237,0.95), inset 0 -6px 12px rgba(251,191,36,0.24), 0 8px 16px -12px rgba(217,119,6,0.45)',
      }
    : undefined
  const jellyDisplayFontStyle = isJelly ? { fontFamily: '"Playfair Display", Georgia, serif' } : undefined
  const buttonStyle = isJelly ? { ...jellyButtonStyle, ...jellyDisplayFontStyle } : undefined
  const aquaButtonStyle = isAqua
    ? {
        boxShadow:
          'inset 0 1px 0 rgba(240,249,255,0.95), inset 0 -7px 14px rgba(125,211,252,0.24), 0 8px 16px -12px rgba(56,189,248,0.45)',
      }
    : undefined
  const mergedButtonStyle = isJelly ? buttonStyle : isAqua ? aquaButtonStyle : undefined

  return (
    <div ref={rootRef} className="relative z-20">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className={`${buttonBaseClass} ${buttonClassName}`}
        style={mergedButtonStyle}
      >
        {isJelly && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-1 top-[1px] h-[45%] rounded-md bg-gradient-to-b from-orange-50/95 via-orange-50/70 to-transparent"
          />
        )}
        {isAqua && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-1 top-[1px] h-[48%] rounded-md bg-gradient-to-b from-sky-50/95 via-sky-50/70 to-transparent"
          />
        )}
        <span className={`relative z-10 ${isJelly ? 'font-semibold -translate-y-px' : ''}`} style={jellyDisplayFontStyle}>
          {currentLabel}
        </span>
        <ChevronDown
          size={13}
          className={`relative z-10 transition-transform duration-200 ${
            open
              ? `rotate-180 ${isJelly ? 'text-amber-700' : isAqua ? 'text-sky-700' : 'text-stone-500'}`
              : isJelly
                ? 'text-amber-500'
                : isAqua
                  ? 'text-sky-500'
                  : 'text-stone-400'
          }`}
        />
      </button>
      {open && (
        <div
          className={`${menuBaseClass} ${
            align === 'left' ? 'left-0' : 'right-0'
          } ${menuClassName}`}
        >
          {entries.map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                onChange(key)
                setOpen(false)
              }}
              className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                value === key ? activeItemClass : inactiveItemClass
              }`}
              style={jellyDisplayFontStyle}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
