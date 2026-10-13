import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'savvy-agents',
  props: { title: 'Agents', isFocused: false, bodyColumns: 70, placement: 'dock' },
} as const

// What the engine answers beneath the mod: a clock, panes that open, the calls
// session.start makes, and one background command's output file.
const engine = (on: On, bash: { result: unknown; text: string }) => {
  const clock = mock.clock(on)
  const file = { text: 'serving\n' }
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('session.start', async () => ({ cwd: '/' }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('settings.read', async () => ({ value: {} }) as never)
  on('env.get', async () => ({ value: undefined }) as never)
  on('tool.call', { tool: 'Bash' }, async () => bash as never)
  on('fs.stat', async () => ({ value: { size: file.text.length, mtimeMs: clock.now() } }) as never)
  on('fs.read', async () => ({ value: file.text }) as never)
  return { clock, file }
}

const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

const rows = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', ...PANE } as never)
  const svgs = (await ui.findAll({ type: 'Svg' })).map(s => ({ alt: String(s.props.alt), source: String(s.props.source) }))
  await ui.unmount()
  return svgs
}

test('a command that only prints the words is not a background command', async ($, on) => {
  // A foreground command whose output quotes what the engine says for a background one.
  const { clock } = engine(on, {
    result: { stdout: 'x' },
    text: 'grep: Command running in background with ID: fake. Output is being written to: /tmp/fake.out',
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'grep -r background .', description: 'Search for background' } as never)
  await clock.advance(1_000)
  expect((await rows($)).some(r => r.alt.startsWith('Search for background'))).toBe(false)
})

test('a finished command says how it ended and stops moving', async ($, on) => {
  const { clock, file } = engine(on, {
    result: { backgroundTaskId: 's1' },
    text: 'Command running in background with ID: s1. Output is being written to: /tmp/s1.out',
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'serve', description: 'Serve the page', run_in_background: true } as never)
  await clock.advance(1_000)
  file.text += '[killed]\n'
  await clock.advance(1_000)
  const row = (await rows($)).find(r => r.alt.startsWith('Serve the page'))
  expect(row?.source).toContain('stopped · ')
  expect(row?.source).not.toContain('<animate')
})
