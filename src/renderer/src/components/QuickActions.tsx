import { useState } from 'react'

export interface QuickAction {
  label: string
  needsAmount: boolean
  prompt(pin: number, amount: number): string
}

const ACTIONS: QuickAction[] = [
  { label: 'Thicker', needsAmount: true, prompt: (pin, amount) => `Make the part thicker at pin ${pin} by ${amount} mm.` },
  { label: 'Thinner', needsAmount: true, prompt: (pin, amount) => `Make the part thinner at pin ${pin} by ${amount} mm.` },
  { label: 'Longer', needsAmount: true, prompt: (pin, amount) => `Make the feature at pin ${pin} ${amount} mm longer.` },
  { label: 'Shorter', needsAmount: true, prompt: (pin, amount) => `Make the feature at pin ${pin} ${amount} mm shorter.` },
  { label: 'Wider', needsAmount: true, prompt: (pin, amount) => `Make the feature at pin ${pin} ${amount} mm wider.` },
  { label: 'Add hole', needsAmount: true, prompt: (pin, amount) => `Add a ${amount} mm hole straight through the part at pin ${pin}.` },
  { label: 'Round edges', needsAmount: true, prompt: (pin, amount) => `Round the edges near pin ${pin} with a ${amount} mm radius.` },
  { label: 'Remove this', needsAmount: false, prompt: (pin) => `Remove the feature at pin ${pin}.` },
  { label: 'Make stronger', needsAmount: false, prompt: (pin) => `Make the part stronger around pin ${pin} so it does not break there.` }
]

interface Props {
  pin: number
  x: number
  y: number
  onAction(prompt: string): void
  onDescribe(): void
  onCancel(): void
}

export function QuickActions({ pin, x, y, onAction, onDescribe, onCancel }: Props) {
  const [amount, setAmount] = useState(2)
  return (
    <div className="quick-actions" style={{ left: x, top: y }} onPointerDown={(event) => event.stopPropagation()}>
      <div className="quick-header">
        <span className="pin-badge">{pin}</span>
        <span>Change this spot</span>
        <label className="quick-amount" title="Amount used by the buttons">
          by
          <input type="number" min={0.1} step={0.5} value={amount} onChange={(event) => setAmount(Number(event.target.value) || 0)} />
          mm
        </label>
        <button className="close" onClick={onCancel} title="Remove this pin">
          ✕
        </button>
      </div>
      <div className="quick-grid">
        {ACTIONS.map((action) => (
          <button key={action.label} onClick={() => onAction(action.prompt(pin, amount))}>
            {action.label}
          </button>
        ))}
      </div>
      <button className="quick-describe" onClick={onDescribe}>
        Something else… describe it
      </button>
    </div>
  )
}
