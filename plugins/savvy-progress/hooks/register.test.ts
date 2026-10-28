import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'savvy-progress'
const PROGRESS = 'mcp__savvy-progress__progress'
const STEP = 'mcp__savvy-progress__step'

const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

const plan = {
  tool: PROGRESS,
  title: 'Ship the thing',
  phase: 'delegate',
  tasks: [
    { title: 'Write the parser', tier: 'careful' },
    { title: 'Wire the CLI', tier: 'light', after: [1] },
  ],
} as const

// The band's row is one Svg on the desktop and plain Text in the terminal.
const draws = async ($: Engine, surface: 'terminal' | 'desktop', text: RegExp): Promise<boolean> => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
  const svg = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('')
  return text.test(svg) || (await ui.findAll({ type: 'Text', text })).length > 0
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the band shows what the flow reports`, async ($, on) => {
    // Reporting a plan opens the panel by itself, once per flow.
    const opened: string[] = []
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })

    const reported = await $.tool.call(plan as never)
    expect(reported).toMatchObject({ result: 'ok: Tasks 0/2' })

    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    // Two planned tasks, none started: the crew button counts both.
    expect((await ui.find({ key: 'savvy-agents' }))?.props.label).toBe('×2')

    await $.tool.call({ tool: PROGRESS, done: 1 } as never)
    expect(opened).toEqual(['savvy-agents'])
    expect(await $.tool.call({ tool: PROGRESS, finished: true } as never)).toMatchObject({ result: 'ok: Done' })
  })

  // The schema's enum and bounds are advice to the model: a call outside them must still draw.
  test(`${surface}: input outside the tool's schema cannot break the drawing`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const tasks = [
      { title: 'Odd one', tier: '__proto__' },
      { title: 'Odd two', tier: 'constructor' },
      ...Array.from({ length: 500 }, (_, i) => ({ title: `Task ${i}`, tier: 'light' })),
    ]
    const reported = await $.tool.call({ tool: PROGRESS, title: 'Odd input', phase: 'delegate', tasks, total: 1e9 } as never)
    expect(reported).toMatchObject({ result: 'ok: Tasks 0/200' })

    const bar = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    expect((await bar.find({ key: 'savvy-agents' }))?.props.label).toBe('×200')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'savvy-agents', props: pane })
    expect(await ui.find({ text: /Planned · 200/ })).toBeDefined()
    const drawn = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('')
    expect(drawn).not.toContain('native code')
    expect(drawn).not.toContain('[object')
  })

  // The orchestrator closes the flow with `finished: true`; a later call that brings
  // no flow of its own still reports the one that closed, instead of resetting it.
  test(`${surface}: a bare report after the close keeps the finished flow`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))

    const planned = await $.tool.call({ tool: PROGRESS, title: 'Closing flow', phase: 'delegate', total: 4, done: 3 } as never)
    expect(planned).toMatchObject({ result: 'ok: Tasks 3/4' })
    expect(await $.tool.call({ tool: PROGRESS, finished: true } as never)).toMatchObject({ result: 'ok: Done' })
    expect(await $.tool.call({ tool: PROGRESS, done: 4 } as never)).toMatchObject({ result: 'ok: Done' })

    // `finished: false` reopens that same flow: its title and the total it closed with.
    expect(await $.tool.call({ tool: PROGRESS, finished: false } as never)).toMatchObject({ result: 'ok: Tasks 4/4' })
    expect(await draws($, surface, /Closing flow/)).toBe(true)
  })

  test(`${surface}: a flow brought after the close starts over`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))

    await $.tool.call({ tool: PROGRESS, title: 'Closing flow', phase: 'delegate', total: 4, done: 3 } as never)
    await $.tool.call({ tool: PROGRESS, finished: true } as never)

    const second = await $.tool.call({ tool: PROGRESS, title: 'Fresh flow', phase: 'delegate', total: 2 } as never)
    expect(second).toMatchObject({ result: 'ok: Tasks 0/2' })
    expect(await draws($, surface, /Fresh flow/)).toBe(true)
    expect(await draws($, surface, /Closing flow/)).toBe(false)
  })

  // The stored title is clipped, so the incoming one is clipped before the two are compared.
  test(`${surface}: a title past the cap is still the same flow`, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const long = 'L'.repeat(500)

    const first = await $.tool.call({ tool: PROGRESS, title: long, phase: 'delegate', total: 4, done: 2 } as never)
    expect(first).toMatchObject({ result: 'ok: Tasks 2/4' })

    // Repeating the long title keeps the counters instead of starting over at 0/0.
    expect(await $.tool.call({ tool: PROGRESS, title: long } as never)).toMatchObject({ result: 'ok: Tasks 2/4' })

    const started = await $.tool.call({ tool: PROGRESS, title: 'Another flow', phase: 'delegate', total: 3 } as never)
    expect(started).toMatchObject({ result: 'ok: Tasks 0/3' })
  })
}

// A plugin name of its own starts with `savvy-`, so only the agent's name past the
// `<plugin>:` prefix tells a worker of the flow from any other agent beside it.
test('spawn: a plugin-mate that is not a savvy worker is left to itself', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  const prompts: string[] = []
  on('agent.spawn', (_$, e) => {
    prompts.push(e.prompt)
    return { model: 'claude-opus-5', agentId: `a${prompts.length}` }
  })
  const spawn = (subagentType: string) =>
    $.agent.spawn({
      tool_use_id: `t${prompts.length + 1}`,
      prompt: 'p',
      description: subagentType,
      subagentType,
      provider: 'engine',
      parentModel: 'claude-opus-5',
      background: false,
      fork: false,
    } as never)

  await spawn('savvy-flow:general-purpose')
  expect(opened).toEqual([])
  expect(prompts).toEqual(['p'])

  await spawn('savvy-flow:savvy-careful')
  expect(prompts[1]).toContain(STEP)
  expect(opened).toEqual(['savvy-agents'])
})
