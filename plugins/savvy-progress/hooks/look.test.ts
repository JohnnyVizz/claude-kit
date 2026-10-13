import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'savvy-progress'
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

// The tier colors, as the panel draws them.
const COLOR = { fable: '#7F77DD', heavy: '#D85A30', careful: '#BA7517', medium: '#378ADD', light: '#1D9E75', other: '#888780' } as const

// One subagent of `type` on `model`; `effort` arrives with its first model request, as the engine reports it.
const worker = async ($: Engine, on: On, type: string, model: string, effort?: string) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model, agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.step', async function* () {
    const usage = { model, input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    return { turnId: 'turn', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Some work', subagentType: type, provider: 'engine', parentModel: model, background: false, fork: false } as never)
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ turnId: 'turn', index: 0, model, effort, messageCount: 1, agentId: 'a1' })
  for await (const _ of stream) void _
}

// The row of the one agent on the desktop: the color of its type line names the look.
const rowColor = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: pane })
  const row = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).find(src => src.includes('Some work')) ?? ''
  return Object.entries(COLOR).find(([, hex]) => row.includes(`<tspan fill="${hex}">`))?.[0]
}

const LOOKS: readonly (readonly [type: string, model: string, effort: string | undefined, look: keyof typeof COLOR])[] = [
  // A subagent that is not a savvy worker wears the tier its model and effort match.
  ['general-purpose', 'claude-fable-5-1', 'high', 'fable'],
  ['general-purpose', 'claude-opus-5-5', 'max', 'heavy'],
  ['general-purpose', 'claude-opus-5-5', 'xhigh', 'heavy'],
  ['general-purpose', 'claude-opus-5-5', 'high', 'careful'],
  ['general-purpose', 'claude-opus-5-5', 'medium', 'medium'],
  ['general-purpose', 'claude-opus-5-5', 'low', 'light'],
  ['general-purpose', 'claude-sonnet-5-5', 'high', 'medium'],
  ['general-purpose', 'claude-haiku-5-5', 'low', 'light'],
  // Opus with no effort seen, and a model outside the families, stay plain.
  ['general-purpose', 'claude-opus-5-5', undefined, 'other'],
  ['general-purpose', 'some-other-model', 'high', 'other'],
  // A savvy worker keeps its tier whatever it runs on; Explore keeps its own costume and color.
  ['savvy-light', 'claude-fable-5-1', 'max', 'light'],
  ['savvy-flow:savvy-heavy', 'claude-haiku-5-5', 'low', 'heavy'],
  ['Explore', 'claude-haiku-5-5', 'low', 'other'],
]

for (const [type, model, effort, look] of LOOKS) {
  test(`look: ${type} on ${model}${effort ? ` at ${effort}` : ''} is drawn as ${look}`, async ($, on) => {
    await worker($, on, type, model, effort)
    expect(await rowColor($)).toBe(look)
  })
}

// The terminal has no costumes: the same look colors the agent's status glyph and progress bar.
test('look: the terminal row takes the same color', async ($, on) => {
  await worker($, on, 'general-purpose', 'claude-haiku-5-5', 'low')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: pane })
  const colored = (await ui.findAll({ type: 'Text' })).filter(el => el.props.color === COLOR.light)
  expect(colored.length).toBeGreaterThan(0)
})
