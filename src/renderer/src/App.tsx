import { useEffect, useState } from 'react'
import { restoreSession } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'

// Views are swapped in from here as they get built
// Current placeholder shows auth state and wires up main→renderer events

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('home')
  const [editorImage, setEditorImage] = useState<string | null>(null)

  // Restore persisted session on launch
  useEffect(() => {
    restoreSession()
      .then((s) => setSession(s))
      .finally(() => setLoading(false))
  }, [])

  // Listen for navigation and editor events from main process
  useEffect(() => {
    window.api.onNavigate((v) => setView(v))
    window.api.onOpenEditor((dataUrl) => {
      setEditorImage(dataUrl)
      setView('editor')
    })
    window.api.onUpdateReady(() => {
      // TODO: show update banner
    })
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <span style={{ color: '#71717a', fontSize: 14 }}>Loading...</span>
      </div>
    )
  }

  // Determine current view from URL param (overlay window uses ?view=overlay)
  const urlView = new URLSearchParams(window.location.search).get('view')
  if (urlView === 'overlay') {
    return <div style={{ width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.4)', cursor: 'crosshair' }}>
      {/* Overlay / region selector — to be implemented */}
      <span style={{ color: 'white', padding: 16, fontSize: 13, opacity: 0.8 }}>
        Click and drag to select region · ESC to cancel
      </span>
    </div>
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Placeholder shell — views (editor, settings, history) slot in here */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #27272a', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>CaptureApp</span>
        <nav style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          {['home', 'history', 'record', 'settings'].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                background: view === v ? '#27272a' : 'transparent',
                border: 'none',
                color: view === v ? '#fafafa' : '#71717a',
                padding: '4px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                textTransform: 'capitalize'
              }}
            >
              {v}
            </button>
          ))}
        </nav>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52525b', fontSize: 13 }}>
        {!session ? (
          <div>Not signed in — settings view will have login</div>
        ) : (
          <div>Signed in as {session.user.email} · {view} view · build me out!</div>
        )}
        {view === 'editor' && editorImage && (
          <img src={editorImage} alt="capture" style={{ maxWidth: '100%', maxHeight: '100%', position: 'absolute' }} />
        )}
      </div>
    </div>
  )
}
