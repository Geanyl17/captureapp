import { useState, useEffect } from 'react'
import { signIn, signOut, restoreSession, configured as supabaseConfigured } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

type KeybindField = 'screenshot' | 'record'
type Keybinds = { screenshot: string; record: string }

// ─── Keybind helpers ─────────────────────────────────────────────────────────

const isMac = window.electron?.process?.platform === 'darwin'

function accParts(acc: string): string[] {
  return acc.split('+').map((p) => {
    if (p === 'CmdOrCtrl' || p === 'CommandOrControl') return isMac ? '⌘' : 'Ctrl'
    if (p === 'Alt') return isMac ? '⌥' : 'Alt'
    return p
  })
}

function recordCombo(e: KeyboardEvent): string | null {
  const mods: string[] = []
  if (e.ctrlKey || e.metaKey) mods.push('CmdOrCtrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return null
  if (!mods.length) return null

  const KEY_MAP: Record<string, string> = {
    ' ': 'Space', 'ArrowUp': 'Up', 'ArrowDown': 'Down',
    'ArrowLeft': 'Left', 'ArrowRight': 'Right',
    'Escape': 'Escape', 'Enter': 'Return',
    'Backspace': 'Backspace', 'Delete': 'Delete', 'Tab': 'Tab',
  }
  const mapped = KEY_MAP[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  return [...mods, mapped].join('+')
}

// ─── KeybindRow ───────────────────────────────────────────────────────────────

function KeybindRow({
  label,
  value,
  other,
  onSave,
}: {
  label: string
  value: string
  other: string
  onSave: (acc: string) => Promise<string | null>
}) {
  const [mode, setMode] = useState<'idle' | 'recording' | 'preview'>('idle')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function startRecording() {
    setPending(null)
    setError(null)
    setMode('recording')
  }

  function cancel() {
    setPending(null)
    setError(null)
    setMode('idle')
  }

  async function save() {
    if (!pending) return
    setSaving(true)
    const err = await onSave(pending)
    setSaving(false)
    if (err) {
      setError(err)
      setMode('preview')
    } else {
      setMode('idle')
      setPending(null)
    }
  }

  useEffect(() => {
    if (mode !== 'recording') return

    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()
      const combo = recordCombo(e)
      if (!combo) return

      // Can't conflict with the other shortcut
      if (combo === other) {
        setError('This shortcut is already used by the other action')
        setPending(combo)
        setMode('preview')
        return
      }
      setError(null)
      setPending(combo)
      setMode('preview')
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [mode, other])

  return (
    <div style={rowStyle}>
      <span style={{ fontSize: 13, color: '#a1a1aa', width: 90, flexShrink: 0 }}>{label}</span>

      {mode === 'idle' && (
        <>
          <AccBadges parts={accParts(value)} />
          <button onClick={startRecording} style={ghostBtn}>Change</button>
        </>
      )}

      {mode === 'recording' && (
        <>
          <span style={{ fontSize: 13, color: '#52525b', flex: 1 }}>Press a key combination…</span>
          <button onClick={cancel} style={ghostBtn}>Cancel</button>
        </>
      )}

      {mode === 'preview' && pending && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <AccBadges parts={accParts(pending)} />
            {error && <span style={{ fontSize: 12, color: '#f87171' }}>{error}</span>}
          </div>
          {!error && (
            <button onClick={save} disabled={saving} style={primarySmBtn}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          <button onClick={cancel} style={ghostBtn}>Cancel</button>
        </>
      )}
    </div>
  )
}

function AccBadges({ parts }: { parts: string[] }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1 }}>
      {parts.map((p, i) => (
        <span key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {i > 0 && <span style={{ color: '#3f3f46', fontSize: 11 }}>+</span>}
          <kbd style={kbdStyle}>{p}</kbd>
        </span>
      ))}
    </div>
  )
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function Settings() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [keybinds, setKeybinds] = useState<Keybinds | null>(null)

  useEffect(() => {
    Promise.all([restoreSession().catch(() => null), window.api.getKeybinds()])
      .then(([s, kb]) => {
        setSession(s)
        setKeybinds(kb)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setAuthError(null)
    try {
      const s = await signIn(email, password)
      if (s) setSession(s)
    } catch (err) {
      setAuthError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSignOut() {
    await signOut()
    setSession(null)
  }

  async function handleSaveKeybind(field: KeybindField, acc: string): Promise<string | null> {
    if (!keybinds) return 'Not loaded'
    const newBinds = { ...keybinds, [field]: acc }
    const result = await window.api.setKeybinds(newBinds)
    if (result.ok) setKeybinds(newBinds)
    return result.ok ? null : (result.error ?? 'Failed')
  }

  if (loading) {
    return <div style={centerWrap}><span style={{ color: '#52525b', fontSize: 13 }}>Loading…</span></div>
  }

  return (
    <div style={scrollWrap}>
      <div style={page}>

        {/* ── Account ── */}
        <section style={section}>
          <h3 style={sectionTitle}>Account</h3>
          {!supabaseConfigured ? (
            <div style={{ ...card, borderColor: '#713f12', background: '#1c1208' }}>
              <p style={{ fontSize: 13, color: '#fbbf24', marginBottom: 8, fontWeight: 600 }}>Not configured</p>
              <p style={{ fontSize: 13, color: '#a16207', lineHeight: 1.6, margin: 0 }}>
                Copy <code style={{ background: '#27272a', padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>.env.example</code> to{' '}
                <code style={{ background: '#27272a', padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>.env</code>{' '}
                and fill in your Supabase URL and anon key, then restart the app.
              </p>
            </div>
          ) : session ? (
            <div style={card}>
              <p style={{ fontSize: 12, color: '#71717a', marginBottom: 4 }}>Signed in as</p>
              <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>{session.user.email}</p>
              <p style={{ fontSize: 12, color: '#52525b', marginBottom: 20, lineHeight: 1.5 }}>
                Screenshots upload to{' '}
                <span
                  style={{ color: '#3b82f6', cursor: 'pointer' }}
                  onClick={() => window.api.openExternal('https://hosting.geanyl.site')}
                >
                  hosting.geanyl.site
                </span>
              </p>
              <button onClick={handleSignOut} style={dangerBtn}>Sign Out</button>
            </div>
          ) : (
            <div style={card}>
              <p style={{ fontSize: 13, color: '#71717a', marginBottom: 16, lineHeight: 1.5 }}>
                Sign in with your hosting.geanyl.site credentials to enable uploading.
              </p>
              <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input type="email" placeholder="Email" value={email}
                  onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
                <input type="password" placeholder="Password" value={password}
                  onChange={(e) => setPassword(e.target.value)} required style={inputStyle} />
                {authError && <p style={{ fontSize: 13, color: '#f87171', margin: 0 }}>{authError}</p>}
                <button type="submit" disabled={submitting} style={primaryBtn}>
                  {submitting ? 'Signing in…' : 'Sign In'}
                </button>
              </form>
            </div>
          )}
        </section>

        {/* ── Shortcuts ── */}
        <section style={section}>
          <h3 style={sectionTitle}>Shortcuts</h3>
          <div style={card}>
            <p style={{ fontSize: 12, color: '#52525b', marginBottom: 16 }}>
              Global — work even when the app is in the background.
            </p>
            {keybinds ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <KeybindRow
                  label="Screenshot"
                  value={keybinds.screenshot}
                  other={keybinds.record}
                  onSave={(acc) => handleSaveKeybind('screenshot', acc)}
                />
                <KeybindRow
                  label="Record"
                  value={keybinds.record}
                  other={keybinds.screenshot}
                  onSave={(acc) => handleSaveKeybind('record', acc)}
                />
              </div>
            ) : (
              <span style={{ fontSize: 13, color: '#52525b' }}>Loading shortcuts…</span>
            )}
          </div>
        </section>

      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const centerWrap: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center'
}
const scrollWrap: React.CSSProperties = {
  flex: 1, overflowY: 'auto'
}
const page: React.CSSProperties = {
  maxWidth: 480, margin: '0 auto', padding: '28px 24px', display: 'flex',
  flexDirection: 'column', gap: 28
}
const section: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }
const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: '#52525b', margin: 0
}
const card: React.CSSProperties = {
  background: '#18181b', border: '1px solid #27272a', borderRadius: 10, padding: 20
}
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 0', borderBottom: '1px solid #27272a'
}
const inputStyle: React.CSSProperties = {
  background: '#09090b', border: '1px solid #3f3f46', borderRadius: 6,
  color: '#fafafa', padding: '8px 12px', fontSize: 14, outline: 'none', width: '100%'
}
const primaryBtn: React.CSSProperties = {
  background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
  padding: '9px 14px', cursor: 'pointer', fontSize: 14, fontWeight: 500
}
const primarySmBtn: React.CSSProperties = {
  background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
  padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500, flexShrink: 0
}
const ghostBtn: React.CSSProperties = {
  background: 'transparent', color: '#71717a', border: '1px solid #3f3f46',
  borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12, flexShrink: 0
}
const dangerBtn: React.CSSProperties = {
  background: 'transparent', color: '#f87171', border: '1px solid #3f3f46',
  borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontSize: 13
}
const kbdStyle: React.CSSProperties = {
  background: '#27272a', border: '1px solid #3f3f46', borderRadius: 4,
  padding: '3px 7px', fontSize: 12, color: '#e4e4e7', fontFamily: 'inherit'
}
