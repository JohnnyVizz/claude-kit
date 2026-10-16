import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// Starts a session with the engine's answers stubbed; resolves to the panes it opened.
async function startSession($: Engine, on: On): Promise<string[]> {
  const opened: string[] = []
  mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__savvy-progress__${e.name}` } }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  return opened
}

// autoOpen 'always' opens the panel as the session starts.
test('always: the panel opens when a session starts', { options: { autoOpen: 'always' } }, async ($, on) => {
  expect(await startSession($, on)).toEqual(['savvy-agents'])
})

for (const autoOpen of ['savvy', 'any']) {
  test(`${autoOpen}: the panel stays shut at session start`, { options: { autoOpen } }, async ($, on) => {
    expect(await startSession($, on)).toEqual([])
  })
}
