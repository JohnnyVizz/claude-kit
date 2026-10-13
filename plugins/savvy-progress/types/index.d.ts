export type Phase = 'plan' | 'design' | 'delegate' | 'review' | 'close'

/** A step the orchestrator works through itself, without a subagent. */
export type StepStatus = 'pending' | 'active' | 'done'

export type PlannedTask = {
  title: string
  tier: string
  after: number[]
  /** Set on steps the orchestrator does itself; such steps are never matched to runs. */
  status?: StepStatus
  /** One sentence: what the step does, or what it did once done. */
  summary?: string
  /** The crab costume a step wears in the panel: one of the `AVATARS` names. Picked from the title when left out. */
  avatar?: string
  /** When the step last became active, in `$.clock.now()` milliseconds. */
  activeSince?: number
}

export type BackgroundStatus = 'running' | 'completed' | 'failed' | 'killed'

/** A shell command running in the background, followed through its output file. */
export type BackgroundTask = {
  id: string
  label: string
  outputFile?: string
  status: BackgroundStatus
  startedAt: number
  endedAt?: number
  /** Size of the output file when last read, to skip rereading an unchanged file. */
  outputBytes: number
  lastOutputAt?: number
  lastLine?: string
  /** 0 to 1, when the output reports `n/m`, `n of m` or a percentage. */
  progress?: number
}

export type Flow = {
  title: string
  total: number
  done: number
  running: number
  phase: Phase
  isFinished: boolean
  tasks: PlannedTask[]
  startedAt: number
  endedAt?: number
}

export type LimitWindow = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

/** The session's own figures, pushed by `session.measure`. */
export type SessionFigures = {
  rateLimits: LimitWindow[]
  costUsd?: number
  contextPercent?: number
}

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  contextTokens: number
  contextMax: number
  tokens: number
  costUsd: number
  steps: number
  round: number
  /** Self-reported by the worker through the `step` tool. */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
}

export type Panel = {
  isCompact: boolean
  isDoneCollapsed: boolean
  autoOpenedFor: string
}

declare module 'claude-code' {
  interface PluginState {
    'savvy-progress': {
      flow: Flow | null
      agents: AgentRun[]
      panel: Panel
      now: number
      usage: SessionFigures
      background: BackgroundTask[]
    }
  }
}
