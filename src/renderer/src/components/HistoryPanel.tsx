import type { HistoryEntry } from '@shared/types'

interface Props {
  history: HistoryEntry[]
  onRestore(id: string): void
}

const SOURCE_LABELS: Record<HistoryEntry['source'], string> = {
  save: 'Saved',
  ai: 'AI',
  import: 'Import',
  restore: 'Restore',
  bake: 'Bake'
}

export function HistoryPanel({ history, onRestore }: Props) {
  if (!history.length) return <p className="empty">No saved versions yet. Every save and every AI change is kept here.</p>
  return (
    <div className="history-panel">
      {[...history].reverse().map((entry, index) => (
        <div key={entry.id} className="history-entry">
          <div>
            <span className={`tag ${entry.source}`}>{SOURCE_LABELS[entry.source]}</span>
            <span className="history-label">{entry.label}</span>
            <div className="history-time">{new Date(entry.createdAt).toLocaleString()}</div>
          </div>
          {index > 0 && <button onClick={() => onRestore(entry.id)}>Restore</button>}
        </div>
      ))}
    </div>
  )
}
