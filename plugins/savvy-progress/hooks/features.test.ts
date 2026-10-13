import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'savvy-agents',
  props: { title: 'Agents', isFocused: false, bodyColumns: 70, placement: 'dock' },
} as const

// What the engine answers beneath the mod: a clock, panes that open, session
// figures the test moves, toasts it records, and an empty band.
const engine = (on: On) => {
  const clock = mock.clock(on)
  const figures = { cost: 1, ctx: 10 }
  const toasts: string[] = []
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
  on('session.usage', async () =>
    ({ value: { context: { percent: figures.ctx }, rateLimits: [], cost: { usd: figures.cost } } }) as never,
  )
  on('session.start', async () => ({ cwd: '/' }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('settings.read', async () => ({ value: {} }) as never)
  on('env.get', async () => ({ value: undefined }) as never)
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  return { clock, figures, toasts }
}

// The mod's clock ticks from session.start, as in a session.
const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

const progress = (input: Record<string, unknown>) => ({ tool: 'mcp__savvy-progress__progress', ...input }) as never

test('a finished step shows how long it took and what it cost', async ($, on) => {
  const { clock, figures } = engine(on)
  await start($)
  await $.tool.call(progress({ title: 'Cost', tasks: [{ title: 'Dig', status: 'active' }, { title: 'Fill', status: 'pending' }] }))
  await clock.advance(134_000)
  figures.cost = 1.42
  figures.ctx = 18
  await $.tool.call(progress({ tasks: [{ title: 'Dig', status: 'done' }, { title: 'Fill', status: 'active' }] }))
  figures.cost = 1.5

  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', ...PANE } as never)
  const alt = async (n: number) =>
    String((await ui.findAll({ type: 'Svg' })).find(s => String(s.props.alt).startsWith(`${n}. `))?.props.alt)
  expect(await alt(1)).toContain('complete · 2:14, +$0.42 · +8% context')
  // The active step counts from its own start, live.
  await clock.advance(5_000)
  expect(await alt(2)).toContain('+$0.08')
  await ui.unmount()
})

test('a background command that fails is announced once', async ($, on) => {
  const { clock, toasts } = engine(on)
  let output = 'building 3/10\n'
  on('tool.call', { tool: 'Bash' }, async () =>
    ({ result: { backgroundTaskId: 'b1' }, text: 'Command running in background with ID: b1. Output is being written to: /tmp/b1.out' }) as never,
  )
  on('fs.stat', async () => ({ value: { size: output.length, mtimeMs: clock.now() } }) as never)
  on('fs.read', async () => ({ value: output }) as never)
  await start($)

  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build the app', run_in_background: true } as never)
  await clock.advance(1_000)
  expect(toasts).toEqual([])
  output += 'error: missing header\n[exited with code 2]\n'
  await clock.advance(1_000)
  await clock.advance(1_000)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('✗ Build the app: failed')
  expect(toasts[0]).toContain('error: missing header')
})

test('a quiet background command is announced once per silence', async ($, on) => {
  const { clock, toasts } = engine(on)
  on('tool.call', { tool: 'Bash' }, async () =>
    ({ result: { backgroundTaskId: 'q1' }, text: 'Command running in background with ID: q1. Output is being written to: /tmp/q1.out' }) as never,
  )
  on('fs.stat', async () => ({ value: { size: 5, mtimeMs: 0 } }) as never)
  on('fs.read', async () => ({ value: 'hello' }) as never)
  await start($)

  await $.tool.call({ tool: 'Bash', command: 'serve', description: 'Serve', run_in_background: true } as never)
  await clock.advance(65_000)
  expect(toasts.filter(t => t.startsWith('⏳ Serve'))).toHaveLength(1)
})

test('a new flow drops background commands that finished before it, keeps running ones', async ($, on) => {
  const { clock } = engine(on)
  const outputs: Record<string, string> = { '/tmp/old.out': 'done\n[exited with code 0]\n', '/tmp/live.out': 'working 1/9\n' }
  for (const id of ['old', 'live']) {
    on('tool.call', { tool: 'Bash', description: id } as never, async () =>
      ({ result: { backgroundTaskId: id }, text: `Command running in background with ID: ${id}. Output is being written to: /tmp/${id}.out` }) as never,
    )
  }
  on('fs.stat', async (_$, e) => ({ value: { size: (outputs[(e as { path: string }).path] ?? '').length, mtimeMs: clock.now() } }) as never)
  on('fs.read', async (_$, e) => ({ value: outputs[(e as { path: string }).path] ?? '' }) as never)
  await start($)

  await $.tool.call(progress({ title: 'Earlier work', tasks: [{ title: 'Install', status: 'active' }] }))
  await $.tool.call({ tool: 'Bash', command: 'brew install x', description: 'old', run_in_background: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'serve', description: 'live', run_in_background: true } as never)
  await clock.advance(1_000)
  await clock.advance(1_000)

  await $.tool.call(progress({ title: 'New work', tasks: [{ title: 'Design', status: 'active' }] }))
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', ...PANE } as never)
  const alts = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
  expect(alts.some(a => a.startsWith('old:'))).toBe(false)
  expect(alts.some(a => a.startsWith('live:'))).toBe(true)
  await ui.unmount()
})

test('a flow that just finished celebrates in its last step\'s costume', async ($, on) => {
  engine(on)
  await $.tool.call(progress({ title: 'Party', tasks: [{ title: 'Ship', status: 'active', avatar: 'racer' }] }))
  await $.tool.call(progress({ finished: true }))
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: { bodyColumns: 120, hasSurvey: false } } as never)
  const bar = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(bar).toContain('class="c-light party"')
  expect(bar).toContain('class="cf ')
  await ui.unmount()
})
