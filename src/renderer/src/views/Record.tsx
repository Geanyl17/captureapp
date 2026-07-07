import { useEffect, useRef, useState } from 'react'
import { MonitorPlay, Circle, Square, Upload, Copy, Check, X } from 'lucide-react'
import { uploadImage } from '../lib/upload'

type Source = { id: string; name: string; thumbnail: string }
type RecordState = 'picking' | 'ready' | 'recording' | 'preview' | 'uploading' | 'done' | 'error'

export function Record() {
  const [sources, setSources] = useState<Source[]>([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [selected, setSelected] = useState<Source | null>(null)
  const [recState, setRecState] = useState<RecordState>('picking')
  const [elapsed, setElapsed] = useState(0)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [uploadedUrl, setUploadedUrl] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [copied, setCopied] = useState(false)

  const mediaRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const blobRef = useRef<Blob | null>(null)

  useEffect(() => {
    window.api.getRecordSources()
      .then((s) => { setSources(s); if (s.length) setSelected(s[0]) })
      .catch(console.error)
      .finally(() => setLoadingSources(false))
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      mediaRef.current?.getTracks().forEach((t) => t.stop())
      if (videoUrl) URL.revokeObjectURL(videoUrl)
    }
  }, [])

  async function handleStartRecording() {
    if (!selected) return
    try {
      window.api.setRecordSource(selected.id)
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      mediaRef.current = stream

      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
      recorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' })
        blobRef.current = blob
        const url = URL.createObjectURL(blob)
        setVideoUrl(url)
        setRecState('preview')
        if (timerRef.current) clearInterval(timerRef.current)
      }

      stream.getVideoTracks()[0].onended = () => stopRecording()

      recorder.start(1000)
      setElapsed(0)
      setRecState('recording')
      timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000)
    } catch (e) {
      setErrMsg((e as Error).message)
      setRecState('error')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    mediaRef.current?.getTracks().forEach((t) => t.stop())
    if (timerRef.current) clearInterval(timerRef.current)
  }

  async function handleUpload() {
    if (!blobRef.current) return
    setRecState('uploading')
    try {
      const filename = `recording-${Date.now()}.webm`
      const url = await uploadImage(blobRef.current, filename)
      setUploadedUrl(url)
      setRecState('done')
    } catch (e) {
      setErrMsg((e as Error).message)
      setRecState('error')
    }
  }

  function handleCopy() {
    window.api.copyText(uploadedUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleReset() {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoUrl(null)
    blobRef.current = null
    setElapsed(0)
    setUploadedUrl('')
    setErrMsg('')
    setCopied(false)
    setRecState('picking')
    setLoadingSources(true)
    window.api.getRecordSources()
      .then((s) => { setSources(s); if (s.length) setSelected(s[0]) })
      .catch(console.error)
      .finally(() => setLoadingSources(false))
  }

  if (recState === 'preview' && videoUrl) {
    return (
      <div style={outerWrap}>
        <div style={toolbar}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Recording Preview</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={handleReset} style={btn.secondary}>
              <X size={13} style={{ marginRight: 4 }} />
              Discard
            </button>
            <button onClick={handleUpload} style={btn.primary}>
              <Upload size={13} style={{ marginRight: 4 }} />
              Upload
            </button>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#09090b' }}>
          <video src={videoUrl} controls style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
        </div>
      </div>
    )
  }

  if (recState === 'uploading') {
    return <StatusScreen message="Uploading…" />
  }

  if (recState === 'done') {
    return (
      <div style={outerWrap}>
        <div style={toolbar}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Uploaded</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={handleReset} style={btn.secondary}>New Recording</button>
            <button onClick={handleCopy} style={{ ...btn.success, display: 'flex', alignItems: 'center', gap: 6 }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
          <MonitorPlay size={40} color="#22c55e" strokeWidth={1.5} />
          <span
            style={{ color: '#86efac', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => window.api.openExternal(uploadedUrl)}
          >
            {uploadedUrl}
          </span>
        </div>
      </div>
    )
  }

  if (recState === 'error') {
    return (
      <div style={outerWrap}>
        <StatusScreen message={`Error: ${errMsg}`} />
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 24 }}>
          <button onClick={handleReset} style={btn.secondary}>Try again</button>
        </div>
      </div>
    )
  }

  if (recState === 'recording') {
    return (
      <div style={outerWrap}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s infinite' }} />
          <span style={{ fontSize: 32, fontVariantNumeric: 'tabular-nums', color: '#fafafa', fontWeight: 600 }}>
            {fmt(elapsed)}
          </span>
          <button onClick={stopRecording} style={{ ...btn.primary, background: '#ef4444', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px' }}>
            <Square size={14} /> Stop Recording
          </button>
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.2} }`}</style>
      </div>
    )
  }

  // picking / ready state
  return (
    <div style={outerWrap}>
      <div style={toolbar}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Screen Recording</span>
        <button
          onClick={handleStartRecording}
          disabled={!selected || loadingSources}
          style={{ ...btn.primary, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <Circle size={13} />
          Start Recording
        </button>
      </div>

      {loadingSources ? (
        <div style={centerWrap}>
          <span style={{ color: '#52525b', fontSize: 13 }}>Loading sources…</span>
        </div>
      ) : !sources.length ? (
        <div style={centerWrap}>
          <MonitorPlay size={36} color="#3f3f46" strokeWidth={1.5} />
          <p style={{ color: '#52525b', fontSize: 13, marginTop: 14 }}>No capture sources found.</p>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <p style={{ fontSize: 12, color: '#52525b', marginBottom: 12 }}>Select a source to record:</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {sources.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                style={{
                  ...sourceCard,
                  border: `1px solid ${selected?.id === s.id ? '#3b82f6' : '#27272a'}`,
                  boxShadow: selected?.id === s.id ? '0 0 0 2px rgba(59,130,246,0.3)' : 'none'
                }}
              >
                <img src={s.thumbnail} alt={s.name} style={{ width: '100%', height: 'auto', display: 'block' }} />
                <span style={{ padding: '6px 8px', fontSize: 12, color: '#a1a1aa', display: 'block', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusScreen({ message }: { message: string }) {
  return (
    <div style={centerWrap}>
      <span style={{ color: '#52525b', fontSize: 13 }}>{message}</span>
    </div>
  )
}

function fmt(s: number): string {
  const m = Math.floor(s / 60).toString().padStart(2, '0')
  const sec = (s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

const outerWrap: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
const centerWrap: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }
const toolbar: React.CSSProperties = {
  padding: '10px 20px', borderBottom: '1px solid #27272a',
  display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0
}
const sourceCard: React.CSSProperties = {
  background: '#18181b', borderRadius: 8, cursor: 'pointer',
  overflow: 'hidden', textAlign: 'left', padding: 0
}
const btn = {
  primary: {
    background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
    padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center'
  } as React.CSSProperties,
  success: {
    background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6,
    padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500
  } as React.CSSProperties,
  secondary: {
    background: '#27272a', color: '#a1a1aa', border: 'none', borderRadius: 6,
    padding: '6px 14px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center'
  } as React.CSSProperties
}
