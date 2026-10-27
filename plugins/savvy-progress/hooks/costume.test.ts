import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'savvy-progress'
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

// Agents of these types on `model`; each reports one model request at `effort`.
const crew = async ($: Engine, on: On, agents: { type: string; model: string; effort?: string }[]) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let n = 0
  on('agent.spawn', () => ({ model: agents[n]?.model ?? 'claude-opus-5-5', agentId: `a${++n}` }))
  on('turn.step', async function* (_$, e) {
    const model = (e as { model: string }).model
    return { turnId: 'turn', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model, input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never
  })
  for (const [i, a] of agents.entries()) {
    await $.agent.spawn({ tool_use_id: `t${i}`, prompt: 'p', description: `${a.type} work`, subagentType: a.type, provider: 'engine', parentModel: a.model, background: true, fork: false } as never)
    if (a.effort) {
      const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ turnId: 'turn', index: 0, model: a.model, effort: a.effort, messageCount: 1, agentId: `a${i + 1}` })
      for await (const _ of stream) void _
    }
  }
  return $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: pane })
}

const colorOfType = async (ui: Awaited<ReturnType<typeof crew>>, type: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${type}$`) }))?.props.color

const EFFORTS: readonly (readonly [effort: string, color: string])[] = [
  ['max', '#D85A30'],
  ['xhigh', '#D85A30'],
  ['high', '#BA7517'],
  ['medium', '#378ADD'],
  ['low', '#1D9E75'],
]

for (const [effort, color] of EFFORTS) {
  test(`effort ${effort} dresses an agent as its tier`, async ($, on) => {
    const ui = await crew($, on, [{ type: 'general-purpose', model: 'claude-opus-5-5', effort }])
    expect(await colorOfType(ui, 'general-purpose')).toBe(color)
  })
}

test('a Fable model is fable at any effort; no effort seen is other', async ($, on) => {
  const ui = await crew($, on, [
    { type: 'Plan', model: 'claude-fable-5-1', effort: 'low' },
    { type: 'general-purpose', model: 'claude-opus-5-5' },
  ])
  expect(await colorOfType(ui, 'Plan')).toBe('#7F77DD')
  expect(await colorOfType(ui, 'general-purpose')).toBe('#888780')
})

test('the costumes option wins over model and effort, and a plugin prefix is ignored', { options: { costumes: 'revisor=heavy, explorador=light, x=nonsense' } }, async ($, on) => {
  const ui = await crew($, on, [
    { type: 'ti:revisor', model: 'claude-haiku-5-5', effort: 'low' },
    { type: 'explorador', model: 'claude-opus-5-5', effort: 'high' },
    { type: 'x', model: 'claude-opus-5-5', effort: 'medium' },
  ])
  expect(await colorOfType(ui, 'ti:revisor')).toBe('#D85A30')
  expect(await colorOfType(ui, 'explorador')).toBe('#1D9E75')
  // An unknown costume falls back to the rule: medium effort.
  expect(await colorOfType(ui, 'x')).toBe('#378ADD')
})

test('a savvy tier keeps its own costume whatever the effort', async ($, on) => {
  const ui = await crew($, on, [{ type: 'savvy-careful', model: 'claude-opus-5-5', effort: 'low' }])
  expect(await ui.find({ type: 'Text', text: /^careful$/ })).toBeDefined()
})

// The language is read as the session starts: here from the locale, es_CO.
test('es: the panel speaks Spanish where the locale is Spanish', async ($, on) => {
  mock.clock(on)
  mock.env(on, { LANG: 'es_CO.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Trabajo', subagentType: 'general-purpose', provider: 'engine', parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: pane })
  expect(await ui.find({ type: 'Text', text: /En curso · 1/ })).toBeDefined()
})
