import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuEntry =
  | { kind: 'item'; label: string; hint?: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect(): void }
  | { kind: 'submenu'; label: string; icon?: ReactNode; disabled?: boolean; entries?: MenuEntry[]; content?: ReactNode }
  | { kind: 'separator' }
  | { kind: 'header'; label: ReactNode }

interface Props {
  x: number
  y: number
  entries: MenuEntry[]
  onClose(): void
}

function MenuList({ entries, onClose }: { entries: MenuEntry[]; onClose(): void }) {
  return (
    <>
      {entries.map((entry, index) => {
        if (entry.kind === 'separator') return <div key={index} className="ctx-separator" />
        if (entry.kind === 'header') return <div key={index} className="ctx-header">{entry.label}</div>
        if (entry.kind === 'item') {
          return (
            <button
              key={index}
              className={`ctx-item${entry.danger ? ' danger' : ''}`}
              disabled={entry.disabled}
              onClick={() => {
                onClose()
                entry.onSelect()
              }}
            >
              <span className="ctx-icon">{entry.icon}</span>
              <span className="ctx-label">{entry.label}</span>
              {entry.hint && <span className="ctx-hint">{entry.hint}</span>}
            </button>
          )
        }
        return <Submenu key={index} entry={entry} onClose={onClose} />
      })}
    </>
  )
}

function Submenu({ entry, onClose }: { entry: Extract<MenuEntry, { kind: 'submenu' }>; onClose(): void }) {
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState(false)
  const row = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !panel.current || !row.current) return
    const bounds = panel.current.getBoundingClientRect()
    setFlip(bounds.right > window.innerWidth - 8)
    const overflow = bounds.bottom - (window.innerHeight - 8)
    panel.current.style.top = overflow > 0 ? `${-overflow - 4}px` : '-4px'
  }, [open])

  return (
    <div ref={row} className={`ctx-item ctx-has-sub${entry.disabled ? ' disabled' : ''}`} onMouseEnter={() => !entry.disabled && setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className="ctx-icon">{entry.icon}</span>
      <span className="ctx-label">{entry.label}</span>
      <span className="ctx-arrow">▸</span>
      {open && (
        <div ref={panel} className={`ctx-menu ctx-sub${flip ? ' flip' : ''}`}>
          {entry.content}
          {entry.entries && <MenuList entries={entry.entries} onClose={onClose} />}
        </div>
      )}
    </div>
  )
}

export function ContextMenu({ x, y, entries, onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const element = menu.current
    const parent = element?.offsetParent as HTMLElement | null
    if (!element || !parent) return
    const width = element.offsetWidth
    const height = element.offsetHeight
    setPosition({
      left: Math.max(4, Math.min(x, parent.clientWidth - width - 4)),
      top: Math.max(4, Math.min(y, parent.clientHeight - height - 4))
    })
  }, [x, y])

  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      if (!menu.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div ref={menu} className="ctx-menu" style={position} onContextMenu={(event) => event.preventDefault()}>
      <MenuList entries={entries} onClose={onClose} />
    </div>
  )
}

export const FILAMENT_COLORS: { name: string; hex: string }[] = [
  { name: 'White', hex: '#f5f5f5' },
  { name: 'Black', hex: '#1a1a1a' },
  { name: 'Grey', hex: '#8a8d91' },
  { name: 'Silver', hex: '#c0c4c8' },
  { name: 'Red', hex: '#d32f2f' },
  { name: 'Orange', hex: '#f57c00' },
  { name: 'Yellow', hex: '#fbc02d' },
  { name: 'Gold', hex: '#c9a227' },
  { name: 'Lime', hex: '#8bc34a' },
  { name: 'Green', hex: '#2e7d32' },
  { name: 'Teal', hex: '#00897b' },
  { name: 'Cyan', hex: '#00acc1' },
  { name: 'Blue', hex: '#1565c0' },
  { name: 'Navy', hex: '#1a237e' },
  { name: 'Purple', hex: '#6a1b9a' },
  { name: 'Pink', hex: '#ec407a' },
  { name: 'Brown', hex: '#6d4c41' },
  { name: 'Beige', hex: '#d7c4a3' }
]

export function ColorPalette({ current, onPick, onClear, clearLabel }: { current?: string | null; onPick(hex: string): void; onClear?(): void; clearLabel?: string }) {
  const [custom, setCustom] = useState(current && /^#[0-9a-f]{6}$/i.test(current) ? current : '#ff8800')
  return (
    <div className="ctx-palette" onClick={(event) => event.stopPropagation()}>
      <div className="ctx-swatches">
        {FILAMENT_COLORS.map((color) => (
          <button
            key={color.hex}
            title={color.name}
            className={`ctx-swatch${current?.toLowerCase() === color.hex ? ' active' : ''}`}
            style={{ background: color.hex }}
            onClick={() => onPick(color.hex)}
          />
        ))}
      </div>
      <div className="ctx-custom">
        <input type="color" value={custom} onChange={(event) => setCustom(event.target.value)} />
        <button onClick={() => onPick(custom)}>Use this colour</button>
      </div>
      {onClear && (
        <button className="ctx-item" onClick={onClear}>
          <span className="ctx-icon">⦸</span>
          <span className="ctx-label">{clearLabel ?? 'No colour'}</span>
        </button>
      )}
    </div>
  )
}
