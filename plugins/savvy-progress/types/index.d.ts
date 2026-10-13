export type Phase = 'plan' | 'design' | 'delegate' | 'review' | 'close'

/** A step the orchestrator works through itself, without a subagent. */
export type StepStatus = 'pending' | 'active' | 'done'

/** A file a step read or changed. */
export type StepFile = {
  path: string
  reads: number
  edits: number
  /** The file did not exist before the step first changed it. */
  isNew?: boolean
  /** From the step's diff, once one was made. */
  added?: number
  removed?: number
  /** Unified diff of what the step changed, made when the step finished (or on demand while it runs). */
  diff?: string
}

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
  /** When an active step was marked done. */
  endedAt?: number
  /** The session's cost (USD) and context fill (%) when the step became active, and when it finished. */
  costFrom?: number
  costTo?: number
  ctxFrom?: number
  ctxTo?: number
  /** Files the step read or changed, in the order it first touched them. */
  files?: StepFile[]
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
  /** A toast has said how it ended. */
  isAnnounced?: boolean
  /** A toast has said it went quiet; cleared when output comes again. */
  isSilenceAnnounced?: boolean
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
  /** Steps opened to their files, by normalised title. */
  expandedSteps?: string[]
  /** The diff shown, as `<step key>|<path>`. */
  diffOpen?: string
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
      /** Each file's text before a step first changed it, by `<step key>|<path>`; null when it did not exist. */
      snapshots: Record<string, string | null>
    }
  }
}
