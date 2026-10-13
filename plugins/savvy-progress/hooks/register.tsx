// savvy-progress: a progress bar above the prompt and a live agents panel.
//
// This entry holds what the engine reads statically and so must sit in one
// file: every hook, every function that takes `$`, the state atoms and the
// hook matchers. Pure code lives beside it, one file per part:
//   flow.ts       the flow and its steps: merging progress reports, timing, cost
//   crabs.ts      the pixel crabs: costumes, step avatars, moods
//   bar.ts        the bar above the prompt, drawn as one SVG
//   panel-svg.ts  the panel's desktop rows, its dotted grid, right-to-left placing
//   background.ts reading background commands' output, their notices
//   files.ts      the files each step touched: bookkeeping and diff trimming
//   models.ts     savvy tiers, model names, prices and run totals
//   text.ts       measuring, fitting and formatting text
//   i18n.ts       the panel's words in English, Russian and Hebrew
//   constants.ts  colours, phases, statuses and input bounds shared by the above

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { AgentRun, BackgroundStatus, BackgroundTask, LimitWindow, Panel, PlannedTask, SessionFigures, StepFile } from '../types'
import { ACCENT, DONE, PHASES, STEP_STATUSES, TIERS } from './constants'
import { isRtl, langOf, setLang, tierWord, tr } from './i18n'
import type { Lang } from './i18n'
import { clip, fmtCost, fmtTime, fmtTokens, norm } from './text'
import { TIER_COLOR, colorOf, costOf, ctxOf, elapsed, modelName, progressOf, runModel, tierModel, tierOf, totals, windowOf } from './models'
import { AVATAR_NAMES, CLAY } from './crabs'
import { activeSteps, blank, isNewFlow, label, merge, plannedOf, ratio, stepsOf } from './flow'
import type { Figures, Planned, ProgressInput } from './flow'
import { H, barCostume, barMood, barText, rowSvg } from './bar'
import { DIFF_LINE_H, LINE_H, STATUS_GLYPH, agentSvg, bgHeight, bgSvg, compactSvg, ctxBar, fmtResets, gridSvg, gridTiles, headerHeight, headerSvg, limitColor, limitName, limitsOf, plannedSvg, stepColor, stepHeight, stepLabel, stepSpend, stepSvg, tilesAlt, tilesOf } from './panel-svg'
import { BG_ID, BG_READ_MAX, bgDetail, bgElapsed, bgMark, bgShown, bgStatusLabel, bgStatusLine, bgToast, endOf, isSilent, outputLines, progressIn } from './background'
import { FILE_TOOLS, SNAPSHOT_MAX, TOO_BIG, cutDiff, fileKey, fileStats, filesHint, pathOf, setCwd, setHome, shortPath, stepKey, touch } from './files'
import type { FileTool } from './files'

// The mod's state. The engine reads which values a module uses from these
// declarations, so they live here, beside every read and update of them.
const flow = atom({ plugin: 'savvy-progress', key: 'flow' } as const, null)
const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, [])
const panel = atom({ plugin: 'savvy-progress', key: 'panel' } as const, {
  isCompact: false,
  isDoneCollapsed: false,
  autoOpenedFor: '',
})
const now = atom({ plugin: 'savvy-progress', key: 'now' } as const, 0)
const usage = atom({ plugin: 'savvy-progress', key: 'usage' } as const, { rateLimits: [] } as SessionFigures)
const bgCommands = atom({ plugin: 'savvy-progress', key: 'background' } as const, [] as BackgroundTask[])
const snapshots = atom({ plugin: 'savvy-progress', key: 'snapshots' } as const, {} as Record<string, string | null>)

// Literal here, not imported: the engine reads hook matchers from this file.
const TOOL = 'mcp__savvy-progress__progress'
const STEP_TOOL = 'mcp__savvy-progress__step'
// Added to the end of each savvy worker's brief. Their system prompt words step
// reporting as a condition ("if the step tool appears among your tools") and they
// skip it even with the tool listed; the same request in the brief is followed.
const STEP_BRIEF = `

Progress reporting: before any other work, call \`${STEP_TOOL}\` with \`total\` (your plan in 3-8 steps) and \`done: 0\`; call it again with \`done\` and a few-word \`note\` as each step finishes. It only draws a progress bar.`
const PANE = 'savvy-agents'

async function detectLang($: EngineInterface, option: unknown): Promise<Lang> {
  if (option === 'en' || option === 'ru' || option === 'he') return option
  try {
    const settings = (await $.settings.read()) as Record<string, unknown>
    if (typeof settings.language === 'string' && settings.language.trim()) return langOf(settings.language)
  } catch {
    // No settings: fall through to the locale.
  }
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
  return langOf(locale)
}

// Opens the agents pane, or closes it when it is up; true when it ends up open.
async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  const at = await $.clock.now()
  await update($, now, () => at)
  await $.ui.open({ id: PANE, title: tr().pane })
  return true
}

async function storeUsage(
  $: EngineInterface,
  u: { rateLimits: LimitWindow[]; cost?: { usd: number }; context: { percent?: number } },
): Promise<void> {
  await update($, usage, () => ({
    rateLimits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    costUsd: u.cost?.usd,
    contextPercent: u.context.percent,
  }))
}

// Reads what the running background commands printed since the last look: the
// last line and any progress figure. `only` limits it to one command.
async function followOutput($: EngineInterface, at: number, only?: string): Promise<void> {
  const list = await read($, bgCommands)
  for (const b of list) {
    if (b.status !== 'running' || !b.outputFile || (only && b.id !== only)) continue
    // A row that already read its end line (before this check existed) ends now.
    const seenEnd = endOf(b.lastLine ?? '')
    if (seenEnd) {
      await update($, bgCommands, all =>
        all.map(x => (x.id === b.id ? { ...x, status: seenEnd, endedAt: x.lastOutputAt ?? at } : x)),
      )
      continue
    }
    try {
      const { size, mtimeMs } = await $.fs.stat(b.outputFile)
      if (size === b.outputBytes) continue
      // Past the read limit the size still proves it is alive; the text stays as it was.
      const text = size <= BG_READ_MAX ? await $.fs.read(b.outputFile) : undefined
      const lines = text === undefined ? [] : outputLines(text)
      // The engine closes the file with `[exited with code N]` or `[killed]`: the
      // command is over whether or not its notification ever reaches a hook.
      const ended = endOf(lines[lines.length - 1] ?? '')
      const shown = ended ? lines.slice(0, -1) : lines
      const line = shown[shown.length - 1] || b.lastLine
      const progress = text === undefined ? b.progress : (progressIn(shown.join('\n')) ?? b.progress)
      const endedAt = mtimeMs > b.startedAt ? Math.min(at, mtimeMs) : at
      await update($, bgCommands, all =>
        all.map(x =>
          x.id === b.id
            ? { ...x, outputBytes: size, lastOutputAt: at, lastLine: line, progress, isSilenceAnnounced: false, ...(ended ? { status: ended, endedAt } : {}) }
            : x,
        ),
      )
    } catch {
      // Not written yet: try again next tick. Gone a minute in (cleaned up, or its
      // session ended): the command is not running any more.
      if (at - b.startedAt > 60_000 && !(await $.fs.exists(b.outputFile).catch(() => false))) {
        await update($, bgCommands, all => all.map(x => (x.id === b.id ? { ...x, status: 'killed' as const, endedAt: at } : x)))
      }
    }
  }
}

// Tells the person once when a background command ends, and once each time it
// goes quiet, so it is seen without the panel open.
async function announceBackground($: EngineInterface, at: number): Promise<void> {
  const list = await read($, bgCommands)
  const ended = list.filter(b => b.status !== 'running' && !b.isAnnounced)
  const quiet = list.filter(b => isSilent(b, at) && !b.isSilenceAnnounced)
  if (!ended.length && !quiet.length) return
  const endedIds = new Set(ended.map(b => b.id))
  const quietIds = new Set(quiet.map(b => b.id))
  await update($, bgCommands, all =>
    all.map(b =>
      endedIds.has(b.id) ? { ...b, isAnnounced: true } : quietIds.has(b.id) ? { ...b, isSilenceAnnounced: true } : b,
    ),
  )
  for (const b of [...ended, ...quiet]) $.ui.toast(bgToast(b, at), { timeoutMs: b.status === 'completed' ? 6000 : 10000 })
}

// What changed in `path` since `before`, by the system's diff: the text read
// from stdin against the file as it is now (or /dev/null once it is gone).
async function makeDiff($: EngineInterface, before: string | null | undefined, path: string): Promise<Partial<StepFile>> {
  if (before === undefined || before === TOO_BIG) return {}
  const exists = await $.fs.exists(path).catch(() => false)
  const label = shortPath(path)
  const r = await $.process.run(['diff', '-u', '--label', `a/${label}`, '--label', `b/${label}`, '-', exists ? path : '/dev/null'], {
    stdin: before ?? '',
  })
  // 0: the same, 1: different, anything else: diff failed.
  if (r.exitCode > 1) return {}
  let added = 0
  let removed = 0
  for (const l of r.stdout.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) added++
    else if (l.startsWith('-') && !l.startsWith('---')) removed++
  }
  return { diff: cutDiff(r.stdout), added, removed }
}

// Saves the diffs of the given step files into the flow; the snapshots they
// came from go when `isFinal`.
async function storeDiffs($: EngineInterface, made: Map<string, Partial<StepFile>>, isFinal: boolean): Promise<void> {
  if (!made.size) return
  await update($, flow, p =>
    p
      ? {
          ...p,
          tasks: p.tasks.map(t =>
            t.files
              ? { ...t, files: t.files.map(x => ({ ...x, ...(made.get(fileKey(stepKey(t), x.path)) ?? {}) })) }
              : t,
          ),
        }
      : p,
  )
  if (isFinal) await update($, snapshots, all => Object.fromEntries(Object.entries(all).filter(([k]) => !made.has(k))))
}

// Diffs every file a finished step changed, once, as the step closes.
async function finalizeSteps($: EngineInterface): Promise<void> {
  const f = await read($, flow)
  if (!f) return
  const snaps = await read($, snapshots)
  const made = new Map<string, Partial<StepFile>>()
  for (const t of f.tasks) {
    if (t.status !== 'done') continue
    for (const file of t.files ?? []) {
      const k = fileKey(stepKey(t), file.path)
      if (!file.edits || !(k in snaps)) continue
      try {
        made.set(k, snaps[k] === TOO_BIG ? { diff: undefined } : await makeDiff($, snaps[k], file.path))
      } catch {
        made.set(k, {})
      }
    }
  }
  await storeDiffs($, made, true)
}

// Shows the file in Finder; elsewhere, opens its folder.
async function reveal($: EngineInterface, path: string): Promise<void> {
  try {
    const r = await $.process.run(['open', '-R', path])
    if (r.exitCode === 0) return
  } catch {
    // Not macOS: try the desktop's opener on the folder.
  }
  try {
    const r = await $.process.run(['xdg-open', path.replace(/\/[^/]*$/, '') || '/'])
    if (r.exitCode === 0) return
  } catch {
    // Fall through to the toast.
  }
  $.ui.toast(`${tr().revealFailed}: ${shortPath(path)}`)
}

// Opens or closes one file's diff; a running step's diff is made fresh.
async function toggleDiff($: EngineInterface, step: PlannedTask, file: StepFile): Promise<void> {
  const k = fileKey(stepKey(step), file.path)
  const p = await read($, panel)
  if (p.diffOpen === k) {
    await update($, panel, prev => ({ ...prev, diffOpen: '' }))
    return
  }
  const snaps = await read($, snapshots)
  if (k in snaps && (step.status === 'active' || file.diff === undefined)) {
    try {
      await storeDiffs($, new Map([[k, await makeDiff($, snaps[k], file.path)]]), false)
    } catch {
      // Shown without a diff.
    }
  }
  await update($, panel, prev => ({ ...prev, diffOpen: k }))
}

const toggleStep = ($: EngineInterface, key: string) =>
  update($, panel, prev => {
    const open = new Set(prev.expandedSteps ?? [])
    if (open.has(key)) open.delete(key)
    else open.add(key)
    return { ...prev, expandedSteps: [...open] }
  })

async function autoOpen($: EngineInterface, key: string): Promise<void> {
  const p = await read($, panel)
  if (p.autoOpenedFor === key) return
  await update($, panel, prev => ({ ...prev, autoOpenedFor: key }))
  void $.ui.open({ id: PANE, title: tr().pane })
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    setLang(await detectLang($, options.language))
    setCwd(started.cwd)
    setHome((await $.env.get('HOME')) ?? '')
    await $.tool.register({
      name: 'progress',
      description:
        'Report /savvy-flow progress to the progress bar above the prompt and the agents panel. ' +
        'Call it after presenting the plan (title, total, tasks, phase "delegate"), each time a task is accepted (done), ' +
        'when switching phase or re-planning (tasks), and once at the end with finished: true. Fields left out keep their previous value. ' +
        'For the main session only: a call from a subagent is ignored (workers report with `step`). ' +
        'Working without subagents: give each task a `status` and a one-sentence `summary` and resend the full `tasks` list as steps start and finish; ' +
        '`done` is then counted from the statuses.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name of the overall task, a few words.' },
          total: { type: 'integer', minimum: 0, description: 'Number of planned worker tasks.' },
          done: { type: 'integer', minimum: 0, description: 'Number of tasks accepted after review.' },
          phase: { type: 'string', enum: [...PHASES] },
          finished: { type: 'boolean', description: 'True once the flow is closed.' },
          tasks: {
            type: 'array',
            description:
              'The planned worker tasks in order, numbered from 1. Each title must equal the Agent tool `description` the task will be delegated with, so the panel can match runs to tasks.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'A few words; reused verbatim as the Agent description.' },
                tier: { type: 'string', enum: [...TIERS] },
                after: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the tasks this one waits for.' },
                status: {
                  type: 'string',
                  enum: [...STEP_STATUSES],
                  description: 'Only for steps you do yourself, without a subagent: pending, active (working on it) or done.',
                },
                summary: { type: 'string', description: 'One sentence: what the step does, or what it did once done.' },
                avatar: {
                  type: 'string',
                  enum: AVATAR_NAMES,
                  description:
                    'Optional, for steps you do yourself: the crab that shows the step in the panel. detective to investigate, engineer to build or fix, chef to prepare or assemble, racer for quick checks and tests, pirate to explore, astronaut for research or design. Picked from the title when left out.',
                },
              },
              required: ['title'],
            },
          },
        },
      },
    })
    await $.tool.register({
      name: 'step',
      description:
        'For savvy-flow workers: report progress on your own task to the agents panel. ' +
        'Right after reading the brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; ' +
        'call it again as each step finishes. Cheap and silent: it only draws a bar.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
        },
        required: ['done'],
      },
      // In every agent's tool list, not behind ToolSearch: workers do not go looking for it.
      isDeferred: false,
    })
    await $.command.register({
      name: 'agents-info',
      description: 'Show or hide the panel of subagents: running, finished and planned, with model, context, cost and time',
    })

    // Ticks the running agents', steps' and background commands' clocks, and
    // follows the commands' output; quiet when nothing runs.
    $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, agents)
        const f = await read($, flow)
        const bg = await read($, bgCommands)
        const isBgRunning = bg.some(b => b.status === 'running')
        if (!list.some(a => a.status === 'running') && !(f && !f.isFinished && activeSteps(f)) && !isBgRunning) return
        const at = await $.clock.now()
        if (isBgRunning) {
          await followOutput($, at)
          await announceBackground($, at)
        }
        // An active step's cost climbs as it goes: read the session's figures every few seconds.
        if (f && !f.isFinished && activeSteps(f) && Math.floor(at / 1000) % 5 === 0) {
          try {
            await storeUsage($, await $.session.usage())
          } catch {
            // Keep the last figures.
          }
        }
        await update($, now, () => at)
        $.ui.status(bgStatusLine(await read($, bgCommands), at))
      })()
    })

    try {
      await storeUsage($, await $.session.usage())
    } catch {
      // No figures yet: session.measure brings them after the first turn.
    }
    // Rows that ended before this load are old news: no toast for them. A running
    // row with no ID or output file the engine would give was never a command (an
    // earlier version read them out of any command's output text): it goes.
    await update($, bgCommands, list =>
      list
        .filter(b => b.status !== 'running' || (BG_ID.test(b.id) && b.outputFile?.startsWith('/')))
        .map(b => (b.status === 'running' ? b : { ...b, isAnnounced: true })),
    )
    return started
  })

  // The session's limits, cost and context, pushed after each turn.
  on('session.measure', async ($, e, next) => {
    await storeUsage($, e)
    return next(e)
  })

  // A shell command that went to the background, asked for or after its timeout:
  // its result names the task and the file its output goes to.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    // Only the engine's own record says a command went to the background. The
    // text is the command's output and may say anything, this hook's source included.
    const record = (result.deny === undefined ? result.result : undefined) as { backgroundTaskId?: unknown } | undefined
    const id = typeof record?.backgroundTaskId === 'string' && BG_ID.test(record.backgroundTaskId) ? record.backgroundTaskId : undefined
    if (!id) return result
    const text = 'text' in result && typeof result.text === 'string' ? result.text : ''
    const input = e as unknown as { command?: string; description?: string }
    const at = await $.clock.now()
    const task: BackgroundTask = {
      id,
      label: input.description?.trim() || clip((input.command ?? '').trim(), 60) || id,
      outputFile: /Output is being written to: (\/\S+?)\.?(?:\s|$)/.exec(text)?.[1],
      status: 'running',
      startedAt: at,
      outputBytes: 0,
    }
    await update($, bgCommands, list => [...list.filter(b => b.id !== id), task].slice(-20))
    await update($, now, () => at)
    $.ui.status(bgStatusLine(await read($, bgCommands), at))
    return result
  })

  // Reads and edits while a step is active belong to that step. Before a step
  // first changes a file, the file's text is kept, so the step's diff is its own.
  on('tool.call', { tool: /^(Read|Edit|Write|NotebookEdit)$/ }, async ($, e, next) => {
    const kind = FILE_TOOLS[e.tool as FileTool]
    const path = pathOf(e)
    const f = await read($, flow)
    const active = f && !f.isFinished ? f.tasks.filter(t => t.status === 'active') : []
    if (!path || !active.length) return next(e)
    let isNew = false
    if (kind === 'edit') {
      const snaps = await read($, snapshots)
      const missing = active.filter(t => !(fileKey(stepKey(t), path) in snaps))
      if (missing.length) {
        let before: string | null
        try {
          const { size } = await $.fs.stat(path)
          before = size <= SNAPSHOT_MAX ? await $.fs.read(path) : TOO_BIG
        } catch {
          before = null
        }
        isNew = before === null
        await update($, snapshots, all => ({ ...all, ...Object.fromEntries(missing.map(t => [fileKey(stepKey(t), path), before])) }))
      }
    }
    const result = await next(e)
    if (result.deny !== undefined || result.isError) return result
    const keys = new Set(active.map(stepKey))
    await update($, flow, p => (p ? touch(p, keys, path, kind, isNew) : p))
    return result
  })

  // Stopping a task by hand ends its row at once.
  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const result = await next(e)
    const input = e as unknown as { task_id?: string; shell_id?: string }
    const id = input.task_id ?? input.shell_id
    if (id) {
      const at = await $.clock.now()
      await update($, bgCommands, list =>
        list.map(b => (b.id === id && b.status === 'running' ? { ...b, status: 'killed' as const, endedAt: at, isAnnounced: true } : b)),
      )
      $.ui.status(bgStatusLine(await read($, bgCommands), at))
    }
    return result
  })

  // The engine announces a finished background task as a notification turn. The
  // matcher says so up front, so the module's other prompt.submit hooks can sit beside it.
  on('prompt.submit', { origin: { kind: 'task-notification' } }, async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      const id = /<task-id>([^<]+)<\/task-id>/.exec(e.text)?.[1]?.trim()
      const word = /<status>([^<]+)<\/status>/.exec(e.text)?.[1]?.trim().toLowerCase() ?? ''
      const bg = id ? await read($, bgCommands) : []
      if (id && bg.some(b => b.id === id && b.status === 'running')) {
        const at = await $.clock.now()
        await followOutput($, at, id)
        const status: BackgroundStatus = word === 'completed' ? 'completed' : word === 'killed' ? 'killed' : 'failed'
        await update($, bgCommands, list => list.map(b => (b.id === id ? { ...b, status, endedAt: at } : b)))
        await announceBackground($, at)
        await update($, now, () => at)
        $.ui.status(bgStatusLine(await read($, bgCommands), at))
      }
    }
    return next(e)
  })

  on('command.run', { command: 'agents-info' }, async ($, e) => {
    // `/agents-info open` opens the panel, or brings it forward from behind another tab, without toggling it.
    if ((e.args ?? '').trim() === 'open') {
      const at = await $.clock.now()
      await update($, now, () => at)
      await $.ui.open({ id: PANE, title: tr().pane })
      return { text: tr().opened }
    }
    const isOpen = await togglePane($)
    return { text: isOpen ? tr().opened : tr().closed }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    // The flow is the main session's: a call from a worker's loop carries its agentId
    // and changes nothing, or any subagent could rename, finish or reset the flow.
    if (e.agentId) return { result: 'ignored: only the main session reports the flow' }
    const input = e as unknown as ProgressInput
    const prev = await read($, flow)
    if (isNewFlow(prev, input) && input.title !== undefined) {
      // A new flow starts with a clean list: agents and background commands
      // still running stay, what finished belongs to the work before.
      await update($, agents, list => list.filter(a => a.status === 'running'))
      await update($, bgCommands, list => list.filter(b => b.status === 'running'))
      await update($, snapshots, () => ({}))
    }
    // A host with no clock (a test kit, say) still takes the report: step times then stand at the last tick.
    const at = await $.clock.now().catch(() => read($, now))
    await update($, now, () => at)
    // The session's figures right now, so a step's cost starts and stops on this call.
    let fig: Figures = {}
    try {
      const u = await $.session.usage()
      await storeUsage($, u)
      fig = { cost: u.cost?.usd, ctx: u.context.percent }
    } catch {
      // No figures: the step keeps its time, without a cost.
    }
    const next = await update($, flow, p => merge(p, input, at, fig))
    await finalizeSteps($)
    if (next && input.tasks?.length) await autoOpen($, next.title)
    return { result: `ok: ${label(next ?? blank())}` }
  })

  // A worker's own progress: the call runs in the worker's loop, so agentId names it.
  on('tool.call', { tool: STEP_TOOL }, async ($, e) => {
    const input = e as unknown as { done?: number; total?: number; note?: string }
    const agentId = e.agentId
    if (!agentId) return { result: 'ignored: only subagents report steps' }
    let matched = false
    await update($, agents, list =>
      list.map(a => {
        if (a.agentId !== agentId) return a
        matched = true
        const total = Math.max(0, Math.round(input.total ?? a.stepTotal ?? 0))
        const done = Math.max(0, Math.round(input.done ?? a.stepDone ?? 0))
        return { ...a, stepTotal: total, stepDone: total ? Math.min(total, done) : done, stepNote: input.note?.trim() || undefined }
      }),
    )
    return { result: matched ? 'ok' : `ignored: no panel row for agent ${agentId}` }
  })

  // Safety net: worker launches move the faint layer even if the orchestrator forgets to report.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const type = String(e.subagent_type ?? '')
    if (!type.startsWith('savvy-')) return next(e)

    await update($, flow, prev => {
      const base = prev && !prev.isFinished ? { ...blank(), ...prev } : blank()
      return { ...base, running: base.running + 1, phase: base.phase === 'plan' ? 'delegate' : base.phase }
    })
    try {
      return await next(e)
    } finally {
      await update($, flow, prev => (prev ? { ...prev, running: Math.max(0, prev.running - 1) } : prev))
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const isUnbriefed = e.subagentType.startsWith('savvy-') && !e.prompt.includes(STEP_TOOL)
    const started = await next(isUnbriefed ? { ...e, prompt: e.prompt + STEP_BRIEF } : e)
    if (started.deny !== undefined) return started

    const at = await $.clock.now()
    await update($, agents, list => {
      const round = 1 + list.filter(a => norm(a.description) === norm(e.description) && e.description).length
      const run: AgentRun = {
        id: started.agentId ?? e.tool_use_id,
        agentId: started.agentId,
        type: e.subagentType,
        description: e.description,
        model: started.model,
        status: 'running',
        startedAt: at,
        contextTokens: 0,
        contextMax: windowOf(started.model),
        tokens: 0,
        costUsd: 0,
        steps: 0,
        round,
      }
      return [...list.filter(a => a.id !== run.id), run].slice(-200)
    })
    await update($, now, () => at)
    if (e.subagentType.startsWith('savvy-')) {
      const f = await read($, flow)
      await autoOpen($, f && !f.isFinished ? f.title : 'savvy-flow')
    } else if (options.autoOpen === 'any') {
      await autoOpen($, 'any-agent')
    }
    return started
  })

  // Each model request of a subagent: live context, tokens and cost.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!agentId || !usage) return result

    const model = usage.model || e.model
    await update($, agents, list =>
      list.map((a): AgentRun =>
        a.agentId !== agentId
          ? a
          : {
              ...a,
              model,
              effort: typeof e.effort === 'string' ? e.effort : a.effort,
              status: 'running' as const,
              endedAt: undefined,
              contextTokens:
                (usage.input_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0) +
                (usage.output_tokens || 0),
              contextMax: windowOf(model),
              tokens:
                a.tokens +
                (usage.input_tokens || 0) +
                (usage.output_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0),
              costUsd: a.costUsd + costOf(model, usage, true),
              steps: a.steps + 1,
            },
      ),
    )
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId) {
      const at = await $.clock.now()
      await update($, agents, list =>
        list.map((a): AgentRun => {
          if (a.agentId !== agentId) return a
          // A run whose steps went unseen still gets the turn's own sum.
          const fallback = a.steps === 0 && e.usage
          return {
            ...a,
            status: e.reason === 'answer' ? ('done' as const) : ('failed' as const),
            endedAt: at,
            ...(fallback && e.usage
              ? {
                  model: e.usage.model || a.model,
                  tokens:
                    e.usage.input_tokens +
                    e.usage.output_tokens +
                    e.usage.cache_read_input_tokens +
                    e.usage.cache_creation_input_tokens,
                  costUsd: costOf(e.usage.model || a.model, e.usage, false),
                }
              : {}),
          }
        }),
      )
      await update($, now, () => at)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = tr()
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const f = await read($, flow)
    const p: Panel = await read($, panel)
    const u = await read($, usage)
    const clockAt = await $.clock.now().catch(() => read($, now))
    const at = Math.max(await read($, now), ...list.map(a => a.startedAt), 0)

    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const planned = plannedOf(f, list)
    const steps = stepsOf(f)
    const t = totals(list, at)
    const tiles = tilesOf(list, f, u, Math.max(at, clockAt))
    const limits = limitsOf(u)
    const stepsHeader = `${s.steps} · ${steps.filter(p => p.status === 'done').length}/${steps.length}`
    const liveAt = Math.max(at, clockAt)
    const bg = bgShown(await read($, bgCommands))
    const bgRunning = bg.filter(b => b.status === 'running').length
    const bgHeader = `${s.background} · ${bgRunning ? `${bgRunning} ${s.bgRunning}` : bg.length}`
    // The pane's title says "Agents"; inside, only the flow's own name.
    const title = f && !f.isFinished ? f.title : ''

    const toggleCompact = (
      <Button
        key="compact"
        label={p.isCompact ? s.expand : s.collapse}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isCompact: !prev.isCompact }))}
      />
    )
    const toggleDone = (
      <Button
        key="done"
        label={`${p.isDoneCollapsed ? (isRtl() ? '◂' : '▸') : '▾'} ${s.finished} · ${finished.length}`}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
      />
    )
    const isEmpty = list.length === 0 && planned.length === 0 && steps.length === 0 && bg.length === 0
    const summary = tilesAlt(tiles, limits)
    const expanded = new Set(p.expandedSteps ?? [])
    // Indent from where a line starts reading: the left, or the right in Hebrew.
    const indent = (n: number) => (isRtl() ? { marginRight: n } : { marginLeft: n })
    const { Code } = ui

    // A step's files: each with what the step did to it, a button to show it in
    // Finder and, for a changed file, one to open its diff underneath.
    const fileList = (step: Planned) => (
      <Box key={`files-${stepKey(step)}`} flexDirection="column" {...indent(e.surface === 'desktop' ? 5 : 2)} marginBottom={1}>
        {(step.files ?? []).map(file => {
          const k = fileKey(stepKey(step), file.path)
          const isDiffOpen = p.diffOpen === k
          return (
            <Box key={`file-${k}`} flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Text wrap="truncate-start">{shortPath(file.path)}</Text>
                <Text dimColor={!file.edits} color={file.edits ? (file.isNew ? 'green' : undefined) : undefined}>
                  {fileStats(file)}
                </Text>
                <Button key={`finder-${k}`} label={s.finder} plain onPress={() => reveal($, file.path)} />
                {file.edits ? (
                  <Button key={`diff-${k}`} label={isDiffOpen ? s.hideDiff : s.diff} plain onPress={() => toggleDiff($, step, file)} />
                ) : null}
              </Box>
              {isDiffOpen ? (
                file.diff ? (
                  <Code key={`code-${k}`} source={file.diff} format="diff" path={file.path} />
                ) : (
                  <Text dimColor>{file.diff === '' ? s.noChanges : s.tooBig}</Text>
                )
              ) : null}
            </Box>
          )
        })}
      </Box>
    )

    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
      const section = (key: string, text: string) => (
        <Text key={key} dimColor>
          {text}
        </Text>
      )

      // In Hebrew the column hugs the right edge: section heads and buttons right-aligned.
      const align = isRtl() ? 'flex-end' : undefined
      if (p.isCompact) {
        return (
          <Box flexDirection="column" gap={1} alignItems={align}>
            <Svg source={compactSvg(W, list, planned, t)} alt={`${list.length} ${s.agentsCount}, ${summary}`} width={W} height={32} />
            {toggleCompact}
          </Box>
        )
      }
      const shownDone = p.isDoneCollapsed ? 0 : finished.length
      const lines = 1 + (isEmpty ? 1 : 0) + (running.length > 0 ? 1 : 0) + (finished.length > 0 ? 1 : 0) + (planned.length > 0 ? 1 : 0)
      const sections = (steps.length > 0 ? 1 : 0) + (bg.length > 0 ? 1 : 0)
      // A step's files button, and when open a line per file and the open diff's lines.
      const filesHeight = (st: Planned): number => {
        if (!st.files?.length) return 0
        if (!expanded.has(stepKey(st))) return LINE_H
        const open = st.files.find(fl => p.diffOpen === fileKey(stepKey(st), fl.path))
        const diffLines = open?.diff ? open.diff.split('\n').length : open ? 1 : 0
        return LINE_H * (2 + st.files.length) + diffLines * DIFF_LINE_H
      }
      const gridH =
        headerHeight(title, limits.length) +
        (lines + sections) * LINE_H +
        steps.reduce((h, st) => h + stepHeight(W, st, u) + filesHeight(st), 0) +
        bg.reduce((h, b) => h + bgHeight(W, b), 0) +
        (running.length + shownDone) * 66 +
        planned.length * 46
      return (
        <Box flexDirection="column">
          {/* The grid sizes the pane; the content is placed over it, as an
              absolute Box paints over the siblings before it. */}
          {gridTiles(gridH).map((tileH, i) => (
            <Svg key={`grid-${i}`} source={gridSvg(W, tileH)} alt="dotted grid" width={W} height={tileH} />
          ))}
          <Box flexDirection="column" position="absolute" top={0} left={0} right={0} alignItems={align}>
            <Svg
              source={headerSvg(W, title, tiles, limits, clockAt)}
              alt={title ? `${title}: ${summary}` : summary}
              width={W}
              height={headerHeight(title, limits.length)}
            />
            {toggleCompact}
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {steps.length > 0 && section('h-steps', stepsHeader)}
            {steps.map(p => {
              const isOpen = expanded.has(stepKey(p))
              const row = (
                <Svg
                  key={`step-${p.n}`}
                  source={stepSvg(W, p, liveAt, u)}
                  alt={`${p.n}. ${p.title}: ${stepLabel(p, liveAt)}${stepSpend(p, u) ? `, ${stepSpend(p, u)}` : ''}${p.summary ? `. ${p.summary}` : ''}`}
                  width={W}
                  height={stepHeight(W, p, u)}
                />
              )
              // A step with files says how many under its row; a tap there opens them.
              return p.files?.length ? (
                <Box key={`step-${p.n}`} flexDirection="column" alignItems={align}>
                  {row}
                  <Box {...indent(5)}>
                    <Button key={`open-${stepKey(p)}`} label={filesHint(p.files, isOpen)} plain onPress={() => toggleStep($, stepKey(p))} />
                  </Box>
                  {isOpen && fileList(p)}
                </Box>
              ) : (
                row
              )
            })}
            {bg.length > 0 && section('h-bg', bgHeader)}
            {bg.map(b => (
              <Svg
                key={`bg-${b.id}`}
                source={bgSvg(W, b, liveAt)}
                alt={`${b.label}: ${bgStatusLabel(b)}, ${fmtTime(bgElapsed(b, liveAt))}. ${bgDetail(b, liveAt)}`}
                width={W}
                height={bgHeight(W, b)}
              />
            ))}
            {running.length > 0 && section('h-run', `${s.running} · ${running.length}`)}
            {running.map(a => (
              <Svg key={a.id} source={agentSvg(W, a, at)} alt={`${a.description}: ${modelName(a.model)}, ${s.isRunning}`} width={W} height={66} />
            ))}
            {finished.length > 0 && toggleDone}
            {!p.isDoneCollapsed &&
              finished.map(a => (
                <Svg key={a.id} source={agentSvg(W, a, at)} alt={`${a.description}: ${modelName(a.model)}, ${s.isFinished}`} width={W} height={66} />
              ))}
            {planned.length > 0 && section('h-plan', `${s.planned} · ${planned.length}`)}
            {planned.map(pl => (
              <Svg key={`plan-${pl.n}`} source={plannedSvg(W, pl)} alt={`${pl.n}. ${pl.title}: ${s.isPlanned}`} width={W} height={46} />
            ))}
          </Box>
        </Box>
      )
    }

    // Terminal: the same content in text rows.
    const cols = Math.max(24, e.props.bodyColumns || 40)
    const barW = Math.max(6, Math.min(20, cols - 34))
    const row = (a: AgentRun) => {
      const tier = tierOf(a.type)
      const color = colorOf(tier)
      const ctx = ctxOf(a)
      const progress = progressOf(a)
      const model = runModel(a)
      const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' ' + a.stepNote : ''} · ` : ''
      return (
        <Box key={a.id} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={color}>▣</Text>
            <Text bold wrap="truncate-end">
              {a.description || a.type}
            </Text>
            <Text color={a.status === 'failed' ? 'red' : a.status === 'done' ? 'green' : color}>{STATUS_GLYPH[a.status]}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {'  '}
            {tier === 'other' ? a.type : tierWord(tier)} · {model}
            {a.round > 1 ? ` · ${s.round} ${a.round}` : ''}
          </Text>
          <Text wrap="truncate-end">
            {'  '}
            {progress === null ? <Text dimColor>{ctxBar(ctx, barW)}</Text> : <Text color={color}>{ctxBar(progress * 100, barW)}</Text>}
            <Text dimColor>
              {' '}
              {steps}{s.ctx} {ctx}% · {fmtTokens(a.contextTokens)} ≈{fmtCost(a.costUsd)} {fmtTime(elapsed(a, at))}
            </Text>
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold wrap="truncate-end">
            {title}
          </Text>
          {toggleCompact}
        </Box>
        <Text dimColor wrap="truncate-end">{tiles.map(x => `${x.k} ${x.v}`).join(' · ')}</Text>
        {limits.map(l => (
          <Text key={`limit-${l.kind}`} wrap="truncate-end">
            <Text dimColor>{limitName(l.kind)} </Text>
            <Text color={limitColor(l.percentUsed)}>{ctxBar(Math.min(100, l.percentUsed), Math.max(6, Math.min(16, cols - 40)))}</Text>
            <Text> {Math.round(l.percentUsed)}%</Text>
            <Text dimColor> {fmtResets(l.resetsAt, clockAt)}</Text>
          </Text>
        ))}
        {p.isCompact ? (
          <Text wrap="truncate-end">
            {[...running, ...finished].map(a => (
              <Text key={a.id} color={colorOf(tierOf(a.type))}>
                {STATUS_GLYPH[a.status]}{' '}
              </Text>
            ))}
            {planned.map(pl => (
              <Text key={`plan-${pl.n}`} dimColor>
                ◷{' '}
              </Text>
            ))}
          </Text>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {steps.length > 0 && <Text dimColor>{stepsHeader}</Text>}
            {steps.map(pl => (
              <Box key={`step-${pl.n}`} flexDirection="column" marginBottom={1}>
                <Box flexDirection="row" gap={1}>
                  <Text color={stepColor(pl.status)}>{STATUS_GLYPH[pl.status === 'active' ? 'running' : pl.status === 'done' ? 'done' : 'planned']}</Text>
                  <Text bold={pl.status !== 'pending'} dimColor={pl.status === 'pending'} wrap="truncate-end">
                    {pl.n}. {pl.title}
                  </Text>
                  <Text color={stepColor(pl.status)}>{stepLabel(pl, liveAt)}</Text>
                  {stepSpend(pl, u) ? <Text dimColor>{stepSpend(pl, u)}</Text> : null}
                </Box>
                {pl.summary ? (
                  <Text dimColor wrap="wrap">
                    {'  '}
                    {pl.summary}
                  </Text>
                ) : null}
                {pl.files?.length ? (
                  <Button
                    key={`open-${stepKey(pl)}`}
                    label={`  ${filesHint(pl.files, expanded.has(stepKey(pl)))}`}
                    plain
                    onPress={() => toggleStep($, stepKey(pl))}
                  />
                ) : null}
                {expanded.has(stepKey(pl)) && fileList(pl)}
              </Box>
            ))}
            {bg.length > 0 && <Text dimColor>{bgHeader}</Text>}
            {bg.map(b => {
              const color = b.status === 'completed' ? 'green' : b.status === 'running' ? (isSilent(b, liveAt) ? 'yellow' : ACCENT) : 'red'
              const pct = b.progress !== undefined && b.status === 'running' ? `${Math.round(b.progress * 100)}% · ` : ''
              return (
                <Box key={`bg-${b.id}`} flexDirection="column" marginBottom={1}>
                  <Box flexDirection="row" gap={1}>
                    <Text color={color}>{STATUS_GLYPH[bgMark(b)]}</Text>
                    <Text bold wrap="wrap">
                      {b.label}
                    </Text>
                    <Text dimColor>
                      {b.status === 'running' ? pct : `${bgStatusLabel(b)} · `}
                      {fmtTime(bgElapsed(b, liveAt))}
                    </Text>
                  </Box>
                  {b.progress !== undefined && b.status === 'running' ? (
                    <Text color={color}>
                      {'  '}
                      {ctxBar(b.progress * 100, barW)}
                    </Text>
                  ) : null}
                  <Text dimColor={!isSilent(b, liveAt)} color={isSilent(b, liveAt) ? 'yellow' : undefined} wrap="truncate-end">
                    {'  '}
                    {bgDetail(b, liveAt)}
                  </Text>
                </Box>
              )
            })}
            {running.length > 0 && <Text dimColor>{s.running} · {running.length}</Text>}
            {running.map(row)}
            {finished.length > 0 && toggleDone}
            {!p.isDoneCollapsed && finished.map(row)}
            {planned.length > 0 && <Text dimColor>{s.planned} · {planned.length}</Text>}
            {planned.map(pl => {
              const tier = pl.tier in TIER_COLOR ? pl.tier : 'other'
              return (
                <Box key={`plan-${pl.n}`} flexDirection="column" marginBottom={1}>
                  <Text dimColor wrap="truncate-end">
                    <Text color={colorOf(tier)}>▢</Text> {pl.n}. {pl.title} ◷
                  </Text>
                  <Text dimColor wrap="truncate-end">
                    {'  '}
                    {tierWord(tier)} · {tierModel(tier)}
                    {pl.after.length ? ` · ${s.after} ${pl.after.join(', ')}` : ''}
                  </Text>
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, flow)
    if (f === null || e.props.hasSurvey) return next(e)
    // Draw this row with the other mods' bands beneath it. Claude Code's own placeholder ({ type: 'engine' }) is
    // never nested: the desktop drops a band that nests it.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const crew = list.length + plannedOf(f, list).length
    const isWorking =
      list.some(a => a.status === 'running') ||
      (!f.isFinished && activeSteps(f) > 0) ||
      (await read($, bgCommands)).some(b => b.status === 'running')
    const crewButton = (
      <Button key="savvy-agents" label={crew ? `×${crew}` : tr().details} plain onPress={() => void togglePane($)} />
    )
    const percent = `${Math.round(ratio(f) * 100)}%`
    const mood = barMood(f, await $.clock.now().catch(() => read($, now)))
    const dismiss = (
      <Button
        key="savvy-dismiss"
        label="✕"
        plain
        role="dismiss"
        onPress={() => update($, flow, () => null)}
      />
    )

    // The terminal's element table is completed with an `Svg` that draws nothing: test the surface too.
    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      // About 8 CSS px per reported column; the rest is the count, the dismiss
      // and their gaps. No floor above the slot: a row wider than it would wrap.
      const width = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 96))
      return (
        <Box flexDirection="column">
          <Box flexDirection={isRtl() ? 'row-reverse' : 'row'} alignItems="center" gap={1}>
            <Svg source={rowSvg(f, width, isWorking, barCostume(f), mood)} alt={`${f.title}: ${label(f)}, ${percent}`} width={width} height={H} />
            {crewButton}
            {dismiss}
          </Box>
          {below}
        </Box>
      )
    }

    const cols = e.props.bodyColumns
    const titleW = Math.max(8, Math.min(30, f.title.length + 2, Math.floor(cols / 3)))
    const width = Math.max(6, Math.min(40, cols - titleW - 32))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Box width={titleW} flexShrink={0}>
            <Text color={f.isFinished ? DONE : ACCENT}>● </Text>
            <Text wrap="truncate-end">{f.title}</Text>
          </Box>
          <Text color={f.isFinished ? DONE : ACCENT}>{barText(f, width)}</Text>
          <Text bold>{label(f)}</Text>
          <Text dimColor>{percent}</Text>
          <Text color={CLAY}>▣</Text>
          {crewButton}
          {dismiss}
        </Box>
        {below}
      </Box>
    )
  })
}
