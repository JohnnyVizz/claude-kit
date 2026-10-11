import { expect, mock, test } from 'claude-code/testing'

const RELAY = 'node "C:/Users/k/.claude/skills/codex-delegate/scripts/relay.mjs"'
const CONFIG = JSON.stringify({ lanes: { tests: { implementer: 'codex', model: 'gpt-x', effort: 'medium' } } })

type World = { tool?: (e: any) => unknown; files?: Record<string, string> }

function world(on: any, w: World = {}) {
  mock.env(on, { USERPROFILE: 'C:/Users/k' })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on)
  on('session.cwd', () => ({ value: 'C:/Users/k/proj' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', (_$: any, e: any) => {
    const text = w.files?.[String(e.path).replace(/\\/g, '/')]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('tool.call', (_$: any, e: any) => (w.tool?.(e) ?? { result: { stdout: 'relay: ok (exit 0)', stderr: '' } }) as any)
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  return clock
}

const pane = (surface: 'terminal' | 'desktop') =>
  ({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } }) as any

const shown = async (ui: any): Promise<string> => JSON.stringify(await ui.drawn())

test('a codex-delegate launch adds a row with the lane, and the lane config gives model and effort', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = world(on, { files: { 'C:/Users/k/.config/delegate-skills/config.json': CONFIG } })
  await $.tool.call({ tool: 'Bash', command: `${RELAY} --brief brief.txt --lane tests`, description: 'Add the parser tests' } as any)
  await clock.settle()
  const ui = await $.ui.mount(pane('terminal'))
  await clock.settle()
  const text = await shown(ui)
  for (const word of ['Add the parser tests', 'codex', 'gpt-x', 'medium', 'lane tests']) expect(text).toContain(word)
  expect(text).not.toContain('ctx ')
  await ui.unmount()
})

test('flags win over the lane, and PowerShell launches of claude-delegate count too', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = world(on, { files: { 'C:/Users/k/.config/delegate-skills/config.json': CONFIG } })
  await $.tool.call({ tool: 'PowerShell', command: 'node C:\\Users\\k\\.claude\\skills\\claude-delegate\\scripts\\relay.mjs --brief b.txt --lane tests --model opus --effort high', description: 'Refactor the loader' } as any)
  await clock.settle()
  const ui = await $.ui.mount(pane('terminal'))
  await clock.settle()
  const text = await shown(ui)
  for (const word of ['Refactor the loader', 'claude-cli', 'opus', 'high']) expect(text).toContain(word)
  expect(text).not.toContain('gpt-x')
  await ui.unmount()
})

test('without a flag or a lane the model reads default; the desktop row wears the delegate costume', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = world(on)
  await $.tool.call({ tool: 'Bash', command: `${RELAY} --brief brief.txt`, description: 'Fix the flaky test' } as any)
  await clock.settle()
  const ui = await $.ui.mount(pane('desktop'))
  await clock.settle()
  const text = await shown(ui)
  expect(text).toContain('default')
  expect(text).toContain('c-codex')
  expect(text).toContain('#D4537E')
  await ui.unmount()
})

test('a relay that reports failure marks the row failed; other shell commands add no row', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = world(on, { tool: e => (String(e.command).includes('relay.mjs') ? { result: { stdout: 'relay: failed (exit 1)', stderr: '' } } : undefined) })
  await $.tool.call({ tool: 'Bash', command: 'git status' } as any)
  await clock.settle()
  const ui = await $.ui.mount(pane('terminal'))
  await clock.settle()
  expect(await shown(ui)).not.toContain('codex')
  await $.tool.call({ tool: 'Bash', command: `${RELAY} --brief brief.txt`, description: 'Break things' } as any)
  await clock.settle()
  const text = await shown(ui)
  expect(text).toContain('Break things')
  expect(text).toContain('"red"')
  await ui.unmount()
})

test('a background delegate stays running until its task notification arrives', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = world(on, { tool: () => ({ result: { stdout: '', stderr: '', backgroundTaskId: 'task-7' } }) })
  await $.tool.call({ tool: 'Bash', command: `${RELAY} --brief brief.txt`, description: 'Long job', run_in_background: true } as any)
  await clock.settle()
  const ui = await $.ui.mount(pane('terminal'))
  await clock.settle()
  expect(await shown(ui)).not.toContain('"green"')
  await $.prompt.submit({ text: '<task-notification><task-id>task-7</task-id><status>completed</status></task-notification>', wait: false } as any)
  await clock.settle()
  expect(await shown(ui)).toContain('"green"')
  await ui.unmount()
})
