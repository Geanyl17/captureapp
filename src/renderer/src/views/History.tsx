import { useEffect, useState } from 'react'
import { Copy, ExternalLink, Trash2, Clock, Check } from 'lucide-react'

type HistoryItem = {
  id: string
  url: string
  filename: string
  thumbnail: string
  timestamp: number
}

export function History() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    window.api.historyGet()
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(id: string) {
    await window.api.historyDelete(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  async function handleClearAll() {
    await window.api.historyClear()
    setItems([])
  }

  function handleCopy(url: string, id: string) {
    window.api.copyText(url)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  if (loading) {
    return (
      <div style={centerWrap}>
        <span style={{ color: '#52525b', fontSize: 13 }}>Loading…</span>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div style={centerWrap}>
        <Clock size={36} color="#3f3f46" strokeWidth={1.5} />
        <p style={{ color: '#52525b', fontSize: 13, marginTop: 14, textAlign: 'center' }}>
          No history yet.<br />Take a screenshot and upload it to get started.
        </p>
      </div>
    )
  }

  return (
    <div style={outerWrap}>
      <div style={headerRow}>
        <span style={{ fontSize: 13, color: '#71717a' }}>
          {items.length} capture{items.length !== 1 ? 's' : ''}
        </span>
        <button onClick={handleClearAll} style={clearBtn}>Clear all</button>
      </div>

      <div style={grid}>
        {items.map((item) => (
          <div key={item.id} style={card}>
            <div style={thumbWrap}>
              <img src={item.thumbnail} alt={item.filename} style={thumbImg} />
            </div>
            <div style={cardFooter}>
              <span style={{ fontSize: 11, color: '#52525b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {new Date(item.timestamp).toLocaleString()}
              </span>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <IconBtn
                  title="Copy link"
                  onClick={() => handleCopy(item.url, item.id)}
                  icon={copied === item.id
                    ? <Check size={13} color="#22c55e" />
                    : <Copy size={13} color="#71717a" />}
                />
                <IconBtn
                  title="Open in browser"
                  onClick={() => window.api.openExternal(item.url)}
                  icon={<ExternalLink size={13} color="#71717a" />}
                />
                <IconBtn
                  title="Remove from history"
                  onClick={() => handleDelete(item.id)}
                  icon={<Trash2 size={13} color="#52525b" />}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function IconBtn({ onClick, icon, title }: { onClick: () => void; icon: React.ReactNode; title: string }) {
  return (
    <button onClick={onClick} title={title} style={iconBtnStyle}>
      {icon}
    </button>
  )
}

const centerWrap: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
}
const outerWrap: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden'
}
const headerRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 20px', borderBottom: '1px solid #27272a', flexShrink: 0
}
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 12, padding: 20, overflowY: 'auto', flex: 1, alignContent: 'start'
}
const card: React.CSSProperties = {
  background: '#18181b', border: '1px solid #27272a', borderRadius: 8,
  overflow: 'hidden', display: 'flex', flexDirection: 'column'
}
const thumbWrap: React.CSSProperties = {
  width: '100%', aspectRatio: '16/9', background: '#09090b',
  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
}
const thumbImg: React.CSSProperties = {
  width: '100%', height: '100%', objectFit: 'cover'
}
const cardFooter: React.CSSProperties = {
  padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6,
  borderTop: '1px solid #27272a'
}
const clearBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #3f3f46', color: '#71717a',
  borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12
}
const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4
}
