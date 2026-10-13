import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'savvy-agents',
  props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock' },
} as const

// What the engine would answer beneath the mod: a clock, panes that open, and an
// empty band for the bar to sit above.
const engine = (on: On) => {
  mock.clock(on)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
}

const plan = (active: string) => ({
  tool: 'mcp__savvy-progress__progress',
  title: 'Avatar test',
  phase: 'delegate',
  tasks: [
    { title: 'Find the bug', status: active === 'Find the bug' ? 'active' : 'done', avatar: 'detective', summary: 'Reads the logs.' },
    { title: 'Fix the bug', status: active === 'Fix the bug' ? 'active' : 'pending', avatar: 'engineer' },
    { title: 'Ship it', status: 'pending' },
  ],
})

test('each solo step draws a crab in its chosen costume; the active one walks', async ($, on) => {
  engine(on)
  await $.tool.call(plan('Find the bug') as never)
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', ...PANE } as never)
  const svgs = await ui.findAll({ type: 'Svg' })
  const step = (n: number) => String(svgs.find(s => String(s.props.alt).startsWith(`${n}. `))?.props.source ?? '')

  expect(step(1)).toContain('class="c-heavy run"')
  expect(step(2)).toContain('class="c-careful"')
  expect(step(2)).toContain('opacity="0.45"')
  // No avatar given: one is picked from the title, the same every time.
  expect(step(3)).toMatch(/class="c-(heavy|careful|medium|light|explore|fable)"/)
  await ui.unmount()
})

test('the bar crab wears the active step\'s costume', async ($, on) => {
  engine(on)
  await $.tool.call(plan('Fix the bug') as never)
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: { bodyColumns: 120, hasSurvey: false } } as never)
  const bar = await ui.find({ type: 'Svg' })
  expect(String(bar?.props.source)).toContain('class="c-careful run"')
  await ui.unmount()
})

test('an unknown avatar falls back to a picked one', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Fallback', tasks: [{ title: 'Odd', status: 'active', avatar: 'constructor' }] } as never)
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', ...PANE } as never)
  expect(await ui.find({ type: 'Text', text: /1\. Odd/ })).toBeDefined()
  await ui.unmount()
})
