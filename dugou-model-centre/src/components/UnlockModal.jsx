import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

/**
 * Try the production /api/unlock endpoint first. If it isn't reachable
 * (local dev without `vercel dev`, network failure, or the function is
 * not deployed yet) we fall back to the in-frontend mock so the unlock
 * flow remains exercisable.
 */
const requestUnlock = async (password) => {
  try {
    const res = await fetch('/api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    // 404 means the API route doesn't exist on this deployment (local
    // `vite dev` without `vercel dev`). Treat as "API not present" and
    // fall back to the frontend mock.
    if (res.status === 404) return { ok: false, reason: 'api_absent' }
    const payload = await res.json().catch(() => ({}))
    if (res.ok && payload?.ok && payload.token) {
      return { ok: true, token: payload.token }
    }
    if (res.status === 401) return { ok: false, reason: 'invalid_password' }
    if (res.status === 500) return { ok: false, reason: payload?.reason || 'server_error' }
    return { ok: false, reason: payload?.reason || 'unknown' }
  } catch (err) {
    // Network failure or CORS → fall back to mock so dev experience
    // doesn't break entirely.
    return { ok: false, reason: 'network_error' }
  }
}

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

    // Production path: hit /api/unlock and consume the signed JWT.
    const apiResult = await requestUnlock(trimmed)

    let token
    if (apiResult.ok && apiResult.token) {
      token = apiResult.token
    } else if (apiResult.reason === 'invalid_password') {
      // Real backend rejected the password — no fallback, no leak.
      setSubmitting(false)
      setError('密码不正确')
      triggerShake()
      setPassword('')
      window.setTimeout(() => inputRef.current?.focus(), 60)
      return
    } else if (apiResult.reason === 'api_absent') {
      // Only the genuine "no backend here" case (local `vite dev`, where
      // /api/unlock 404s) falls back to the frontend mock so the unlock
      // flow stays demonstrable offline.
      const passesMock = MOCK_DEV_PASSWORD == null ? true : trimmed === MOCK_DEV_PASSWORD
      if (!passesMock) {
        setSubmitting(false)
        setError('密码不正确')
        triggerShake()
        setPassword('')
        window.setTimeout(() => inputRef.current?.focus(), 60)
        return
      }
      token = issueMockUnlockToken()
    } else {
      // Backend was reachable but errored (500 / network / unknown) —
      // never silently grant access on a server failure. Surface an
      // error and bail so a misconfigured deploy can't fall open.
      setSubmitting(false)
      setError('暂时无法验证，请稍后重试')
      triggerShake()
      return
    }

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

  // Render via portal directly into document.body so the modal
  // escapes any ancestor that creates a containing block for
  // fixed-positioned descendants (backdrop-filter on .mn-bar
  // is a notable trigger).
  if (typeof document === 'undefined') return null

  return createPortal(
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
    </div>,
    document.body,
  )
}
