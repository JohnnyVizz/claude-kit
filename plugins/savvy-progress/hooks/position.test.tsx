import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never } as const
const STATUS = { component: 'StatusLine', props: { text: 'my status', isManaged: false, isWorking: false, maxRows: 5, columns: 120 } as never } as const

async function session($: Engine, on: On) {
  mock.clock(on, { now: Date.parse('2026-10-10T02:00:00Z') })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Ship it', total: 4, done: 1, phase: 'delegate' } as never)
}

async function where($: Engine) {
  const count = async (spec: typeof BAND | typeof STATUS) => {
    const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', ...spec })
    const n = (await ui.findAll({ type: 'Text', text: /^Tasks 1\/4$/ })).length
    await ui.unmount()
    return n
  }
  return { above: await count(BAND), below: await count(STATUS) }
}

test('default: the bar is above the prompt only', async ($, on) => {
  await session($, on)
  expect(await where($)).toEqual({ above: 1, below: 0 })
})

test('below: the bar moves to the status line', { options: { barPosition: 'below' } }, async ($, on) => {
  await session($, on)
  expect(await where($)).toEqual({ above: 0, below: 1 })
})

test('both: the bar is drawn in each place', { options: { barPosition: 'both' } }, async ($, on) => {
  await session($, on)
  expect(await where($)).toEqual({ above: 1, below: 1 })
})
