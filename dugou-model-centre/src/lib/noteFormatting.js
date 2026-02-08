const getSelection = (eventTarget) => {
  const start = typeof eventTarget.selectionStart === 'number' ? eventTarget.selectionStart : 0
  const end = typeof eventTarget.selectionEnd === 'number' ? eventTarget.selectionEnd : start
  return { start, end }
}

const applyWrap = (value, start, end, prefix, suffix, placeholder = '文本') => {
  const selected = value.slice(start, end)
  const inner = selected || placeholder
  const nextValue = `${value.slice(0, start)}${prefix}${inner}${suffix}${value.slice(end)}`
  const selectionStart = start + prefix.length
  const selectionEnd = selectionStart + inner.length
  return { nextValue, selectionStart, selectionEnd }
}

export const handleNoteShortcut = (event, value, onValueChange) => {
  const isMeta = event.metaKey || event.ctrlKey
  if (!isMeta) return false

  const key = String(event.key || '').toLowerCase()
  const { start, end } = getSelection(event.currentTarget)
  let wrapped = null

  if (key === 'b' && event.shiftKey) {
    wrapped = applyWrap(value, start, end, '[blue]', '[/blue]')
  } else if (key === 'r' && event.shiftKey) {
    wrapped = applyWrap(value, start, end, '[red]', '[/red]')
  } else if (key === 'b') {
    wrapped = applyWrap(value, start, end, '**', '**')
  } else if (key === 'i') {
    wrapped = applyWrap(value, start, end, '*', '*')
  }

  if (!wrapped) return false

  event.preventDefault()
  onValueChange(wrapped.nextValue)
  window.requestAnimationFrame(() => {
    try {
      event.currentTarget.focus()
      event.currentTarget.setSelectionRange(wrapped.selectionStart, wrapped.selectionEnd)
    } catch {
      // ignore caret restore failures
    }
  })
  return true
}
