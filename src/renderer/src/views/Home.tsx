export function Home() {
  return (
    <div style={wrap}>
      <div style={hero}>
        <div style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }}>📸</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, marginBottom: 8 }}>CaptureApp</h1>
        <p style={{ color: '#71717a', fontSize: 14, margin: 0, marginBottom: 28 }}>
          Screenshot · Annotate · Upload
        </p>
        <button onClick={() => window.api.startCapture()} style={captureBtn}>
          Take Screenshot
        </button>
        <p style={{ fontSize: 12, color: '#3f3f46', marginTop: 14 }}>
          or press{' '}
          <kbd style={kbd}>Ctrl</kbd>
          {' + '}
          <kbd style={kbd}>Shift</kbd>
          {' + '}
          <kbd style={kbd}>S</kbd>
          {' from anywhere'}
        </p>
      </div>

      <div style={featureRow}>
        <Feature icon="🖼️" label="Region select" desc="Click and drag any area" />
        <Feature icon="☁️" label="Instant upload" desc="Link copied automatically" />
        <Feature icon="🎨" label="Annotate" desc="Arrows, text, shapes — Phase 2" dimmed />
        <Feature icon="🎥" label="Record" desc="Screen video capture — Phase 4" dimmed />
      </div>
    </div>
  )
}

function Feature({ icon, label, desc, dimmed }: { icon: string; label: string; desc: string; dimmed?: boolean }) {
  return (
    <div style={{ textAlign: 'center', opacity: dimmed ? 0.35 : 1 }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12, color: '#52525b' }}>{desc}</div>
    </div>
  )
}

const wrap: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', padding: 40, gap: 48
}
const hero: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'
}
const captureBtn: React.CSSProperties = {
  background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
  padding: '12px 32px', cursor: 'pointer', fontSize: 15, fontWeight: 600
}
const featureRow: React.CSSProperties = {
  display: 'flex', gap: 40
}
const kbd: React.CSSProperties = {
  background: '#27272a', border: '1px solid #3f3f46', borderRadius: 4,
  padding: '2px 6px', fontSize: 11, color: '#a1a1aa', fontFamily: 'inherit'
}
