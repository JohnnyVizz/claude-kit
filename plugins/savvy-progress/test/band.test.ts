import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'savvy-progress',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

function engine(on: On, hasOtherBand: boolean) {
  mock.store(on)
  mock.clock(on)
  on('ui.open', () => ({}))
  on('ui.render', ($, e) => {
    const { Box, Button } = $.ui.resolve(e)
    return hasOtherBand
      ? Box({ children: [Button({ key: 'other-band', label: 'Next step', onPress: () => {} })] })
      : Box({})
  })
}

test('keeps another plugin band under the bar', async ($, on) => {
  engine(on, true)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Band test', total: 2, done: 1 })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'savvy-dismiss' })).toBeDefined()
    expect(await ui.find({ key: 'other-band' })).toBeDefined()
    await ui.unmount()
  }
})

test('draws the bar alone over an empty band, and passes once dismissed', async ($, on) => {
  engine(on, false)
  await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Band test', total: 2, done: 1 })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'savvy-dismiss' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'savvy-dismiss' })
  expect(await ui.find({ key: 'savvy-dismiss' })).toBeUndefined()
  await ui.unmount()
})
