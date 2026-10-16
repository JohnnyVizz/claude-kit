import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'savvy-progress'
const PROGRESS = 'mcp__savvy-progress__progress'
const band = { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns: 96, scroll: { offset: 0, bodyRows: 4 }, view: {} }
const pane = { title: '', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

async function session($: Engine, on: On) {
  mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', async (_$, e) => ({ value: { tool: e.name } }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', async () => ({ cwd: '/r' }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `a${++n}` }))
  await $.session.start({ cwd: '/r', surface: 'desktop', isInteractive: true })
}

const spawn = ($: Engine, description: string, subagentType = 'general-purpose') =>
  $.agent.spawn({ tool_use_id: description, prompt: 'p', description, subagentType, provider: 'engine', parentModel: 'claude-haiku-5-5', background: true, fork: false } as never)

// The band's drawings in order: the bar first, then the crab.
const bandSvgs = async ($: Engine): Promise<string[]> => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band })
  try {
    return (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source))
  } finally {
    await ui.unmount()
  }
}

test('the bar is title, track, figures, then the crab beside the buttons', async ($, on) => {
  await session($, on)
  await spawn($, 'Fix the login bug')
  const [head, track, figures, crab, ...rest] = await bandSvgs($)
  expect(rest).toEqual([])
  expect(head).toContain('Agents')
  expect(track).toContain('Tasks 0/1')
  expect(figures).toContain('0%')
  expect([head, track, figures].join('')).not.toContain('class="c-')
  expect(crab).toContain('class="c-')
  // Every piece is centred on the row by the flex row: the text pieces are one row tall.
  for (const svg of [head, track, figures]) expect(svg).toContain('height="24"')
})

// The crab's grid is 28 units tall but its body and legs fill rows 10-26 (hats and props sit above),
// so centring the grid drew the body low. Its drawing centres the body instead: at scale 0.8 in a
// 28px box, body centre 17.5 lands on 14, the box's middle, which the row lines up with the text's.
test("the crab's body, not its grid, sits on the row's centre line", async ($, on) => {
  await session($, on)
  await spawn($, 'Slow worker')
  const crab = String((await bandSvgs($)).at(-1))
  expect(crab).toContain('height="28"')
  const [, y, scale] = /translate\([\d.]+,(-?[\d.]+)\) scale\(([\d.]+)\)/.exec(crab) ?? []
  expect(Math.round((Number(y) + 17.5 * Number(scale)) * 10) / 10).toBe(14)
})

test("the bar's crab acts out the newest running subagent's work, standing still", async ($, on) => {
  await session($, on)
  await spawn($, 'Fix the login bug')
  await spawn($, 'Run the failing tests')
  const crab = (await bandSvgs($)).at(-1)
  expect(crab).toContain('class="c-test run act"')
})

test("with nothing running, the bar's crab follows the flow's phase", async ($, on) => {
  await session($, on)
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'review', total: 2, done: 1 } as never)
  const crab = (await bandSvgs($)).at(-1)
  expect(crab).toContain('class="c-review')
})

test('a costumed crab in the panel acts in place; a plain one still walks', async ($, on) => {
  await session($, on)
  await spawn($, 'Fix the login bug')
  await spawn($, 'Slow worker')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: pane })
  const drawn = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('')
  expect(drawn).toContain('class="c-build run act"')
  expect(drawn).toContain('class="c-other run"')
})

// The bar used to count finished subagents only, so one long run held it at 0% to the end.
test("the bar's progress counts running subagents' reported steps", async ($, on) => {
  await session($, on)
  await spawn($, 'Fix the login bug')
  await $.tool.call({ tool: 'mcp__savvy-progress__step', agentId: 'a1', done: 1, total: 4 } as never)
  const [, track, figures] = await bandSvgs($)
  // The label still counts whole tasks; the fill and the percent move with the steps.
  expect(track).toContain('Tasks 0/1')
  expect(figures).toContain('25%')

  // In a reported flow, a running worker's steps count toward its planned task.
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 2, done: 1, tasks: [{ title: 'Done already', tier: 'light' }, { title: 'Fix the login bug', tier: 'light' }] } as never)
  const [, , reported] = await bandSvgs($)
  expect(reported).toContain('63%')
})

// The time left changes every second; sizing its drawing to the digits shown made every piece
// of the row shift (and the track redraw from scratch) once a second.
test('the figures and the track keep their width as the time left ticks', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', async (_$, e) => ({ value: { tool: e.name } }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', async () => ({ cwd: '/r' }) as never)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  await $.session.start({ cwd: '/r', surface: 'desktop', isInteractive: true })
  await spawn($, 'Fix the login bug')
  await clock.advance(60_000)
  // 1 of 2 steps in 1:00: the time left is the time spent.
  await $.tool.call({ tool: 'mcp__savvy-progress__step', agentId: 'a1', done: 1, total: 2 } as never)

  const widths = async () => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band })
    try {
      const svgs = await ui.findAll({ type: 'Svg' })
      return { track: svgs[1]?.props.width, figures: svgs[2]?.props.width, text: String(svgs[2]?.props.source) }
    } finally {
      await ui.unmount()
    }
  }
  const before = await widths()
  // ~1:00 left counts down to ~0:49 and then ~0:11 (narrow ones): different digits, same width.
  await clock.advance(11_000)
  const later = await widths()
  await clock.advance(38_000)
  const after = await widths()
  expect(before.text).toContain('~1:00 left')
  expect(later.text).toContain('~0:49 left')
  expect(after.text).toContain('~0:11 left')
  expect(later.text).not.toBe(before.text)
  expect(later.figures).toBe(before.figures)
  expect(after.figures).toBe(before.figures)
  expect(later.track).toBe(before.track)
})

// The liquid is the default look; the pixels are opt-in.
test('with no style picked, the track is the liquid', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 2, done: 1 } as never)
  const track = String((await bandSvgs($))[1])
  expect(track).toContain('class="edge"')
  expect(track).not.toContain('class="t0"')
})

test("pixels: the track's pixels twinkle each on its own beat, under a sweep of light", { options: { barStyle: 'pixels' } }, async ($, on) => {
  await session($, on)
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 2, done: 1 } as never)
  const [, track] = await bandSvgs($)
  expect(track).toContain('class="sheen"')
  const delays = new Set([...String(track).matchAll(/animation-delay:(-?[\d.]+)s/g)].map(([, d]) => d))
  expect(delays.size).toBeGreaterThan(20)
})

// Many steps in one test: room for a busy machine (5s is the default).
const SLOW = { timeoutMs: 15_000 }

// A run whose end never reached the mod stayed "running" for good, each one an open task:
// one real run at 3/7 steps beside three such ghosts read as 11% instead of 43%.
test("subagents Claude Code no longer lists stop counting as open tasks", SLOW, async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', async (_$, e) => ({ value: { tool: e.name } }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', async () => ({ cwd: '/r' }) as never)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `a${++n}` }))
  // Only the real run is still alive; a1..a3 ended without the mod hearing of it.
  on('agent.list', () => ({ value: [{ id: 'a4', description: 'Review the plan', type: 'general-purpose', status: 'running' }] }) as never)
  await $.session.start({ cwd: '/r', surface: 'desktop', isInteractive: true })
  for (const d of ['Old one', 'Old two', 'Old three']) await spawn($, d)
  await clock.advance(10 * 60_000)
  await spawn($, 'Review the plan')
  await $.tool.call({ tool: 'mcp__savvy-progress__step', agentId: 'a4', done: 3, total: 7 } as never)
  await clock.advance(2_000)

  const [, track, figures] = await bandSvgs($)
  expect(track).toContain('Tasks 0/1')
  expect(figures).toContain('43%')
})

// The bar redraws every second for its clock, and a redrawn image starts its animations over:
// each drawing carries the time, so every loop picks up where it would be instead of replaying.
test("the track's motion carries on across redraws instead of replaying its first second", async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 2, done: 1 } as never)
  const sheenDelay = async () => /class="sheen" style="animation-delay:(-[\d.]+)s"/.exec(String((await bandSvgs($))[1]))?.[1]
  const first = await sheenDelay()
  await clock.advance(700)
  const second = await sheenDelay()
  expect(first).toBeDefined()
  // 0.7s later, 0.7s further into the 2.4s sweep (wrapping round at the end).
  const step = Math.round(((Number(first) - Number(second)) * 100 + 240) % 240) / 100
  expect(step).toBe(0.7)
})

// The default style: the fill is a liquid with a rippling front edge, drifting ripples and rising bubbles.
test('liquid: the fill is a liquid with a rippling edge, ripples and bubbles, phased by the clock', { options: { barStyle: 'liquid' } }, async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 2, done: 1 } as never)
  const track = String((await bandSvgs($))[1])
  expect(track).toContain('class="edge"')
  expect(track).toContain('class="rip1"')
  expect(track).not.toContain('class="t0"')
  const bubbles = [...track.matchAll(/class="bub" style="animation-duration:([\d.]+)s;animation-delay:(-[\d.]+)s"/g)]
  expect(bubbles.length).toBeGreaterThan(2)
  expect(new Set(bubbles.map(([, , d]) => d)).size).toBe(bubbles.length)

  // The front edge sits at the fill's end: half of a 2-task bar.
  const width = Number(/<svg[^>]* width="(\d+)"/.exec(track)?.[1])
  const edgeX = Number(/class="edge"[^>]* d="M-2 -8 L([\d.]+)/.exec(track)?.[1])
  expect(Math.abs(edgeX - width / 2)).toBeLessThan(3)

  // A second later every loop has moved on with the clock.
  await clock.advance(1000)
  expect(String((await bandSvgs($))[1])).not.toBe(track)
})

test('liquid: a finished bar calms its liquid and lets the bubbles settle', { options: { barStyle: 'liquid' } }, async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 2, done: 2, finished: true } as never)
  const track = String((await bandSvgs($))[1])
  expect(track).toContain('class="edge"')
  expect(track).not.toContain('class="bub"')
})

// /bar-style picks the look from the prompt and remembers it across sessions.
test('/bar-style switches the track between pixels and liquid and remembers the choice', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  const saved: Record<string, unknown> = {}
  on('store.get', (_$, e) => ({ value: saved[e.key] }) as never)
  on('store.set', (_$, e) => {
    saved[e.key] = e.value
    return { value: undefined } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const run = (args: string) => $.command.run({ command: 'bar-style', args } as never) as Promise<{ text?: string }>
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 2, done: 1 } as never)
  expect(String((await bandSvgs($))[1])).toContain('class="edge"')

  expect((await run('')).text).toMatch(/liquid \(the default\).*pixels/s)
  expect((await run('pixels')).text).toContain('pixels')
  expect(String((await bandSvgs($))[1])).toContain('class="t0"')
  expect(saved.barStyle).toBe('pixels')

  expect((await run('lava')).text).toMatch(/liquid.*pixels/s)
  expect(String((await bandSvgs($))[1])).toContain('class="t0"')

  await run('liquid')
  expect(String((await bandSvgs($))[1])).toContain('class="edge"')
})

// The crab trail: a crab walks the track to where the work has got to, leaving footprints.
test('crab: a walking crab stands at the fill, footprints behind it, the label beside it', { options: { barStyle: 'crab' } }, async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 2, done: 1 } as never)
  const track = String((await bandSvgs($))[1])
  const width = Number(/<svg[^>]* width="(\d+)"/.exec(track)?.[1])

  expect(track).toContain('class="c-other run"')
  const prints = [...track.matchAll(/class="print"/g)].length
  expect(prints).toBeGreaterThan(5)
  // Each print glimmers a beat after the one before it: a glint walking toward the crab.
  expect(new Set([...track.matchAll(/class="print" style="animation-delay:(-[\d.]+)s"/g)].map(([, d]) => d)).size).toBe(prints)

  // The crab's centre sits at the fill's end, half way along a 2-task bar.
  const crabX = Number(/<g transform="translate\(([\d.]+),-?[\d.]+\) scale\(0\.5\)"/.exec(track)?.[1])
  expect(Math.abs(crabX + 7.5 - width / 2)).toBeLessThan(2)

  // The label rides beside the crab without covering it.
  const pillX = Number(/<rect x="([\d.]+)" width="(\d+)" height="16" rx="8" fill=/.exec(track)?.[1])
  const pillW = Number(/<rect x="[\d.]+" width="(\d+)" height="16" rx="8" fill=/.exec(track)?.[1])
  expect(pillX + pillW <= crabX || pillX >= crabX + 15).toBe(true)
})

test('crab: a finished trail ends with the crab resting', { options: { barStyle: 'crab' } }, async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 2, done: 2, finished: true } as never)
  const track = String((await bandSvgs($))[1])
  expect(track).toContain('class="c-rest"')
  expect(track).not.toContain('class="c-other run"')
})

test('/bar-style crab picks the crab trail', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  on('store.set', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 2, done: 1 } as never)
  const reply = (await $.command.run({ command: 'bar-style', args: 'crab' } as never)) as { text?: string }
  expect(reply.text).toContain('crab')
  expect(String((await bandSvgs($))[1])).toContain('class="print"')
})

// A finished subagent woken with a follow-up message starts a new run: a new round with no steps
// yet, counted as open work, and the message carries the step brief so the run can report again.
test('a subagent woken by a message starts a new round that reports its own steps', SLOW, async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  let sent = ''
  on('session.send', (_$, e) => {
    sent = e.text
    return { isDelivered: true } as never
  })
  await spawn($, 'Apply the plan')
  await $.tool.call({ tool: 'mcp__savvy-progress__step', agentId: 'a1', done: 7, total: 7 } as never)
  await ($.turn.complete as (e: unknown) => Promise<unknown>)({ agentId: 'a1', reason: 'answer', answer: 'done' })

  await $.session.send({ to: 'a1', text: 'Apply the 18 review findings.' } as never)
  expect(sent).toContain('Apply the 18 review findings.')
  expect(sent).toContain('mcp__savvy-progress__step')

  await $.turn.start({ text: 'Apply the 18 review findings.', turnId: 't2', agentId: 'a1' })
  const [, track, figures] = await bandSvgs($)
  expect(track).toContain('Tasks 0/1')
  expect(figures).toContain('0%')

  await $.tool.call({ tool: 'mcp__savvy-progress__step', agentId: 'a1', done: 1, total: 4 } as never)
  expect(String((await bandSvgs($))[2])).toContain('25%')

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: pane })
  const drawn = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('')
  expect(drawn).toContain('round 2')
})

test('a message to anyone but a known subagent is left as written', async ($, on) => {
  let sent = ''
  on('session.send', (_$, e) => {
    sent = e.text
    return { isDelivered: true } as never
  })
  await $.session.send({ to: 'someone-else', text: 'Hello.' } as never)
  expect(sent).toBe('Hello.')
})

// With no steps reported, the row's bar is a moving "working" stripe, not the context fill:
// a context-sized bar read as progress.
test("a row with no steps shows a working stripe, the context only in words", async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  await spawn($, 'Slow worker')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: pane })
  const drawn = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('')
  expect(drawn).toContain('class="busy"')
  expect(drawn).toContain('ctx 0%')
})

// The time left used to be worked out afresh each second from the pace so far, so between two
// step reports it crept up. It now counts down from each report, and never below what the
// steps still to come need at that pace.
test('the time left counts down between step reports', SLOW, async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', async (_$, e) => ({ value: { tool: e.name } }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', async () => ({ cwd: '/r' }) as never)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  await $.session.start({ cwd: '/r', surface: 'desktop', isInteractive: true })
  await spawn($, 'Fix the login bug')
  await clock.advance(60_000)
  // 1 of 4 steps in 1:00: 3:00 left.
  await $.tool.call({ tool: 'mcp__savvy-progress__step', agentId: 'a1', done: 1, total: 4 } as never)
  const left = async () => /~(\d+:\d\d) left/.exec(String((await bandSvgs($))[2]))?.[1]
  expect(await left()).toBe('3:00')
  await clock.advance(20_000)
  expect(await left()).toBe('2:40')
  // Past the next step's share and still no report: it holds at the two steps after it.
  await clock.advance(80_000)
  expect(await left()).toBe('2:00')
})

const trackOf = async ($: Engine, on: On, done: number, finished = false) => {
  mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 4, done, ...(finished ? { finished: true } : {}) } as never)
  return String((await bandSvgs($))[1])
}

// Aurora: soft blurred lights drift through the fill, each at its own pace, over a dim base.
test('aurora: blurred lights drift through the fill, a glowing seam at its edge', { options: { barStyle: 'aurora' } }, async ($, on) => {
  const track = await trackOf($, on, 2)
  expect(track).toContain('<feGaussianBlur')
  const lights = [...track.matchAll(/class="aur" style="animation-duration:([\d.]+)s;animation-delay:(-[\d.]+)s"/g)]
  expect(lights.length).toBeGreaterThan(2)
  expect(new Set(lights.map(([, d]) => d)).size).toBe(lights.length)
  expect(track).toContain('class="seam"')
  expect(track).not.toContain('class="t0"')
})

// Circuit: a stepped trace, lit up to the fill, a pulse running along the lit part to a pad at its head.
test('circuit: a lit trace with pads at each task, a pulse running to the head', { options: { barStyle: 'circuit' } }, async ($, on) => {
  const track = await trackOf($, on, 2)
  expect(track).toContain('class="trace-dim"')
  expect(track).toContain('class="trace-lit"')
  expect(track).toContain('class="pulse"')
  expect(track).toContain('class="head-pad"')
  // A pad at each boundary between the 4 tasks.
  expect([...track.matchAll(/class="pad"/g)].length).toBe(3)
  // The pulse runs the lit trace's own length.
  const dash = /class="pulse"[^>]*stroke-dasharray="([\d.]+) ([\d.]+)"/.exec(track)
  expect(Number(dash?.[2])).toBeGreaterThan(50)
})

test('circuit: a finished board lights the whole trace and drops the head pad', { options: { barStyle: 'circuit' } }, async ($, on) => {
  const track = await trackOf($, on, 4, true)
  expect(track).toContain('class="trace-lit"')
  expect(track).not.toContain('class="head-pad"')
})

test('/bar-style lists all five looks', async ($, on) => {
  const reply = (await $.command.run({ command: 'bar-style', args: '' } as never)) as { text?: string }
  for (const style of ['pixels', 'liquid', 'crab', 'aurora', 'circuit']) expect(reply.text).toContain(style)
})

// A fill shorter than the label used to sit under it: the label was pushed back to the track's
// start and covered it, so 14% read as an empty bar. The label now goes ahead of a short fill.
for (const barStyle of ['liquid', 'pixels', 'aurora', 'circuit'] as const) {
  test(`${barStyle}: the label never covers a fill shorter than itself`, { options: { barStyle } }, async ($, on) => {
    mock.clock(on, { now: Date.parse('2026-10-16T09:00:00Z') })
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 7, done: 1 } as never)
    const track = String((await bandSvgs($))[1])
    const width = Number(/<svg[^>]* width="(\d+)"/.exec(track)?.[1])
    const fillW = Math.round(width / 7)
    const pillX = Number(/<rect x="([\d.]+)" width="\d+" height="16" rx="8" fill=/.exec(track)?.[1])
    expect(pillX).toBeGreaterThanOrEqual(fillW)
  })
}
