import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

export interface DrawingLayerHandle {
  hasStrokes(): boolean
  undo(): void
  clear(): void
  composite(baseDataUrl: string): Promise<string>
}

interface Stroke {
  color: string
  width: number
  points: { x: number; y: number }[]
}

const COLORS = ['#ff3b30', '#ffd60a', '#30d158', '#0a84ff', '#ffffff']

export const DrawingLayer = forwardRef<DrawingLayerHandle, { active: boolean }>(function DrawingLayer({ active }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Stroke[]>([])
  const current = useRef<Stroke | null>(null)
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(4)
  const [, setVersion] = useState(0)

  const redraw = (): void => {
    const element = canvas.current
    if (!element) return
    const context = element.getContext('2d')!
    context.clearRect(0, 0, element.width, element.height)
    const scale = window.devicePixelRatio
    for (const stroke of [...strokes.current, ...(current.current ? [current.current] : [])]) {
      if (!stroke.points.length) continue
      context.strokeStyle = stroke.color
      context.lineWidth = stroke.width * scale
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.beginPath()
      stroke.points.forEach((point, index) => {
        const x = point.x * element.width
        const y = point.y * element.height
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      if (stroke.points.length === 1) context.lineTo(stroke.points[0].x * element.width + 0.1, stroke.points[0].y * element.height)
      context.stroke()
    }
  }

  useEffect(() => {
    const element = canvas.current!
    const observer = new ResizeObserver(() => {
      element.width = element.clientWidth * window.devicePixelRatio
      element.height = element.clientHeight * window.devicePixelRatio
      redraw()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useImperativeHandle(ref, () => ({
    hasStrokes: () => strokes.current.length > 0,
    undo: () => {
      strokes.current.pop()
      redraw()
      setVersion((value) => value + 1)
    },
    clear: () => {
      strokes.current = []
      redraw()
      setVersion((value) => value + 1)
    },
    composite: (baseDataUrl) =>
      new Promise((resolve) => {
        const image = new Image()
        image.onload = () => {
          const output = document.createElement('canvas')
          output.width = image.width
          output.height = image.height
          const context = output.getContext('2d')!
          context.drawImage(image, 0, 0)
          context.drawImage(canvas.current!, 0, 0, output.width, output.height)
          resolve(output.toDataURL('image/png'))
        }
        image.src = baseDataUrl
      })
  }))

  const position = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = canvas.current!.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
  }

  return (
    <>
      <canvas
        ref={canvas}
        className="drawing-layer"
        style={{ pointerEvents: active ? 'auto' : 'none', cursor: active ? 'crosshair' : 'default' }}
        onPointerDown={(event) => {
          if (!active) return
          canvas.current!.setPointerCapture(event.pointerId)
          current.current = { color, width, points: [position(event)] }
          redraw()
        }}
        onPointerMove={(event) => {
          if (!current.current) return
          current.current.points.push(position(event))
          redraw()
        }}
        onPointerUp={() => {
          if (!current.current) return
          strokes.current.push(current.current)
          current.current = null
          redraw()
          setVersion((value) => value + 1)
        }}
      />
      {active && (
        <div className="drawing-palette">
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              className={`swatch ${swatch === color ? 'active' : ''}`}
              style={{ background: swatch }}
              onClick={() => setColor(swatch)}
              title="Pen colour"
            />
          ))}
          <input type="range" min={2} max={14} value={width} onChange={(event) => setWidth(Number(event.target.value))} title="Pen size" />
        </div>
      )}
    </>
  )
})
