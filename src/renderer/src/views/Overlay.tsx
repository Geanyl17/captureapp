import { useEffect, useRef, useState, useCallback } from 'react'

// Region selection over a FROZEN screenshot. The main process captures the screen
// first and hands us the bitmap; we display it full-bleed and let the user draw a
// rectangle on it. Because the selection happens on the exact image we're showing,
// the crop is a single ratio (image natural px ÷ displayed CSS px) — no reconciling
// overlay/logical/physical coordinate systems, which is what put captures in a corner.
export function Overlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const isDragging = useRef(false)
  const [imageSrc, setImageSrc] = useState<string | null>(null)

  useEffect(() => {
    window.api.onSelectionImage((dataUrl) => setImageSrc(dataUrl))
  }, [])

  const draw = useCallback((current: { x: number; y: number } | null) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width
    const H = canvas.height

    // Dim the whole frozen screenshot…
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.fillRect(0, 0, W, H)

    const s = startRef.current
    if (s && current) {
      const x = Math.min(s.x, current.x)
      const y = Math.min(s.y, current.y)
      const w = Math.abs(current.x - s.x)
      const h = Math.abs(current.y - s.y)

      // …and punch a hole so the real screenshot shows through the selection.
      ctx.clearRect(x, y, w, h)

      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
      ctx.setLineDash([])

      // Size label in REAL captured pixels.
      const img = imgRef.current
      const ratio = img && canvas.clientWidth ? img.naturalWidth / canvas.clientWidth : 1
      if (w > 40 && h > 24) {
        const label = `${Math.round(w * ratio)} × ${Math.round(h * ratio)}`
        ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        const lw = ctx.measureText(label).width + 12
        const lh = 20
        const lx = Math.min(x + w - lw - 2, W - lw - 4)
        const ly = Math.min(y + h + 6, H - lh - 4)
        ctx.fillStyle = '#3b82f6'
        ctx.beginPath()
        ctx.roundRect(lx, ly, lw, lh, 3)
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, lx + 6, ly + lh / 2)
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Click and drag to select a region  ·  ESC to cancel', W / 2, H / 2)
      ctx.textAlign = 'left'
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    draw(null)

    function onMouseDown(e: MouseEvent) {
      startRef.current = { x: e.clientX, y: e.clientY }
      isDragging.current = true
    }

    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return
      draw({ x: e.clientX, y: e.clientY })
    }

    function onMouseUp(e: MouseEvent) {
      if (!startRef.current || !isDragging.current) return
      isDragging.current = false
      const s = startRef.current
      startRef.current = null
      const x = Math.min(s.x, e.clientX)
      const y = Math.min(s.y, e.clientY)
      const w = Math.abs(e.clientX - s.x)
      const h = Math.abs(e.clientY - s.y)
      if (w < 5 || h < 5) {
        draw(null)
        return
      }
      cropAndSend(x, y, w, h)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') window.api.captureCancel()
    }

    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [draw])

  // Crop the frozen screenshot to the selected CSS rect, scaling into the image's
  // native (physical) pixels, and hand the finished PNG back to the main process.
  function cropAndSend(x: number, y: number, w: number, h: number): void {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !img.naturalWidth || !canvas) {
      window.api.captureCancel()
      return
    }
    const ratioX = img.naturalWidth / canvas.clientWidth
    const ratioY = img.naturalHeight / canvas.clientHeight
    const sx = Math.round(x * ratioX)
    const sy = Math.round(y * ratioY)
    const sw = Math.round(w * ratioX)
    const sh = Math.round(h * ratioY)

    const out = document.createElement('canvas')
    out.width = sw
    out.height = sh
    out.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    window.api.cropDone(out.toDataURL('image/png'))
  }

  return (
    <>
      {imageSrc && (
        <img
          ref={imgRef}
          src={imageSrc}
          alt=""
          draggable={false}
          onLoad={() => draw(null)}
          style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
        />
      )}
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: 'crosshair', position: 'fixed', inset: 0 }}
      />
    </>
  )
}
