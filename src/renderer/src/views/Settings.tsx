import { useState, useEffect } from 'react'
import { signIn, signOut, restoreSession } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

export function Settings() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    restoreSession().then((s) => {
      setSession(s)
      setLoading(false)
    })
  }, [])

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const s = await signIn(email, password)
      if (s) setSession(s)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSignOut() {
    await signOut()
    setSession(null)
  }

  if (loading) {
    return <div style={wrap}><span style={{ color: '#52525b', fontSize: 13 }}>Loading…</span></div>
  }

  if (session) {
    return (
      <div style={wrap}>
        <div style={card}>
          <p style={{ fontSize: 12, color: '#71717a', marginBottom: 4 }}>Signed in as</p>
          <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>{session.user.email}</p>
          <p style={{ fontSize: 12, color: '#52525b', marginBottom: 24, lineHeight: 1.5 }}>
            Screenshots you upload will appear in your dashboard at{' '}
            <span
              style={{ color: '#3b82f6', cursor: 'pointer' }}
              onClick={() => window.api.openExternal('https://hosting.geanyl.site')}
            >
              hosting.geanyl.site
            </span>
          </p>
          <div style={{ borderTop: '1px solid #27272a', paddingTop: 16 }}>
            <p style={{ fontSize: 12, color: '#52525b', marginBottom: 12 }}>Shortcuts</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ShortcutRow label="Screenshot" keys={['Ctrl', 'Shift', 'S']} />
              <ShortcutRow label="Record" keys={['Ctrl', 'Shift', 'R']} />
            </div>
          </div>
          <div style={{ marginTop: 24 }}>
            <button onClick={handleSignOut} style={dangerBtn}>Sign Out</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Sign In</h2>
        <p style={{ fontSize: 13, color: '#71717a', marginBottom: 20, lineHeight: 1.5 }}>
          Sign in with your hosting.geanyl.site credentials to enable uploading.
        </p>
        <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
          {error && (
            <p style={{ fontSize: 13, color: '#f87171', margin: 0 }}>{error}</p>
          )}
          <button type="submit" disabled={submitting} style={primaryBtn}>
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 13, color: '#a1a1aa' }}>{label}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {keys.map((k) => (
          <kbd key={k} style={kbdStyle}>{k}</kbd>
        ))}
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center'
}
const card: React.CSSProperties = {
  background: '#18181b', border: '1px solid #27272a', borderRadius: 12,
  padding: 28, width: 340
}
const inputStyle: React.CSSProperties = {
  background: '#09090b', border: '1px solid #3f3f46', borderRadius: 6,
  color: '#fafafa', padding: '8px 12px', fontSize: 14, outline: 'none', width: '100%'
}
const primaryBtn: React.CSSProperties = {
  background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
  padding: '9px 14px', cursor: 'pointer', fontSize: 14, fontWeight: 500
}
const dangerBtn: React.CSSProperties = {
  background: 'transparent', color: '#f87171', border: '1px solid #3f3f46',
  borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontSize: 13
}
const kbdStyle: React.CSSProperties = {
  background: '#27272a', border: '1px solid #3f3f46', borderRadius: 4,
  padding: '2px 6px', fontSize: 11, color: '#a1a1aa', fontFamily: 'inherit'
}
