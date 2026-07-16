import { useEffect, useRef, useState } from 'react'
import { Check, MousePointer2, Pencil, Square, Type, MoveRight, Undo2, Trash2 } from 'lucide-react'
import * as fabric from 'fabric'
import { uploadImage } from '../lib/upload'

type Tool = 'select' | 'pen' | 'rect' | 'arrow' | 'text'
type UploadState = 'idle' | 'uploading' | 'done' | 'error'

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#000000']

export function Editor({ dataUrl, onClose }: { dataUrl: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const fcRef = useRef<fabric.Canvas | null>(null)
  const drawRef = useRef({ active: false, x0: 0, y0: 0, obj: null as fabric.Object | null })
  // Fit scale of the display canvas (fit size ÷ native size). Export multiplies by its
  // inverse so Copy/Upload produce a full-resolution PNG, not the shrunk display size.
  const scaleRef = useRef(1)
  const [canvasReady, setCanvasReady] = useState(false)

  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState('#ef4444')
  const [sw, setSw] = useState(3)
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [uploadedUrl, setUploadedUrl] = useState('')
  const [errMsg, setErrMsg] = useState('')

  // A new capture can arrive while the editor is already open (global shortcut fires
  // regardless of view) — reset upload state so the toolbar doesn't keep showing the
  // previous image's "Link Copied" state / re-copy its stale URL.
  useEffect(() => {
    setUploadState('idle')
    setUploadedUrl('')
    setErrMsg('')
  }, [dataUrl])

  // Init fabric canvas per dataUrl and keep it fitted to the container.
  //
  // We fit via a ResizeObserver rather than a one-shot measurement at img.onload:
  // the editor image arrives over IPC while the main window is still hidden, so the
  // flex container may not have its final (constrained) size yet. Measuring too early
  // yields an oversized canvas that overflow:auto then clips to a corner. The observer
  // fires again once the window is shown and laid out, and on any later resize.
  useEffect(() => {
    const container = containerRef.current
    const el = canvasElRef.current
    if (!container || !el) return

    let disposed = false
    let currentScale = 0

    const img = new window.Image()

    const fit = (): void => {
      if (disposed || !img.naturalWidth) return
      const cw = container.clientWidth
      const ch = container.clientHeight
      if (cw < 2 || ch < 2) return // not laid out yet — observer will call again

      const pad = 48
      const scale = Math.min(1, (cw - pad) / img.naturalWidth, (ch - pad) / img.naturalHeight)
      if (scale <= 0) return
      scaleRef.current = scale
      const w = Math.max(1, Math.round(img.naturalWidth * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))

      // fabric v7 defaults originX/originY to 'center'. Without an explicit top-left
      // origin, the background image is centered at (0,0), so only its bottom-right
      // quarter lands inside the canvas — the "image stuck in a corner, rest dark" bug.
      const makeBg = (): fabric.Image =>
        new fabric.Image(img, { scaleX: scale, scaleY: scale, originX: 'left', originY: 'top', left: 0, top: 0 })

      const fc = fcRef.current
      if (!fc) {
        const created = new fabric.Canvas(el, { width: w, height: h, selection: false, enableRetinaScaling: false })
        created.backgroundImage = makeBg()
        created.renderAll()
        fcRef.current = created
        currentScale = scale
        setCanvasReady(true)
      } else if (Math.abs(scale - currentScale) > 0.001) {
        // Container resized — refit the background and rescale every annotation by the
        // ratio so they stay aligned (all share the top-left origin).
        const ratio = scale / currentScale
        fc.setDimensions({ width: w, height: h })
        fc.backgroundImage = makeBg()
        fc.getObjects().forEach((o) => {
          o.left = (o.left ?? 0) * ratio
          o.top = (o.top ?? 0) * ratio
          o.scaleX = (o.scaleX ?? 1) * ratio
          o.scaleY = (o.scaleY ?? 1) * ratio
          o.setCoords()
        })
        currentScale = scale
        fc.renderAll()
      }
    }

    img.onload = fit
    img.src = dataUrl

    const ro = new ResizeObserver(() => fit())
    ro.observe(container)

    return () => {
      disposed = true
      ro.disconnect()
      fcRef.current?.dispose()
      fcRef.current = null
      setCanvasReady(false)
    }
  }, [dataUrl])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        const fc = fcRef.current
        if (!fc) return
        const objs = fc.getObjects()
        if (objs.length) { fc.remove(objs[objs.length - 1]); fc.renderAll() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Re-apply tool whenever tool / color / stroke-width changes
  useEffect(() => {
    const fc = fcRef.current
    if (!fc || !canvasReady) return

    // Use the upper canvas element for native events — avoids fabric 7 pointer API
    // differences on Wayland and gives us reliable coordinates
    const el = fc.getElement()

    fc.off('mouse:down')
    fc.off('mouse:move')
    fc.off('mouse:up')
    fc.isDrawingMode = false

    if (tool === 'select') {
      fc.selection = true
      fc.defaultCursor = 'default'
      fc.hoverCursor = 'move'
      fc.forEachObject((o) => { o.selectable = true; o.evented = true })
      return
    }

    fc.selection = false
    fc.defaultCursor = 'crosshair'
    fc.hoverCursor = 'crosshair'
    fc.forEachObject((o) => { o.selectable = false; o.evented = false })

    if (tool === 'pen') {
      fc.isDrawingMode = true
      const brush = new fabric.PencilBrush(fc)
      brush.color = color
      brush.width = sw
      fc.freeDrawingBrush = brush
      return
    }

    // upper canvas is the sibling that actually receives pointer events
    const upper = ((fc as any).upperCanvasEl as HTMLElement | undefined)
      ?? el.nextElementSibling as HTMLElement
      ?? el

    function canvasXY(e: MouseEvent) {
      const r = upper.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const handlers: { [k: string]: EventListener } = {}

    if (tool === 'text') {
      handlers.mousedown = ((e: MouseEvent) => {
        const { x, y } = canvasXY(e)
        const t = new fabric.IText('Text', {
          left: x, top: y,
          fontSize: Math.max(18, sw * 6), fill: color,
          selectable: true, evented: true
        })
        fc.add(t)
        fc.setActiveObject(t)
        t.enterEditing()
        t.selectAll()
        setTool('select')
      }) as EventListener
      upper.addEventListener('mousedown', handlers.mousedown)
    } else {
      // rect + arrow: mousedown on canvas, mousemove/mouseup on window so
      // drags that leave the canvas don't break mid-draw
      handlers.mousedown = ((e: MouseEvent) => {
        const { x, y } = canvasXY(e)
        drawRef.current = { active: true, x0: x, y0: y, obj: null }

        const obj = tool === 'rect'
          ? new fabric.Rect({
              left: x, top: y, width: 1, height: 1,
              originX: 'left', originY: 'top',
              fill: 'transparent', stroke: color, strokeWidth: sw,
              selectable: false, evented: false
            })
          : new fabric.Line([x, y, x, y], {
              stroke: color, strokeWidth: sw, selectable: false, evented: false
            })

        fc.add(obj)
        drawRef.current.obj = obj

        const onMove = (ev: MouseEvent) => {
          const d = drawRef.current
          if (!d.obj) return
          const { x: mx, y: my } = canvasXY(ev)
          if (tool === 'rect') {
            const r = d.obj as fabric.Rect
            r.set({
              left: Math.min(mx, d.x0),
              top: Math.min(my, d.y0),
              width: Math.max(1, Math.abs(mx - d.x0)),
              height: Math.max(1, Math.abs(my - d.y0))
            })
            r.setCoords()
          } else {
            ;(d.obj as fabric.Line).set({ x2: mx, y2: my })
          }
          fc.renderAll()
        }

        const onUp = (ev: MouseEvent) => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          const d = drawRef.current
          if (!d.active) return
          d.active = false

          if (tool === 'arrow' && d.obj) {
            const { x: ux, y: uy } = canvasXY(ev)
            const angle = Math.atan2(uy - d.y0, ux - d.x0) * (180 / Math.PI)
            const sz = Math.max(12, sw * 4)
            fc.add(new fabric.Triangle({
              left: ux, top: uy, width: sz, height: sz,
              fill: color, angle: angle + 90,
              originX: 'center', originY: 'center',
              selectable: false, evented: false
            }))
          }
          d.obj = null
          fc.renderAll()
        }

        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }) as EventListener

      upper.addEventListener('mousedown', handlers.mousedown)
    }

    return () => {
      if (handlers.mousedown) upper.removeEventListener('mousedown', handlers.mousedown)
    }
  }, [canvasReady, tool, color, sw])

  function handleUndo() {
    const fc = fcRef.current
    if (!fc) return
    const objs = fc.getObjects()
    if (objs.length) { fc.remove(objs[objs.length - 1]); fc.renderAll() }
  }

  function handleClear() {
    const fc = fcRef.current
    if (!fc) return
    fc.getObjects().forEach((o) => fc.remove(o))
    fc.renderAll()
  }

  function getOutput(): string {
    // The canvas is scaled down to fit the window; multiply by 1/scale on export so
    // Copy/Upload emit the full-resolution capture (with annotations scaled up crisply),
    // not the shrunk on-screen size.
    const multiplier = scaleRef.current > 0 ? 1 / scaleRef.current : 1
    return fcRef.current?.toDataURL({ format: 'png', multiplier }) ?? dataUrl
  }

  async function handleUpload() {
    setUploadState('uploading')
    try {
      const out = getOutput()
      const filename = `screenshot-${Date.now()}.png`
      const url = await uploadImage(dataUrlToBlob(out), filename)
      setUploadedUrl(url)
      window.api.copyText(url)
      window.api.historyAdd({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        url, filename,
        thumbnail: await resizeThumbnail(out),
        timestamp: Date.now()
      })
      setUploadState('done')
    } catch (e) {
      setErrMsg((e as Error).message)
      setUploadState('error')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={toolbarStyle}>
        <div style={{ display: 'flex', gap: 2 }}>
          <ToolBtn active={tool === 'select'} onClick={() => setTool('select')} title="Select / Move">
            <MousePointer2 size={14} />
          </ToolBtn>
          <ToolBtn active={tool === 'pen'} onClick={() => setTool('pen')} title="Freehand pen">
            <Pencil size={14} />
          </ToolBtn>
          <ToolBtn active={tool === 'rect'} onClick={() => setTool('rect')} title="Rectangle">
            <Square size={14} />
          </ToolBtn>
          <ToolBtn active={tool === 'arrow'} onClick={() => setTool('arrow')} title="Arrow">
            <MoveRight size={14} />
          </ToolBtn>
          <ToolBtn active={tool === 'text'} onClick={() => setTool('text')} title="Text">
            <Type size={14} />
          </ToolBtn>
        </div>

        <div style={sep} />

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 18, height: 18, borderRadius: '50%', background: c,
                border: 'none', cursor: 'pointer',
                outline: color === c ? '2px solid #fff' : '2px solid transparent',
                outlineOffset: 1, flexShrink: 0
              }}
            />
          ))}
        </div>

        <div style={sep} />

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {([2, 4, 7] as const).map((w) => (
            <button
              key={w}
              onClick={() => setSw(w)}
              style={{
                width: 28, height: 28, borderRadius: 4,
                background: sw === w ? '#27272a' : 'transparent',
                border: '1px solid ' + (sw === w ? '#52525b' : 'transparent'),
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <div style={{ width: 12, height: Math.ceil(w / 2), background: '#a1a1aa', borderRadius: 1 }} />
            </button>
          ))}
        </div>

        <div style={sep} />

        <button onClick={handleUndo} title="Undo last" style={iconBtnStyle}>
          <Undo2 size={14} color="#71717a" />
        </button>
        <button onClick={handleClear} title="Clear all annotations" style={iconBtnStyle}>
          <Trash2 size={14} color="#71717a" />
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => window.api.copyImage(getOutput())} style={btn.secondary}>
            Copy Image
          </button>
          {uploadState === 'done' ? (
            <button onClick={() => window.api.copyText(uploadedUrl)} style={{ ...btn.success, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={14} /> Link Copied
            </button>
          ) : (
            <button onClick={handleUpload} disabled={uploadState === 'uploading'} style={btn.primary}>
              {uploadState === 'uploading' ? 'Uploading…' : 'Upload & Copy Link'}
            </button>
          )}
          <button onClick={onClose} style={btn.secondary}>New Capture</button>
        </div>
      </div>

      <div ref={containerRef} style={canvasArea}>
        <canvas ref={canvasElRef} style={{ display: 'block', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', borderRadius: 4 }} />
      </div>

      {uploadState === 'error' && (
        <div style={statusBar('#450a0a', '#7f1d1d', '#fca5a5')}>
          Upload failed: {errMsg}
        </div>
      )}
      {uploadState === 'done' && (
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

function ToolBtn({
  active, onClick, title, children
}: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: active ? '#27272a' : 'transparent',
        border: '1px solid ' + (active ? '#52525b' : 'transparent'),
        color: active ? '#fafafa' : '#71717a',
        borderRadius: 6, padding: '5px 8px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      {children}
    </button>
  )
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png'
  const bytes = atob(b64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

function resizeThumbnail(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => {
      const scale = Math.min(1, 240 / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.7))
    }
    img.src = src
  })
}

const toolbarStyle: React.CSSProperties = {
  padding: '8px 14px', borderBottom: '1px solid #27272a',
  display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0
}
const canvasArea: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24, overflow: 'auto', background: '#09090b'
}
const sep: React.CSSProperties = {
  width: 1, height: 20, background: '#27272a', flexShrink: 0, margin: '0 2px'
}
const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  padding: 5, display: 'flex', alignItems: 'center', borderRadius: 4
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
