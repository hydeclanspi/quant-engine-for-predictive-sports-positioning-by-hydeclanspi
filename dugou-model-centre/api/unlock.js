import { createHmac } from 'node:crypto'

/**
 * POST /api/unlock — verify the visitor's password and issue a signed
 * JWT that the frontend uses to flip into FULL display mode.
 *
 * Env vars required (set in Vercel project settings):
 *   - UNLOCK_PASSWORD    Plaintext shared password. Recruiters submitting
 *                        this value via the unlock modal get a token.
 *   - JWT_SECRET         HMAC-SHA256 signing secret. Any cryptographically
 *                        random string ≥32 chars; rotate to invalidate
 *                        all issued tokens.
 *   - UNLOCK_TTL_HOURS   Optional. Token lifetime in hours, default 12.
 *
 * Request body:  { password: string }
 * Response:      { ok: true, token, expSeconds } | { ok: false, reason }
 *
 * Constant-time comparison is used so an attacker cannot infer the
 * password length / prefix via response timing. Even so, this endpoint
 * is intentionally simple — the threat model is "casual visitor poking
 * around", not "credentialed attacker." The token itself only gates
 * the visual unlock; the demo data store still lives entirely on the
 * visitor's own browser, so there is no owner data behind the JWT.
 */

// Base64url-encode a string/Buffer without the trailing '=' padding,
// per the JWT (JWS) spec.
const base64url = (input) =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

// Sign a minimal HS256 JWT using Node's built-in crypto — no external
// dependency, so the function can never fail to boot for a missing
// package. The frontend only reads the `exp` claim; the signature is
// here so a server-side verifier could be added later.
const signHs256Jwt = (payload, secret) => {
  const header = { alg: 'HS256', typ: 'JWT' }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `${signingInput}.${signature}`
}

const timingSafeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) {
    // Still walk the length of one input to keep the comparison time
    // independent of the password's prefix.
    let diff = 1
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const parseBody = (req) => {
  if (req.body == null) return {}
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return null
    }
  }
  return req.body
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' })
  }

  const expectedPassword = process.env.UNLOCK_PASSWORD
  const jwtSecret = process.env.JWT_SECRET

  if (!expectedPassword || !jwtSecret) {
    return res.status(500).json({ ok: false, reason: 'server_misconfigured' })
  }
  if (jwtSecret.length < 16) {
    return res.status(500).json({ ok: false, reason: 'jwt_secret_too_short' })
  }

  const body = parseBody(req)
  if (!body) {
    return res.status(400).json({ ok: false, reason: 'invalid_body' })
  }

  const submitted = typeof body.password === 'string' ? body.password : ''
  if (!submitted) {
    return res.status(400).json({ ok: false, reason: 'password_required' })
  }

  // Constant-time comparison — never short-circuit on the first
  // mismatch so the response time leaks no information about the
  // password's contents.
  if (!timingSafeEqual(submitted, expectedPassword)) {
    return res.status(401).json({ ok: false, reason: 'invalid_password' })
  }

  const ttlHoursRaw = Number.parseFloat(process.env.UNLOCK_TTL_HOURS || '12')
  const ttlHours = Number.isFinite(ttlHoursRaw) && ttlHoursRaw > 0 ? ttlHoursRaw : 12
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expSeconds = Math.floor(nowSeconds + ttlHours * 3600)

  const token = signHs256Jwt(
    { scope: 'full', sub: 'dugou-unlock', iat: nowSeconds, exp: expSeconds },
    jwtSecret,
  )

  return res.status(200).json({
    ok: true,
    token,
    expSeconds,
    ttlHours,
  })
}
