import type { RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the progress bar stacks on the bands beneath instead of hiding them`, async ($, on) => {
    // Stands in for next-steps / cache-keeper drawing beneath savvy-progress.
    on('ui.render', ($, e) => {
      const { Box, Button } = $.ui.resolve(e)
      return h(Box, {}, h(Button, { key: 'beneath', label: 'other mod', onPress: () => {} })) as RenderElement
    })

    const idle = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND })
    expect(await idle.findAll({ key: 'beneath' })).toHaveLength(1)
    expect(await idle.findAll({ key: 'savvy-dismiss' })).toHaveLength(0)

    await $.tool.call({ tool: 'mcp__savvy-progress__progress', title: 'Demo flow', total: 2, phase: 'delegate' } as never)

    const active = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND })
    expect(await active.findAll({ key: 'savvy-dismiss' })).toHaveLength(1)
    expect(await active.findAll({ key: 'beneath' })).toHaveLength(1)
  })
}
