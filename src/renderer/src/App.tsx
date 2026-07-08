import { useEffect, useState } from 'react'
import { Overlay } from './views/Overlay'
import { Editor } from './views/Editor'
import { Settings } from './views/Settings'
import { Home } from './views/Home'
import { History } from './views/History'
import { Record } from './views/Record'

type View = 'home' | 'editor' | 'history' | 'record' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [editorImage, setEditorImage] = useState<string | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)

  // The main process opens the editor fullscreen so captures show at full size;
  // leave fullscreen again as soon as we navigate anywhere else.
  useEffect(() => {
    if (view !== 'editor') window.api.setFullscreen(false)
  }, [view])

  useEffect(() => {
    window.api.onNavigate((v) => setView(v as View))
    window.api.onOpenEditor((dataUrl) => {
      setCaptureError(null)
      setEditorImage(dataUrl)
      setView('editor')
    })
    window.api.onCaptureError((msg) => {
      setCaptureError(msg)
      setView('home')
    })
    window.api.onUpdateReady(() => {
      // TODO: show update banner
    })
  }, [])

  // Overlay window — transparent fullscreen, separate BrowserWindow
  const urlView = new URLSearchParams(window.location.search).get('view')
  if (urlView === 'overlay') {
    return <Overlay />
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#09090b', color: '#fafafa' }}>
      <nav style={navBar}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>CaptureApp</span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {(['home', 'history', 'record', 'settings'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                background: view === v ? '#27272a' : 'transparent',
                border: 'none',
                color: view === v ? '#fafafa' : '#71717a',
                padding: '5px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                textTransform: 'capitalize'
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </nav>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {view === 'home' && <Home error={captureError} onErrorDismiss={() => setCaptureError(null)} />}

        {view === 'editor' && editorImage ? (
          <Editor
            dataUrl={editorImage}
            onClose={() => { setEditorImage(null); setView('home') }}
          />
        ) : view === 'editor' ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a', fontSize: 14 }}>
            No capture yet — press Ctrl+Shift+S to take a screenshot
          </div>
        ) : null}

        {view === 'history' && <History />}
        {view === 'record' && <Record />}
        {view === 'settings' && <Settings />}
      </div>
    </div>
  )
}


const navBar: React.CSSProperties = {
  padding: '10px 20px',
  borderBottom: '1px solid #27272a',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0
}
