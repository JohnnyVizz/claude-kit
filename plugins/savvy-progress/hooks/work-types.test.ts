import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'savvy-progress'
const STEP = 'mcp__savvy-progress__step'
const pane = { title: '', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} }

// Spawns one subagent per [type, description], with no flow reported; resolves to the prompts the engine got.
async function spawn($: Engine, on: On, runs: readonly (readonly [type: string, description: string])[]) {
  mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', () => ({ text: '' }) as never)
  const prompts: string[] = []
  let n = 0
  on('agent.spawn', (_$, e) => {
    prompts.push(e.prompt)
    n += 1
    return { model: 'claude-haiku-5-5', agentId: `a${n}` }
  })
  for (const [i, [type, description]] of runs.entries()) {
    await $.agent.spawn({ tool_use_id: `t${i}`, prompt: 'Do the thing.', description, subagentType: type, provider: 'engine', parentModel: 'claude-haiku-5-5', background: true, fork: false } as never)
  }
  return prompts
}

const paneSvg = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: pane })
  return (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('')
}

const CASES = [
  ['Explore', 'Map the auth flow', 'explore'],
  ['general-purpose', 'Review the payment diff', 'review'],
  ['general-purpose', 'Fix the login bug', 'build'],
  ['general-purpose', 'Run the failing tests', 'test'],
  ['general-purpose', 'Research caching options', 'research'],
  ['general-purpose', 'Draft the release notes', 'write'],
  ['Plan', 'Lay out the migration', 'plan'],
  ['claude-security:scan-verifier', 'Vote on finding 3', 'secure'],
] as const

test('each crab dresses for its work', async ($, on) => {
  await spawn($, on, CASES.map(([type, description]) => [type, description] as const))
  const drawn = await paneSvg($)
  for (const [, , work] of CASES) expect(drawn).toContain(`class="c-${work} run act"`)
  // The row says the work in words too.
  expect(drawn).toContain('review')
})

test('with no work to read, a savvy worker keeps its tier and anything else the plain crab', async ($, on) => {
  await spawn($, on, [['savvy-careful', 'Slow worker A'], ['general-purpose', 'Slow worker B']])
  const drawn = await paneSvg($)
  expect(drawn).toContain('class="c-careful run act"')
  expect(drawn).toContain('class="c-other run"')
})

test('every subagent is asked to report steps; savvy workers get their own brief', async ($, on) => {
  const [general, savvy] = await spawn($, on, [['general-purpose', 'Fix it'], ['savvy-light', 'Fix it too']])
  expect(general).toContain(`if the \`${STEP}\` tool is available to you`)
  expect(savvy).toContain('before any other work')
  expect(savvy).not.toContain('is available to you')
})

test('stepReports savvy leaves other subagents unbriefed', { options: { stepReports: 'savvy' } }, async ($, on) => {
  const [general] = await spawn($, on, [['general-purpose', 'Fix it']])
  expect(general).toBe('Do the thing.')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: with no flow reported, the bar follows the running subagents`, async ($, on) => {
    await spawn($, on, [['general-purpose', 'Fix it'], ['Explore', 'Find it']])
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    const text = surface === 'desktop' ? (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('') : ''
    if (surface === 'desktop') expect(text).toContain('Tasks 0/2')
    else expect(await ui.find({ text: /Tasks 0\/2/ })).toBeDefined()
    // Nothing is stored for it, so there is nothing to dismiss.
    expect(await ui.find({ key: 'savvy-dismiss' })).toBeUndefined()
    await ui.unmount()

    // One finishes: it counts as done in the same batch.
    await ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId: 'a1', reason: 'answer', answer: 'ok' })
    const after = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    if (surface === 'desktop') expect((await after.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('')).toContain('Tasks 1/2')
    else expect(await after.find({ text: /Tasks 1\/2/ })).toBeDefined()
    await after.unmount()

    await ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId: 'a2', reason: 'answer', answer: 'ok' })
    // The last one finishes: the subagents' bar gives way to the main session's ready row.
    const ready = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band })
    if (surface === 'desktop') expect((await ready.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('')).toContain('Ready')
    else expect(await ready.find({ text: /Ready/ })).toBeDefined()
  })
}
