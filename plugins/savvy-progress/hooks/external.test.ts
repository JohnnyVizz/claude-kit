import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'savvy-progress'
const PROGRESS = 'mcp__savvy-progress__progress'
const EXTERNAL = 'mcp__savvy-progress__external'
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

const REVIEW = 'Review the parser with Gemini'

// A flow with one Claude task and one review by another CLI, reported as tier `external`.
async function flow($: Engine, on: On) {
  const clock = mock.clock(on, { now: Date.parse('2026-11-08T10:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.tool.call({
    tool: PROGRESS,
    title: 'Ship the parser',
    phase: 'delegate',
    tasks: [
      { title: 'Write the parser', tier: 'careful' },
      { title: REVIEW, tier: 'external', after: [1] },
    ],
  } as never)
  return clock
}

const external = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: EXTERNAL, ...input } as never)

type Node = { props?: { label?: unknown; source?: unknown }; children?: unknown[] }

// A tree's text in reading order, a Text's pieces joined: labels and Svg sources each on a line.
const textOf = (n: unknown): string => {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (!n || typeof n !== 'object') return ''
  const { props, children = [] } = n as Node
  const own = [props?.label, props?.source].filter(v => typeof v === 'string').join('\n')
  return [own, children.map(textOf).join('')].filter(Boolean).join('\n')
}

// Everything the pane drew, desktop Svg sources included.
const drawn = async ($: Engine, surface: 'terminal' | 'desktop') => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'savvy-agents', props: pane })
  const text = textOf(await ui.drawn())
  await ui.unmount()
  return text
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: an external review goes from planned to running to done`, async ($, on) => {
    await flow($, on)
    expect(await drawn($, surface)).toContain('Planned · 2')

    const started = await external($, { id: 'gemini', description: REVIEW, model: 'Gemini 3 Flash · agy', status: 'running' })
    expect(started).toMatchObject({ result: `ok: ${REVIEW} running` })
    const running = await drawn($, surface)
    expect(running).toContain('Running · 1')
    // The planned row gave way to the run.
    expect(running).toContain('Planned · 1')
    expect(running).toContain('Gemini 3 Flash · agy')
    expect(running).toContain('external')
    // The engine sees no tokens for it: no context, token count or cost on its row.
    expect(running).not.toContain('ctx')
    // A row's stats read "≈$0.00  0:00"; the header's total is drawn apart from any time.
    expect(running).not.toMatch(/≈\$0\.00\s+0:00/)
    if (surface === 'desktop') expect(running).toContain('c-external run')

    await external($, { id: 'gemini', status: 'running', done: 1, total: 3, note: 'reading the diff' })
    expect(await drawn($, surface)).toContain('1/3')

    expect(await external($, { id: 'gemini', status: 'done' })).toMatchObject({ result: `ok: ${REVIEW} done` })
    const done = await drawn($, surface)
    expect(done).toContain('Finished · 1')
    expect(done).not.toContain('Running · ')
    expect(done).toContain('Planned · 1')
    expect(done).toContain('Gemini 3 Flash · agy')
  })
}

test('an external run takes the same planned row however its title is cased or spaced', async ($, on) => {
  await flow($, on)
  await external($, { id: 'g', description: '  review the PARSER, with gemini ', status: 'running' })
  expect(await drawn($, 'terminal')).toContain('Planned · 1')
})

test('a run whose title matches no planned task still shows, and the result says so', async ($, on) => {
  await flow($, on)
  const result = await external($, { id: 'g', description: 'Gemini review', status: 'running' })
  expect(result).toMatchObject({ result: 'ok: Gemini review running (no planned task has this title)' })
  const text = await drawn($, 'terminal')
  expect(text).toContain('Gemini review')
  expect(text).toContain('Planned · 2')
})

test('a failed run shows failed, and reporting the id running again starts round 2', async ($, on) => {
  await flow($, on)
  await external($, { id: 'gemini', description: REVIEW, status: 'running' })
  await external($, { id: 'gemini', status: 'failed' })
  expect(await drawn($, 'desktop')).toContain('#D0453F')

  await external($, { id: 'gemini', status: 'running' })
  const text = await drawn($, 'terminal')
  expect(text).toContain('round 2')
  expect(text).toContain('Running · 1')
  expect(text).toContain('Finished · 1')
})

test('a subagent cannot report an external worker', async ($, on) => {
  await flow($, on)
  const hijack = await $.tool.call({ tool: EXTERNAL, agentId: 'a1', id: 'x', description: REVIEW, status: 'done' } as never)
  expect(hijack).toMatchObject({ result: 'ignored: only the main session reports external workers' })
  expect(await drawn($, 'terminal')).toContain('Planned · 2')
})

// The schema is advice to the model: a call outside it is refused or bounded, never drawn raw.
test('input outside the schema is refused or bounded', async ($, on) => {
  await flow($, on)
  expect(await external($, { description: REVIEW, status: 'running' })).toMatchObject({ result: 'ignored: an id is required' })
  expect(await external($, { id: 'g', status: 'paused' })).toMatchObject({ result: 'ignored: status must be running, done or failed' })
  expect(await external($, { id: 'g', status: '__proto__' })).toMatchObject({ result: 'ignored: status must be running, done or failed' })

  await external($, { id: 'g'.repeat(500), description: 'D'.repeat(500), model: 'M'.repeat(500), note: 'N'.repeat(500), status: 'running', done: 1e12, total: 1e12 })
  const text = await drawn($, 'desktop')
  expect(text).not.toContain('D'.repeat(200))
  expect(text).not.toContain('M'.repeat(100))
  expect(text).not.toContain('1000000000000')
  expect(text).not.toContain('[object')
  expect(text).not.toContain('NaN')
})

test('a settled run keeps its end: a second done is ignored and the time stays', async ($, on) => {
  const clock = await flow($, on)
  await external($, { id: 'gemini', description: REVIEW, status: 'running' })
  await clock.advance(30_000)
  await external($, { id: 'gemini', status: 'done' })
  await clock.advance(60_000)
  expect(await external($, { id: 'gemini', status: 'done' })).toMatchObject({
    result: `ignored: ${REVIEW} already done; report running to start a new round`,
  })
  expect(await external($, { id: 'gemini', status: 'failed' })).toMatchObject({ result: `ignored: ${REVIEW} already done; report running to start a new round` })
  const text = await drawn($, 'terminal')
  expect(text).toContain('0:30')
  expect(text).toContain('✓')
  expect(text).not.toContain('round 2')
})

test('an update keeps its row in place among other running workers', async ($, on) => {
  await flow($, on)
  await external($, { id: 'a', description: 'Worker A', status: 'running' })
  await external($, { id: 'b', description: 'Worker B', status: 'running' })
  const before = await drawn($, 'terminal')
  await external($, { id: 'a', status: 'running', done: 1, total: 2 })
  const after = await drawn($, 'terminal')
  expect(after.indexOf('Worker B') < after.indexOf('Worker A')).toBe(before.indexOf('Worker B') < before.indexOf('Worker A'))
})

test('the last note stays through updates without one and on the finished row; an empty note clears it', async ($, on) => {
  await flow($, on)
  await external($, { id: 'g', description: REVIEW, status: 'running', done: 1, total: 3, note: 'reading the diff' })
  await external($, { id: 'g', status: 'running', done: 2 })
  expect(await drawn($, 'terminal')).toContain('2/3 reading the diff')
  await external($, { id: 'g', status: 'done', done: 3 })
  for (const surface of ['terminal', 'desktop'] as const) expect(await drawn($, surface)).toContain('reading the diff')

  await external($, { id: 'h', description: 'Other review', status: 'running', done: 1, total: 2, note: 'starting' })
  await external($, { id: 'h', status: 'running', note: '' })
  expect(await drawn($, 'terminal')).not.toContain('starting')
})

test('a total of 0 keeps the earlier plan', async ($, on) => {
  await flow($, on)
  await external($, { id: 'g', description: REVIEW, status: 'running', done: 1, total: 3 })
  await external($, { id: 'g', status: 'running', done: 2, total: 0 })
  expect(await drawn($, 'terminal')).toContain('2/3')
})

// The panel keeps the newest 200 runs. Rounds 1-3 of one id, then enough other runs
// to trim round 1: round 4 must not reuse round 3's row, which would drop round 3
// (and leave round 2 as the finished one shown).
test('a new round never replaces a shown round after older ones are trimmed', async ($, on) => {
  await flow($, on)
  for (let r = 0; r < 3; r++) for (const status of ['running', 'done'] as const) await external($, { id: 'lint', description: 'Lint the parser', status })
  for (let i = 0; i < 198; i++) await external($, { id: `o${i}`, description: `Other ${i}`, status: 'done' })
  await external($, { id: 'lint', status: 'running' })
  const text = await drawn($, 'terminal')
  // Round 3 finished and the new run (numbered 3 from the rounds still listed) running.
  expect(text.split('Lint the parser').length - 1).toBe(2)
  expect(text.split('round 3').length - 1).toBe(2)
  expect(text).not.toContain('round 2')
})
