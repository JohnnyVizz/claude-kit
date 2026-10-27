import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'savvy-progress'
const pane = (bodyColumns: number) =>
  ({ title: '', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }) as const

// One running worker, on the mocked clock.
const worker = async ($: Engine, on: On) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Walking work', subagentType: 'general-purpose', provider: 'engine', parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
}

const mount = ($: Engine, surface: 'terminal' | 'desktop', columns: number) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'savvy-agents', props: pane(columns) })

test('terminal, row: each agent has a 9 × 4 mini crab beside its lines', { options: { terminalCrabs: 'row' } }, async ($, on) => {
  await worker($, on)
  const ui = await mount($, 'terminal', 60)
  const crab = await ui.find({ type: 'Raster', key: 'crab-a1' })
  expect(crab).toBeDefined()
  expect(crab?.props).toMatchObject({ columns: 9, rows: 4 })
  expect(await ui.find({ type: 'Text', text: /Walking work/ })).toBeDefined()
})

test('terminal, row: a narrow panel keeps text only', { options: { terminalCrabs: 'row' } }, async ($, on) => {
  await worker($, on)
  const ui = await mount($, 'terminal', 30)
  expect(await ui.find({ type: 'Raster', key: 'crab-a1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Walking work/ })).toBeDefined()
})

test('terminal, stage: the running crab is drawn at full size above the list', { options: { terminalCrabs: 'stage' } }, async ($, on) => {
  await worker($, on)
  const ui = await mount($, 'terminal', 60)
  expect((await ui.find({ type: 'Raster', key: 'crab-a1' }))?.props).toMatchObject({ columns: 30, rows: 14 })
})

test('terminal, off: no crabs', { options: { terminalCrabs: 'off' } }, async ($, on) => {
  await worker($, on)
  const ui = await mount($, 'terminal', 60)
  expect(await ui.find({ type: 'Raster', key: 'crab-a1' })).toBeUndefined()
})

test('desktop: no Raster, the SVG rows as before', async ($, on) => {
  await worker($, on)
  const ui = await mount($, 'desktop', 60)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
})

// One model request of the worker at `effort`, as `turn.step` reports it.
// The engine's answer to a model request: registered before the test first calls $.
const answersSteps = (on: On) =>
  on('turn.step', async function* () {
    return { turnId: 'turn', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model: 'claude-haiku-5-5', input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never
  })

const step = async ($: Engine, effort: string) => {
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ turnId: 'turn', index: 0, model: 'claude-haiku-5-5', effort, messageCount: 1, agentId: 'a1' })
  for await (const _ of stream) void _
}

test('terminal: agents are numbered and the type is painted in the color of its effort', async ($, on) => {
  answersSteps(on)
  await worker($, on)
  await step($, 'low')
  const ui = await mount($, 'terminal', 60)
  expect(await ui.find({ type: 'Text', text: /^1\. Walking work$/ })).toBeDefined()
  // low reads as the light tier, as savvy's light worker runs at low effort.
  expect((await ui.find({ type: 'Text', text: /^general-purpose$/ }))?.props).toMatchObject({ color: '#1D9E75' })
  expect(await ui.find({ type: 'Text', text: /Haiku 5\.5 · low/ })).toBeDefined()
})

test('terminal: the steps an agent reports show as done/total and its note', async ($, on) => {
  await worker($, on)
  await $.tool.call({ tool: 'mcp__savvy-progress__step', done: 1, total: 4, note: 'Paleta validada', agentId: 'a1' } as never)
  const ui = await mount($, 'terminal', 60)
  expect(await ui.find({ type: 'Text', text: /^1\/4 · Paleta validada$/ })).toBeDefined()
})

for (const [reportSteps, isAsked] of [['savvy', false], ['any', true]] as const) {
  test(`reportSteps ${reportSteps}: a general-purpose agent is ${isAsked ? '' : 'not '}asked for its steps`, { options: { reportSteps } }, async ($, on) => {
    let prompt = ''
    on('agent.spawn', (_$, e) => {
      prompt = (e as { prompt: string }).prompt
      return { model: 'claude-haiku-5-5', agentId: 'a1' } as never
    })
    await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Any work', subagentType: 'general-purpose', provider: 'engine', parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
    expect(prompt.includes('mcp__savvy-progress__step')).toBe(isAsked)
  })
}

test('terminal: a savvy tier wears its costume, another agent the plain crab', async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${++n}` }))
  for (const type of ['savvy-careful', 'general-purpose'])
    await $.agent.spawn({ tool_use_id: `t-${type}`, prompt: 'p', description: type, subagentType: type, provider: 'engine', parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  const ui = await mount($, 'terminal', 60)
  const careful = await ui.find({ type: 'Raster', key: 'crab-a1' })
  const plain = await ui.find({ type: 'Raster', key: 'crab-a2' })
  expect(careful?.props.cells).toBeDefined()
  expect(careful?.props.cells).not.toBe(plain?.props.cells)
})

test('terminal: a planned task stands as a faded crab in its tier costume', async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Plan', phase: 'delegate', tasks: [{ title: 'Review', tier: 'careful' }] } as never)
  const ui = await mount($, 'terminal', 60)
  expect((await ui.find({ type: 'Raster', key: 'crab-plan-1' }))?.props).toMatchObject({ columns: 9, rows: 4 })
  expect(await ui.find({ type: 'Text', text: /1\. Review/ })).toBeDefined()
})
