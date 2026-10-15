import { useEffect, useState } from 'react'
import type { ChatMessage } from '@shared/types'

export interface AiActivityState {
  busy: boolean
  step: string
  steps: number
  elapsed: number
}

export function useAiActivity(messages: ChatMessage[], busy: boolean): AiActivityState {
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!busy) {
      setStartedAt(null)
      return
    }
    setStartedAt(Date.now())
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [busy])

  const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user')
  const toolMessages = messages.slice(lastUserIndex + 1).filter((message) => message.role === 'tool')
  const latestTool = toolMessages[toolMessages.length - 1]

  return {
    busy,
    step: latestTool?.text ?? 'Thinking about your request',
    steps: toolMessages.length,
    elapsed: startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  }
}

const formatElapsed = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

function Spinner() {
  return (
    <span className="ai-spinner" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  )
}

export function AiStatusCard({ activity }: { activity: AiActivityState }) {
  return (
    <div className="ai-status-card">
      <div className="ai-status-head">
        <Spinner />
        <span className="ai-status-title">Designing</span>
        <span className="ai-status-time">{formatElapsed(activity.elapsed)}</span>
      </div>
      <div className="ai-status-step" key={activity.step}>
        {activity.step}
      </div>
      <div className="ai-status-foot">
        <div className="ai-progress" />
        <span>{activity.steps === 0 ? 'Starting' : `${activity.steps} step${activity.steps === 1 ? '' : 's'}`}</span>
      </div>
    </div>
  )
}

export function AiViewerOverlay({ activity, hasModel }: { activity: AiActivityState; hasModel: boolean }) {
  return (
    <>
      <div className="ai-viewer-glow" />
      <div className="ai-viewer-pill">
        <Spinner />
        <span className="ai-viewer-step" key={activity.step}>
          {activity.step}
        </span>
        <span className="ai-status-time">{formatElapsed(activity.elapsed)}</span>
      </div>
      {!hasModel && (
        <div className="ai-building">
          <div className="ai-building-stack">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="ai-building-title">Designing your part</div>
          <div className="muted">The model will appear here as soon as the first version renders.</div>
        </div>
      )}
    </>
  )
}
