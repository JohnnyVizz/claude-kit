import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'savvy-progress'
const PROGRESS = 'mcp__savvy-progress__progress'
const STEP = 'mcp__savvy-progress__step'
const pane = { title: '', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} }

// A started session (its clock ticks the panel) with one savvy worker running.
async function crew($: Engine, on: On) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__savvy-progress__${e.name}` } }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }) as never)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 4, tasks: [{ title: 'Write the parser', tier: 'light' }] } as never)
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Write the parser', subagentType: 'savvy-light', provider: 'engine', parentModel: 'claude-haiku-5-5', background: true, fork: false } as never)
  return clock
}

// Many mounts in one test: room for a busy machine (5s is the default).
const SLOW = { timeoutMs: 15_000 }

// Whether a fresh drawing of `component` shows `text`: in the desktop's SVG source, or in a terminal Text.
const shows = async ($: Engine, surface: 'terminal' | 'desktop', component: 'Pane' | 'AbovePrompt', text: string) => {
  const ui =
    component === 'Pane'
      ? await $.ui.mount({ plugin: PLUGIN, surface, component, requestId: 'savvy-agents', props: pane })
      : await $.ui.mount({ plugin: PLUGIN, surface, component, props: band })
  try {
    if (surface === 'desktop') return (await ui.findAll({ type: 'Svg' })).some(el => String(el.props.source).includes(text))
    // The texts asked for here hold no regex metacharacters.
    return (await ui.find({ text: new RegExp(text) })) !== undefined
  } finally {
    await ui.unmount()
  }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: a worker's row shows time left from its pace`, SLOW, async ($, on) => {
    const clock = await crew($, on)
    // No step done yet: no pace, no estimate.
    await $.tool.call({ tool: STEP, agentId: 'a1', done: 0, total: 4 } as never)
    await clock.advance(60_000)
    expect(await shows($, surface, 'Pane', 'left')).toBe(false)

    // 1 of 4 steps in 1:00 → 3 more at that pace.
    await $.tool.call({ tool: STEP, agentId: 'a1', done: 1, total: 4 } as never)
    expect(await shows($, surface, 'Pane', '~3:00 left')).toBe(true)
  })

  test(`${surface}: the bar shows the flow's time left`, SLOW, async ($, on) => {
    const clock = await crew($, on)
    // Before any task is accepted, the bar borrows the worker's estimate: 1 of 2 steps in 0:30.
    await clock.advance(30_000)
    await $.tool.call({ tool: STEP, agentId: 'a1', done: 1, total: 2 } as never)
    expect(await shows($, surface, 'AbovePrompt', '~0:30 left')).toBe(true)

    // 1 of 4 tasks accepted 2:00 into the flow → 3 more at that pace.
    await clock.advance(90_000)
    await $.tool.call({ tool: PROGRESS, done: 1 } as never)
    expect(await shows($, surface, 'AbovePrompt', '~6:00 left')).toBe(true)

    // A finished flow with its worker still running hands the bar to the running subagents.
    await $.tool.call({ tool: PROGRESS, finished: true } as never)
    expect(await shows($, surface, 'AbovePrompt', 'Ship it')).toBe(false)

    // Once nothing runs, the finished flow is back, with nothing left.
    await ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId: 'a1', reason: 'answer', answer: 'ok' })
    expect(await shows($, surface, 'AbovePrompt', 'Ship it')).toBe(true)
    expect(await shows($, surface, 'AbovePrompt', 'left')).toBe(false)
  })
}
