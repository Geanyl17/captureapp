import { useEffect, useRef, useCallback } from 'react'

export function Overlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const isDragging = useRef(false)

  const draw = useCallback((current: { x: number; y: number } | null) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width
    const H = canvas.height

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.fillRect(0, 0, W, H)

    const s = startRef.current
    if (s && current) {
      const x = Math.min(s.x, current.x)
      const y = Math.min(s.y, current.y)
      const w = Math.abs(current.x - s.x)
      const h = Math.abs(current.y - s.y)

      // Punch clear rectangle for selected region
      ctx.clearRect(x, y, w, h)

      // Selection border
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
      ctx.setLineDash([])

      // Size label
      if (w > 40 && h > 24) {
        const label = `${w} × ${h}`
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
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Click and drag to select a region  ·  ESC to cancel', W / 2, H / 2)
      ctx.textAlign = 'left'
    }
  }, [])

  useEffect(() => {
    // Overlay window must be fully transparent so the desktop shows through
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'

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
      const x = Math.min(s.x, e.clientX)
      const y = Math.min(s.y, e.clientY)
      const w = Math.abs(e.clientX - s.x)
      const h = Math.abs(e.clientY - s.y)
      startRef.current = null
      if (w < 5 || h < 5) {
        draw(null)
        return
      }
      window.api.captureRegion({ x, y, width: w, height: h })
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

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', cursor: 'crosshair', position: 'fixed', inset: 0 }}
    />
  )
}
