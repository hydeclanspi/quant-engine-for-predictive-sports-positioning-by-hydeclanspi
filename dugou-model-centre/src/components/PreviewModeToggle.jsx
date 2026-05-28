import { useState } from 'react'
import { FULL_MODE, lockToPreview, useDisplayMode } from '../lib/displayMode'
import UnlockModal from './UnlockModal'

/**
 * PreviewModeToggle — the topbar capsule that swaps between
 * PREVIEW (default, public-facing) and FULL (private, unlocked) modes.
 *
 * Visual states:
 *  - PREVIEW: prominent amber-tinted "PREVIEW" pill with q-bounce hover.
 *      Clicking opens the password modal.
 *  - FULL: minimal "● Live" indicator. Clicking flips back to preview
 *      instantly (no password needed to downgrade).
 *
 * The visible footprint in FULL mode is deliberately tiny so the
 * unlocked UI looks essentially identical to the pre-existing product.
 */

export default function PreviewModeToggle() {
  const mode = useDisplayMode()
  const [modalOpen, setModalOpen] = useState(false)

  const handleClick = () => {
    if (mode === FULL_MODE) {
      lockToPreview()
      return
    }
    setModalOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={mode === FULL_MODE ? 'pm-toggle pm-toggle-full' : 'pm-toggle pm-toggle-preview'}
        title={mode === FULL_MODE ? '点击锁回预览模式' : '点击解锁完整模式'}
        aria-label={mode === FULL_MODE ? 'Lock to preview mode' : 'Unlock full mode'}
      >
        {mode === FULL_MODE ? (
          <>
            <span className="pm-toggle-live-dot" aria-hidden="true" />
            <span className="pm-toggle-live-text">Live</span>
          </>
        ) : (
          <>
            <span className="pm-toggle-preview-dot" aria-hidden="true" />
            <span className="pm-toggle-preview-text">demo · preview</span>
            <span className="pm-toggle-preview-hint" aria-hidden="true">unlock</span>
          </>
        )}
      </button>

      <UnlockModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  )
}
