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
  /** When the flow's first worker started; the time-left estimate counts from it. */
  startedAt?: number
  /** Drawn from the running subagents when nothing reports a flow; never stored. */
  isAuto?: boolean
  /** Tasks' worth of steps the running workers have reported, added at draw time; never stored. */
  partial?: number
  /** When the flow last reported a task accepted; its time left counts down from there. */
  progressAt?: number
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
  /** The last time the run showed a sign of life (a model request, a step report); its end when that never reached the mod. */
  seenAt?: number
  /** When the run last reported a step done; its time left counts down from there. */
  stepAt?: number
}

export type Panel = {
  isCompact: boolean
  isDoneCollapsed: boolean
  autoOpenedFor: string
}

/** The main session's own turn, for the bar when no subagent runs: live while it works, ready between turns. */
export type MainWork = {
  isWorking: boolean
  startedAt: number
  toolCalls: number
  lastTool?: string
  /** The kind of work the last tool call was, for the crab's costume. */
  work?: string
  /** When the last turn ended; unset before the first, and while one runs. */
  endedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'savvy-progress': {
      flow: Flow | null
      agents: AgentRun[]
      panel: Panel
      now: number
      main: MainWork
      /** The track's look picked with /bar-style ('' when none was), loaded from the store at start. */
      barStyle: string
    }
  }
}
