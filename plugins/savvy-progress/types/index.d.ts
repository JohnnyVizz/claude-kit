export type Phase = 'plan' | 'design' | 'delegate' | 'review' | 'close'

export type PlannedTask = {
  title: string
  tier: string
  after: number[]
}

export type Flow = {
  title: string
  total: number
  done: number
  running: number
  phase: Phase
  isFinished: boolean
  tasks: PlannedTask[]
}

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  cli?: 'codex' | 'gemini'
  parentId?: string
  logPath?: string
  outPath?: string
  logOffset?: number
  /** Scan position within a line longer than a single read. */
  logScanOffset?: number
  logMarker?: 'exec' | 'codex' | 'tokens used'
  logCarry?: string
  logHeaderDone?: boolean
  logPending?: boolean
  tokensReported?: boolean
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

export type Live = {
  isWorking: boolean
  /** The main loop is running the `codex` CLI right now. */
  isCodex: boolean
  cliId?: string
  doing: string
}

declare module 'claude-code' {
  interface PluginState {
    'savvy-progress': {
      flow: Flow | null
      agents: AgentRun[]
      panel: Panel
      now: number
      live: Live
    }
  }
}
