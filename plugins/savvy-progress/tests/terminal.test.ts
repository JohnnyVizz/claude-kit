import { expect, mock, test } from 'claude-code/testing'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any

const PANE = 'savvy-agents'
const CELL_BYTES = 12

const spawn = ($: Loose) =>
  $.agent.spawn({ tool_use_id: 't1', description: 'Fix the parser', subagentType: 'savvy-careful', prompt: 'x' })

const opened = { count: 0 }

// What the engine answers beneath the mod: an English session and an open pane.
const engine = (on: Loose) => {
  on('session.start', async (_$: Loose, e: Loose) => e)
  on('env.get', async () => ({ value: '' }))
  on('settings.read', async () => ({ value: '' }))
  on('tool.register', async () => ({ value: {} }))
  on('command.register', async () => ({ value: {} }))
  on('ui.open', async () => {
    opened.count++
    return { value: { isPlaced: true } }
  })
  on('agent.spawn', async () => ({ agentId: 'a1', model: 'claude-opus-5-5' }))
  return mock.clock(on)
}

test('a running agent is a Raster crab in the terminal pane, repainted by the frame clock', async ($: Loose, on: Loose) => {
  const blits: { requestId: string; key: string; cells: string }[] = []
  const clock = engine(on)
  on('ui.blit', async (_$: Loose, e: Loose) => {
    blits.push(e)
    return { value: {} }
  })

  await $.session.start({ cwd: '/tmp' })
  await spawn($)
  const pane = await $.ui.mount({
    plugin: 'savvy-progress',
    surface: 'terminal',
    component: 'Pane',
    props: { bodyColumns: 60, bodyRows: 30 },
    requestId: PANE,
  })

  const crab = await pane.find({ type: 'Raster' })
  expect(crab).toBeDefined()
  expect(crab.props.columns).toBe(15)
  expect(crab.props.rows).toBe(7)
  expect(atob(crab.props.cells).length).toBe(15 * 7 * CELL_BYTES)

  await clock.advance(1000)
  expect(blits.length).toBeGreaterThan(0)
  expect(blits[0]?.requestId).toBe(PANE)
  expect(blits[0]?.key).toBe(crab.props.key)
  expect(blits.some(b => b.cells !== blits[0]?.cells)).toBe(true)
  await pane.unmount()
})

test('a narrow terminal pane keeps the text rows', async ($: Loose, on: Loose) => {
  engine(on)
  await $.session.start({ cwd: '/tmp' })
  await spawn($)
  const pane = await $.ui.mount({
    plugin: 'savvy-progress',
    surface: 'terminal',
    component: 'Pane',
    props: { bodyColumns: 30, bodyRows: 30 },
    requestId: PANE,
  })
  expect((await pane.find({ type: 'Raster' })) == null).toBe(true)
  expect((await pane.find({ text: 'Fix the parser' })) == null).toBe(false)
})

test('the band above the prompt animates its bar and crab while an agent runs', async ($: Loose, on: Loose) => {
  const keys = new Set<string>()
  const clock = engine(on)
  on('ui.blit', async (_$: Loose, e: Loose) => {
    keys.add(e.key)
    return { value: {} }
  })

  await $.session.start({ cwd: '/tmp' })
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', tool_use_id: 'p1', title: 'Ship it', total: 2, done: 1, phase: 'delegate' })
  await spawn($)
  const band = await $.ui.mount({
    plugin: 'savvy-progress',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 },
    requestId: 'band',
  })

  expect((await band.find({ text: /Ship it/ })) == null).toBe(false)
  expect((await band.findAll({ type: 'Raster' })).length).toBe(2)
  await clock.advance(500)
  expect([...keys].sort()).toEqual(['savvy-bar', 'savvy-crab'])
  await band.unmount()
})

const spawnWorker = ($: Loose) =>
  $.agent.spawn({ tool_use_id: 't2', description: 'Rename the flag', subagentType: 'savvy-light', prompt: 'x' })

test('a starting worker leaves the panel closed until /agents-info opens it', async ($: Loose, on: Loose) => {
  engine(on)
  on('ui.panes', async () => ({ value: [] }))
  opened.count = 0
  await $.session.start({ cwd: '/tmp' })
  await spawnWorker($)
  expect(opened.count).toBe(0)
  await $.command.run({ command: 'agents-info', args: '' })
  expect(opened.count).toBe(1)
})

test('with panel set to auto a starting worker opens the panel', { options: { panel: 'auto' } }, async ($: Loose, on: Loose) => {
  engine(on)
  opened.count = 0
  await $.session.start({ cwd: '/tmp' })
  await spawnWorker($)
  expect(opened.count).toBe(1)
})
