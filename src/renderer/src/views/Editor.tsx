import { useState } from 'react'
import { uploadImage } from '../lib/upload'

type Props = { dataUrl: string; onClose: () => void }

type UploadState = 'idle' | 'uploading' | 'done' | 'error'

export function Editor({ dataUrl, onClose }: Props) {
  const [state, setState] = useState<UploadState>('idle')
  const [uploadedUrl, setUploadedUrl] = useState('')
  const [errMsg, setErrMsg] = useState('')

  async function handleUpload() {
    setState('uploading')
    try {
      const blob = await (await fetch(dataUrl)).blob()
      const url = await uploadImage(blob, `screenshot-${Date.now()}.png`)
      setUploadedUrl(url)
      window.api.copyText(url)
      setState('done')
    } catch (e) {
      setErrMsg((e as Error).message)
      setState('error')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={toolbar}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Screenshot</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => window.api.copyImage(dataUrl)} style={btn.secondary}>
            Copy Image
          </button>
          {state === 'done' ? (
            <button onClick={() => window.api.copyText(uploadedUrl)} style={btn.success}>
              ✓ Link Copied
            </button>
          ) : (
            <button onClick={handleUpload} disabled={state === 'uploading'} style={btn.primary}>
              {state === 'uploading' ? 'Uploading…' : 'Upload & Copy Link'}
            </button>
          )}
          <button onClick={onClose} style={btn.secondary}>
            New Capture
          </button>
        </div>
      </div>

      <div style={imageArea}>
        <img
          src={dataUrl}
          alt="screenshot"
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
        />
      </div>

      {state === 'error' && (
        <div style={statusBar('#450a0a', '#7f1d1d', '#fca5a5')}>
          Upload failed: {errMsg}
        </div>
      )}
      {state === 'done' && (
        <div
          style={{ ...statusBar('#052e16', '#14532d', '#86efac'), cursor: 'pointer' }}
          onClick={() => window.api.openExternal(uploadedUrl)}
          title="Click to open in browser"
        >
          {uploadedUrl}
        </div>
      )}
    </div>
  )
}

const toolbar: React.CSSProperties = {
  padding: '10px 20px',
  borderBottom: '1px solid #27272a',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0
}

const imageArea: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  overflow: 'auto',
  background: '#09090b'
}

function statusBar(bg: string, border: string, color: string): React.CSSProperties {
  return { padding: '8px 20px', background: bg, borderTop: `1px solid ${border}`, color, fontSize: 13, flexShrink: 0 }
}

const btn = {
  primary: {
    background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
    padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500
  } as React.CSSProperties,
  success: {
    background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6,
    padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500
  } as React.CSSProperties,
  secondary: {
    background: '#27272a', color: '#a1a1aa', border: 'none', borderRadius: 6,
    padding: '6px 14px', cursor: 'pointer', fontSize: 13
  } as React.CSSProperties
}
