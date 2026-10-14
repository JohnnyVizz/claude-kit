import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never } as const

async function session($: Engine, on: On) {
  mock.clock(on, { now: Date.parse('2026-10-10T02:00:00Z') })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  // Claude Code's own band beneath the mod.
  on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('agent.spawn', async (_, e) => ({ agentId: `a-${e.description}`, model: 'claude-haiku-5-5' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
}

const spawn = ($: Engine, description: string) =>
  $.agent.spawn({ subagentType: 'general-purpose', description, prompt: 'hi', tool_use_id: `t-${description}` } as never)

// How many bars titled "Agents" the band draws; with `press`, the bar's ✕ is pressed first.
async function bars($: Engine, press = false) {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', ...BAND })
  if (press) await ui.press({ key: 'savvy-dismiss' } as never)
  const found = await ui.findAll({ type: 'Text', text: /^Agents$/ })
  await ui.unmount()
  return found.length
}

test('bar: savvy (default): an ordinary subagent draws no bar', async ($, on) => {
  await session($, on)
  await spawn($, 'one')
  expect(await bars($)).toBe(0)
})

test('bar: any: no subagents, no bar', { options: { bar: 'any' } }, async ($, on) => {
  await session($, on)
  expect(await bars($)).toBe(0)
})

test('bar: any: an ordinary subagent draws the bar', { options: { bar: 'any' } }, async ($, on) => {
  await session($, on)
  await spawn($, 'one')
  expect(await bars($)).toBe(1)
})

test('bar: any: ✕ hides the bar until the next subagent starts', { options: { bar: 'any' } }, async ($, on) => {
  await session($, on)
  await spawn($, 'one')
  await bars($, true)
  expect(await bars($)).toBe(0)
  await spawn($, 'two')
  expect(await bars($)).toBe(1)
})
