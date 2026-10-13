import type { AgentRun, Flow, Phase, PlannedTask, StepStatus } from '../types'
import { MAX_AFTER, MAX_SUMMARY, MAX_TASKS, MAX_TITLE, PHASES, STEP_STATUSES, TIERS } from './constants'
import { tr } from './i18n'
import { clip, norm } from './text'
import { AVATAR_NAMES } from './crabs'

export type ProgressInput = {
  title?: string
  total?: number
  done?: number
  phase?: Phase
  finished?: boolean
  tasks?: { title?: string; tier?: string; after?: number[]; status?: string; summary?: string; avatar?: string }[]
}

export const blank = (): Flow => ({
  title: 'savvy-flow',
  total: 0,
  done: 0,
  running: 0,
  phase: 'plan',
  isFinished: false,
  tasks: [],
  startedAt: 0,
})

export const isNewFlow = (prev: Flow | null, input: ProgressInput): boolean =>
  !prev || prev.isFinished || (input.title !== undefined && clip(input.title.trim(), MAX_TITLE) !== prev.title)

// Only a known tier is kept: the name is later a key into the tier tables.
export const tierName = (v: string): string => {
  const t = v.replace(/^savvy-/, '').trim().toLowerCase()
  return TIERS.includes(t) ? t : ''
}

export const cleanTasks = (tasks: ProgressInput['tasks']): PlannedTask[] | undefined =>
  tasks
    ?.filter(t => t.title?.trim())
    .slice(0, MAX_TASKS)
    .map(t => ({
      title: (t.title ?? '').trim(),
      tier: tierName(t.tier ?? ''),
      after: (t.after ?? []).filter(n => Number.isInteger(n) && n > 0).slice(0, MAX_AFTER),
      ...(STEP_STATUSES.includes(t.status as StepStatus) ? { status: t.status as StepStatus } : {}),
      ...(t.summary?.trim() ? { summary: clip(t.summary.trim(), MAX_SUMMARY) } : {}),
      ...(AVATAR_NAMES.includes(t.avatar?.trim().toLowerCase() ?? '') ? { avatar: t.avatar?.trim().toLowerCase() } : {}),
    }))

// Steps the orchestrator works through itself carry a status; worker tasks do not.
export const stepsOf = (f: Flow | null): (PlannedTask & { n: number })[] =>
  (f?.tasks ?? []).map((t, i) => ({ ...t, n: i + 1 })).filter(t => t.status)

export const activeSteps = (f: Flow): number => f.tasks.filter(t => t.status === 'active').length

// The session's running figures, read when a step starts and when it finishes.
export type Figures = { cost?: number; ctx?: number }

export const TIMING_KEYS = ['activeSince', 'endedAt', 'costFrom', 'costTo', 'ctxFrom', 'ctxTo'] as const
export const untimed = (t: PlannedTask): PlannedTask => {
  const out = { ...t }
  for (const k of TIMING_KEYS) delete out[k]
  return out
}

// A step's clock and figures, carried from what the flow held before: set when
// it becomes active, closed when it turns done, kept while it stays either.
// The files a step touched ride along whatever the model resends.
export const settle = (t: PlannedTask, was: PlannedTask | undefined, at: number, fig: Figures): PlannedTask => {
  const timed = settleTiming(t, was, at, fig)
  return was?.files ? { ...timed, files: was.files } : timed
}

export const settleTiming = (t: PlannedTask, was: PlannedTask | undefined, at: number, fig: Figures): PlannedTask => {
  const bare = untimed(t)
  if (t.status === 'active') {
    if (was?.status === 'active') return { ...bare, activeSince: was.activeSince ?? at, costFrom: was.costFrom, ctxFrom: was.ctxFrom }
    return { ...bare, activeSince: at, costFrom: fig.cost, ctxFrom: fig.ctx }
  }
  if (t.status === 'done' && was?.status === 'active') {
    return { ...bare, activeSince: was.activeSince, endedAt: at, costFrom: was.costFrom, ctxFrom: was.ctxFrom, costTo: fig.cost, ctxTo: fig.ctx }
  }
  if (t.status === 'done' && was?.status === 'done') {
    return { ...bare, ...Object.fromEntries(TIMING_KEYS.map(k => [k, was[k]]).filter(([, v]) => v !== undefined)) }
  }
  return bare
}

export const merge = (prev: Flow | null, input: ProgressInput, at: number, fig: Figures = {}): Flow => {
  // A new title means a new flow: never carry counters over from an earlier one.
  const isNew = isNewFlow(prev, input) || !prev
  const base = isNew ? { ...blank(), startedAt: at } : { ...blank(), ...prev }
  const before = new Map(base.tasks.map(t => [norm(t.title), t]))
  const incoming = cleanTasks(input.tasks) ?? base.tasks
  // Closing the flow completes every step still open.
  const closed = input.finished ? incoming.map(t => (t.status ? { ...t, status: 'done' as const } : t)) : incoming
  const tasks = closed.map(t => settle(t, before.get(norm(t.title)), at, fig))
  const total = Math.min(MAX_TASKS, Math.max(0, Math.round(input.total ?? (input.tasks ? tasks.length : base.total))))
  const stepsDone = tasks.some(t => t.status) ? tasks.filter(t => t.status === 'done').length : undefined
  const done = Math.min(total || Infinity, Math.max(0, Math.round(input.done ?? stepsDone ?? base.done)))
  const phase = input.phase && PHASES.includes(input.phase) ? input.phase : base.phase
  return {
    ...base,
    title: clip(input.title?.trim() || base.title, MAX_TITLE),
    total,
    done,
    phase: input.finished ? 'close' : phase,
    isFinished: input.finished === true,
    tasks,
    endedAt: input.finished ? at : undefined,
  }
}

export const label = (f: Flow): string => {
  const s = tr()
  if (f.isFinished) return s.done
  if (f.phase === 'plan') return s.plan
  if (f.phase === 'design') return s.design
  const count = f.total ? `${f.done}/${f.total}` : `${f.running} ${s.busy}`
  return `${f.phase === 'review' ? s.review : s.tasks} ${count}`
}

export const ratio = (f: Flow): number => (f.isFinished ? 1 : f.total ? f.done / f.total : 0)

export type Planned = PlannedTask & { n: number }

export const plannedOf = (f: Flow | null, list: AgentRun[]): Planned[] => {
  if (!f || f.isFinished) return []
  const started = new Set(list.map(a => norm(a.description)))
  return (f.tasks ?? []).map((t, i) => ({ ...t, n: i + 1 })).filter(t => !t.status && !started.has(norm(t.title)))
}
