// Workers run in the background: the Agent call returns as the worker
// starts, and the band still shows the worker as handed out while it runs.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PROGRESS = 'mcp__savvy-progress__progress'
const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }

async function session($: Engine, on: On, plan: Record<string, unknown>) {
  mock.clock(on, { now: Date.parse('2026-10-20T05:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${++n}` }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', ...plan } as never)
}

let calls = 0
const spawn = ($: Engine, description: string) =>
  $.agent.spawn({
    tool_use_id: `tu-${++calls}`,
    prompt: 'do it',
    description,
    subagentType: 'savvy-light',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  } as never)

const finish = ($: Engine, agentId: string) =>
  $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: `t-${agentId}`, reason: 'answer', agentId })

/** The faint layer of the desktop bar: tasks handed to workers, not yet accepted. */
async function handedOut($: Engine): Promise<number> {
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'AbovePrompt', props: band })
  const row = String((await ui.find({ type: 'Svg' }))?.props.source)
  await ui.unmount()
  const faint = /opacity="0\.45">(.*?)<\/g>/.exec(row)?.[1] ?? ''
  return (faint.match(/<rect/g) ?? []).length
}

test('background workers fill the faint layer while they run, and leave it when they end', async ($, on) => {
  const tasks = [
    { title: 'Task A', tier: 'light' },
    { title: 'Task B', tier: 'light' },
  ]
  await session($, on, { tasks })
  expect(await handedOut($)).toBe(0)
  await spawn($, 'Task A')
  await spawn($, 'Task B')
  expect(await handedOut($)).toBeGreaterThan(0)
  await finish($, 'a1')
  await finish($, 'a2')
  expect(await handedOut($)).toBe(0)
})

test('without a plan the label counts the running workers', async ($, on) => {
  await session($, on, {})
  await spawn($, 'Task A')
  await spawn($, 'Task B')
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'terminal', component: 'AbovePrompt', props: band })
  expect(await ui.find({ type: 'Text', text: 'Tasks 2 running' })).toBeDefined()
  await ui.unmount()
})
