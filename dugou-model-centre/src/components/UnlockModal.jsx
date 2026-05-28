import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { issueMockUnlockToken, unlockWithToken } from '../lib/displayMode'

/**
 * UnlockModal — frosted-glass password modal for entering FULL mode.
 *
 * In Step 2-5 we use a frontend mock: any non-empty password works
 * locally so the unlock flow can be exercised. In Step 6 this swaps
 * to a real fetch against /api/unlock returning a signed JWT.
 *
 * Design notes:
 *  - 32% opacity backdrop with backdrop-blur
 *  - Modal floats with subtle shadow + soft border
 *  - ESC + outside-click + X button all close
 *  - Auto-focus the input on mount
 *  - Failed attempts shake + reset
 */

const MOCK_DEV_PASSWORD = import.meta.env.VITE_DEV_UNLOCK_PASSWORD || null

export default function UnlockModal({ open, onClose, onUnlock }) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setPassword('')
    setError('')
    setShake(false)
    setSubmitting(false)
    const t = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const triggerShake = () => {
    setShake(true)
    window.setTimeout(() => setShake(false), 480)
  }

  const handleSubmit = async (event) => {
    event?.preventDefault?.()
    if (submitting) return
    const trimmed = password.trim()
    if (!trimmed) {
      setError('请输入密码')
      triggerShake()
      return
    }

    setSubmitting(true)
    setError('')

    // ── Mock validation path (Step 2-5) ──
    // Frontend-only check until /api/unlock is wired in Step 6.
    // If VITE_DEV_UNLOCK_PASSWORD is set we honor it; otherwise any
    // non-empty password passes so the flow can be tested locally.
    await new Promise((resolve) => window.setTimeout(resolve, 320))
    const passes = MOCK_DEV_PASSWORD == null ? true : trimmed === MOCK_DEV_PASSWORD
    if (!passes) {
      setSubmitting(false)
      setError('密码不正确')
      triggerShake()
      setPassword('')
      window.setTimeout(() => inputRef.current?.focus(), 60)
      return
    }

    const token = issueMockUnlockToken()
    const result = unlockWithToken(token)
    setSubmitting(false)
    if (!result.ok) {
      setError('解锁失败，请重试')
      triggerShake()
      return
    }
    onUnlock?.()
    onClose?.()
  }

  const handleBackdropClick = (event) => {
    if (event.target === event.currentTarget) onClose?.()
  }

  return (
    <div
      className="unlock-modal-backdrop"
      onClick={handleBackdropClick}
    >
      <form
        onSubmit={handleSubmit}
        className={`unlock-modal-card ${shake ? 'unlock-modal-shake' : ''}`}
      >
        <button
          type="button"
          onClick={onClose}
          className="unlock-modal-close"
          aria-label="关闭"
        >
          <X size={15} strokeWidth={1.8} />
        </button>

        <div className="unlock-modal-intro">
          <div className="unlock-modal-eyebrow">Demo Mode · Preview</div>
          <p className="unlock-modal-copy">
            你正在浏览预览版本。模型参数与历史记录均已脱敏化处理，仅用于展示产品形态与算法能力。
          </p>
          <p className="unlock-modal-copy unlock-modal-copy-muted">
            输入密码可解锁完整产品，访问真实数据与全部参数命名。
          </p>
        </div>

        <div className="unlock-modal-field">
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              if (error) setError('')
            }}
            placeholder="Password"
            className="unlock-modal-input"
            autoComplete="off"
            spellCheck={false}
          />
          {error && <div className="unlock-modal-error">{error}</div>}
        </div>

        <button type="submit" className="unlock-modal-submit" disabled={submitting}>
          {submitting ? (
            <span className="unlock-modal-spinner" aria-hidden="true" />
          ) : (
            <>
              <span>Unlock</span>
              <span className="unlock-modal-submit-arrow" aria-hidden="true">↵</span>
            </>
          )}
        </button>
      </form>
    </div>
  )
}
