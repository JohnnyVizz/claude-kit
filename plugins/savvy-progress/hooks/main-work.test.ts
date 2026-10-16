import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'savvy-progress'
const band = { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} }

// A started session whose main loop begins a turn; the engine's answers stubbed.
async function working($: Engine, on: On, isStarted = true) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__savvy-progress__${e.name}` } }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  if (isStarted) await $.turn.start({ text: 'Fix the bug', turnId: 'turn-1' })
  return clock
}

// Many mounts in one test: room for a busy machine (5s is the default).
const SLOW = { timeoutMs: 15_000 }

// Whether the band shows `text` on a surface: false too when it hands the row on (nothing beneath answers in a test).
const shows = async ($: Engine, surface: 'terminal' | 'desktop', text: string): Promise<boolean> => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band }).catch(() => null)
  if (!ui) return false
  try {
    if (surface === 'desktop') return (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('').includes(text)
    // The texts asked for here hold no regex metacharacters.
    return (await ui.find({ text: new RegExp(text) })) !== undefined
  } finally {
    await ui.unmount()
  }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the bar follows the main session's own work`, SLOW, async ($, on) => {
    const clock = await working($, on)
    await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    // A subagent's calls are its own.
    await $.tool.call({ tool: 'Grep', agentId: 'a1', pattern: 'x' } as never)
    await clock.advance(83_000)

    expect(await shows($, surface, 'Working')).toBe(true)
    expect(await shows($, surface, '2 tool calls · 1:23 · Bash')).toBe(true)

    // The turn ends: the bar stays, ready, with the last turn's totals.
    await ($.turn.complete as (e: unknown) => Promise<unknown>)({ reason: 'answer', answer: 'done' })
    expect(await shows($, surface, 'Working')).toBe(false)
    expect(await shows($, surface, 'Ready')).toBe(true)
    expect(await shows($, surface, 'last turn: 2 tool calls · 1:23')).toBe(true)

    // The next turn switches back to the live view, counting from zero.
    await $.turn.start({ text: 'And the docs', turnId: 'turn-2' })
    expect(await shows($, surface, '0 tool calls · 0:00')).toBe(true)
  })

  test(`${surface}: a new chat shows the bar ready before the first message`, async ($, on) => {
    await working($, on, false)
    expect(await shows($, surface, 'Ready')).toBe(true)
    expect(await shows($, surface, 'last turn')).toBe(false)
  })
}

test('mainBar off: no row for the main session', { options: { mainBar: 'off' } }, async ($, on) => {
  await working($, on)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(await shows($, 'desktop', 'Working')).toBe(false)
  expect(await shows($, 'desktop', 'Ready')).toBe(false)
})

test('a running subagent takes the bar over from the main session', async ($, on) => {
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  await working($, on)
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Fix it', subagentType: 'general-purpose', provider: 'engine', parentModel: 'claude-haiku-5-5', background: true, fork: false } as never)
  expect(await shows($, 'desktop', 'Tasks 0/1')).toBe(true)
  expect(await shows($, 'desktop', 'tool calls')).toBe(false)
})

// The main row's crab is its own drawing: every Svg's source, joined.
const drawings = async ($: Engine): Promise<string> => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band })
  try {
    return (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('')
  } finally {
    await ui.unmount()
  }
}

test('the crab dresses for the work the main session is doing, and rests between turns', async ($, on) => {
  await working($, on)
  // Thinking before the first tool call.
  expect(await drawings($)).toContain('class="c-plan run act"')
  await $.tool.call({ tool: 'Grep', pattern: 'TODO' } as never)
  expect(await drawings($)).toContain('class="c-explore run act"')
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' } as never)
  expect(await drawings($)).toContain('class="c-build run act"')
  await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'a', new_string: 'b' } as never)
  expect(await drawings($)).toContain('class="c-write run act"')
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  expect(await drawings($)).toContain('class="c-test run act"')
  await $.tool.call({ tool: 'WebSearch', query: 'vite config' } as never)
  expect(await drawings($)).toContain('class="c-research run act"')

  await ($.turn.complete as (e: unknown) => Promise<unknown>)({ reason: 'answer', answer: 'done' })
  const ready = await drawings($)
  expect(ready).toContain('class="c-rest"')
  expect(ready).toContain('class="steam"')
})
