import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never } as const
const BELOW = 'next: run the tests'

/** A session with a plugin beneath savvy-progress that draws one row in the band. */
async function session($: Engine, on: On) {
  mock.clock(on, { now: Date.parse('2026-10-09T02:00:00Z') })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Text', key: 'below-marker', props: {}, children: [BELOW] }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
}

async function band($: Engine, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface, ...BAND })
  const below = await ui.findAll({ type: 'Text', text: new RegExp(`^${BELOW}$`) })
  const dismiss = (await ui.findAll({ type: 'Button' })).filter(b => b.key === 'savvy-dismiss')
  await ui.unmount()
  return { below: below.length, bar: dismiss.length }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the progress bar keeps what the plugins beneath draw under it`, async ($, on) => {
    await session($, on)
    await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Ship it', total: 4, done: 1, phase: 'delegate' } as never)
    expect(await band($, surface)).toEqual({ below: 1, bar: 1 })
  })
}

test('with no flow, the band is exactly what the plugins beneath draw', async ($, on) => {
  await session($, on)
  expect(await band($, 'terminal')).toEqual({ below: 1, bar: 0 })
})
