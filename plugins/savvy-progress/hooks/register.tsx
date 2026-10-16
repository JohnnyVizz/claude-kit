import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, Flow, MainWork, Panel, Phase, PlannedTask } from '../types'

const flow = atom({ plugin: 'savvy-progress', key: 'flow' } as const, null)
const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, [])
const panel = atom({ plugin: 'savvy-progress', key: 'panel' } as const, {
  isCompact: false,
  isDoneCollapsed: false,
  autoOpenedFor: '',
})
const now = atom({ plugin: 'savvy-progress', key: 'now' } as const, 0)
const barStyleAtom = atom({ plugin: 'savvy-progress', key: 'barStyle' } as const, '')
const main = atom({ plugin: 'savvy-progress', key: 'main' } as const, { isWorking: false, startedAt: 0, toolCalls: 0 } as MainWork)

const TOOL = 'mcp__savvy-progress__progress'
const STEP_TOOL = 'mcp__savvy-progress__step'
// Added to the end of each savvy worker's brief. Their system prompt words step
// reporting as a condition ("if the step tool appears among your tools") and they
// skip it even with the tool listed; the same request in the brief is followed.
const STEP_BRIEF = `

Progress reporting: before any other work, call \`${STEP_TOOL}\` with \`total\` (your plan in 3-8 steps) and \`done: 0\`; call it again with \`done\` and a few-word \`note\` as each step finishes. It only draws a progress bar.`
// Any other subagent may run without the tool (a type with its own tool list), so its brief is conditional.
const ANY_BRIEF = `

Progress reporting, if the \`${STEP_TOOL}\` tool is available to you: before other work, call it with \`total\` (your plan in 3-8 steps) and \`done: 0\`; call it again with \`done\` and a few-word \`note\` as each step finishes. It only draws a progress bar; skip this if the tool is not there.`
const PANE = 'savvy-agents'
const PHASES: readonly Phase[] = ['plan', 'design', 'delegate', 'review', 'close']
const TIERS: readonly string[] = ['fable', 'heavy', 'careful', 'medium', 'light']
// The tools' schemas are advice to the model, not a check: what a call may ask
// the band and the panel to draw is bounded here.
const MAX_TASKS = 200
const MAX_AFTER = 20
const MAX_TITLE = 120
const ACCENT = '#8f8cf4'
const DONE = '#5fbf8f'

type ProgressInput = {
  title?: string
  total?: number
  done?: number
  phase?: Phase
  finished?: boolean
  tasks?: { title?: string; tier?: string; after?: number[] }[]
}

// ---------------------------------------------------------------------------
// Language: the `language` option, else Claude Code's `language` setting, else the
// process locale; English when nothing says Hebrew or Russian.

type Lang = 'en' | 'ru' | 'he'

const STRINGS = {
  en: {
    pane: 'Agents',
    cost: 'Cost',
    tokens: 'Tokens',
    time: 'Time',
    collapse: 'Collapse',
    expand: 'Expand',
    running: 'Running',
    finished: 'Finished',
    planned: 'Planned',
    empty: 'No subagents yet.',
    round: 'round',
    failed: 'error',
    after: 'after',
    tokensWord: 'tokens',
    agentsCount: 'agents',
    isRunning: 'running',
    isFinished: 'finished',
    isPlanned: 'planned',
    opened: 'Agents panel opened.',
    closed: 'Agents panel closed.',
    done: 'Done',
    plan: 'Plan',
    design: 'Design',
    tasks: 'Tasks',
    review: 'Review',
    busy: 'running',
    ctx: 'ctx',
    left: '~{t} left',
    working: 'Working',
    toolCalls: 'tool calls',
    ready: 'Ready',
    lastTurn: 'last turn',
    work: { explore: 'explore', review: 'review', build: 'build', test: 'test', research: 'research', write: 'write', plan: 'plan', secure: 'security' },
    tier: { light: 'light', medium: 'medium', careful: 'careful', heavy: 'heavy', fable: 'fable', other: 'other' },
    effort: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  },
  ru: {
    pane: 'Агенты',
    cost: 'Стоимость',
    tokens: 'Токены',
    time: 'Время',
    collapse: 'Свернуть',
    expand: 'Развернуть',
    running: 'Работают',
    finished: 'Завершены',
    planned: 'Запланированы',
    empty: 'Субагентов пока нет.',
    round: 'раунд',
    failed: 'ошибка',
    after: 'после',
    tokensWord: 'токенов',
    agentsCount: 'агентов',
    isRunning: 'работает',
    isFinished: 'завершён',
    isPlanned: 'запланирована',
    opened: 'Панель агентов открыта.',
    closed: 'Панель агентов закрыта.',
    done: 'Готово',
    plan: 'План',
    design: 'Дизайн',
    tasks: 'Задачи',
    review: 'Ревью',
    busy: 'в работе',
    ctx: 'ctx',
    left: 'осталось ~{t}',
    working: 'Работаю',
    toolCalls: 'вызовов',
    ready: 'Готов',
    lastTurn: 'прошлый ход',
    work: { explore: 'поиск', review: 'ревью', build: 'разработка', test: 'тесты', research: 'исследование', write: 'текст', plan: 'план', secure: 'безопасность' },
    tier: { light: 'light', medium: 'medium', careful: 'careful', heavy: 'heavy', fable: 'fable', other: 'other' },
    effort: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  },
  he: {
    pane: 'סוכנים',
    cost: 'עלות',
    tokens: 'טוקנים',
    time: 'זמן',
    collapse: 'כיווץ',
    expand: 'הרחבה',
    running: 'פועלים',
    finished: 'הסתיימו',
    planned: 'מתוכננים',
    empty: 'עדיין אין סוכנים.',
    round: 'סבב',
    failed: 'שגיאה',
    after: 'אחרי',
    tokensWord: 'טוקנים',
    agentsCount: 'סוכנים',
    isRunning: 'פועל',
    isFinished: 'הסתיים',
    isPlanned: 'מתוכנן',
    opened: 'חלונית הסוכנים נפתחה.',
    closed: 'חלונית הסוכנים נסגרה.',
    done: 'הושלם',
    plan: 'תכנון',
    design: 'עיצוב',
    tasks: 'משימות',
    review: 'בדיקה',
    busy: 'בעבודה',
    ctx: 'הקשר',
    left: 'נותרו ~{t}',
    working: 'עובד',
    toolCalls: 'קריאות כלים',
    ready: 'מוכן',
    lastTurn: 'תור קודם',
    work: { explore: 'חיפוש', review: 'סקירה', build: 'בנייה', test: 'בדיקות', research: 'מחקר', write: 'כתיבה', plan: 'תכנון', secure: 'אבטחה' },
    tier: { light: 'קל', medium: 'בינוני', careful: 'זהיר', heavy: 'כבד', fable: 'פייבל', other: 'אחר' },
    effort: { low: 'נמוך', medium: 'בינוני', high: 'גבוה', xhigh: 'גבוה מאוד', max: 'מקסימלי' },
  },
} as const

// Module scope is fine here: session.start sets it again on every (re)load.
let lang: Lang = 'en'
const tr = () => STRINGS[lang]

// Hebrew draws every row mirrored: crab and title on the right, numbers on the left.
const isRtl = () => lang === 'he'

// Tier and effort words as shown; anything unknown shows as it came.
const tierWord = (tier: string): string => (tr().tier as Record<string, string>)[tier] ?? tier
const effortWord = (effort: string): string => (tr().effort as Record<string, string>)[effort] ?? effort

const isRussian = (v: unknown): boolean => typeof v === 'string' && /^(ru|russian|рус)/i.test(v.trim())
const isHebrew = (v: unknown): boolean => typeof v === 'string' && /^(he|iw|hebrew|עברית)/i.test(v.trim())
const langOf = (v: unknown): Lang => (isHebrew(v) ? 'he' : isRussian(v) ? 'ru' : 'en')

async function detectLang($: EngineInterface, option: unknown): Promise<Lang> {
  if (option === 'en' || option === 'ru' || option === 'he') return option
  try {
    const settings = (await $.settings.read()) as Record<string, unknown>
    if (typeof settings.language === 'string' && settings.language.trim()) return langOf(settings.language)
  } catch {
    // No settings: fall through to the locale.
  }
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
  return langOf(locale)
}

const blank = (): Flow => ({
  title: 'savvy-flow',
  total: 0,
  done: 0,
  running: 0,
  phase: 'plan',
  isFinished: false,
  tasks: [],
})

const isNewFlow = (prev: Flow | null, input: ProgressInput): boolean =>
  !prev || prev.isFinished || (input.title !== undefined && clip(input.title.trim(), MAX_TITLE) !== prev.title)

// Only a known tier is kept: the name is later a key into the tier tables.
const tierName = (v: string): string => {
  const t = v.replace(/^savvy-/, '').trim().toLowerCase()
  return TIERS.includes(t) ? t : ''
}

const cleanTasks = (tasks: ProgressInput['tasks']): PlannedTask[] | undefined =>
  tasks
    ?.filter(t => t.title?.trim())
    .slice(0, MAX_TASKS)
    .map(t => ({
      title: (t.title ?? '').trim(),
      tier: tierName(t.tier ?? ''),
      after: (t.after ?? []).filter(n => Number.isInteger(n) && n > 0).slice(0, MAX_AFTER),
    }))

const merge = (prev: Flow | null, input: ProgressInput): Flow => {
  // A new title means a new flow: never carry counters over from an earlier one.
  const base = isNewFlow(prev, input) || !prev ? blank() : { ...blank(), ...prev }
  const tasks = cleanTasks(input.tasks) ?? base.tasks
  const total = Math.min(MAX_TASKS, Math.max(0, Math.round(input.total ?? (input.tasks ? tasks.length : base.total))))
  const done = Math.min(total || Infinity, Math.max(0, Math.round(input.done ?? base.done)))
  const phase = input.phase && PHASES.includes(input.phase) ? input.phase : base.phase
  return {
    ...base,
    title: clip(input.title?.trim() || base.title, MAX_TITLE),
    total,
    done,
    phase: input.finished ? 'close' : phase,
    isFinished: input.finished === true,
    tasks,
  }
}

const label = (f: Flow): string => {
  const s = tr()
  if (f.isFinished) return s.done
  if (f.phase === 'plan') return s.plan
  if (f.phase === 'design') return s.design
  const count = f.total ? `${f.done}/${f.total}` : `${f.running} ${s.busy}`
  return `${f.phase === 'review' ? s.review : s.tasks} ${count}`
}

// Accepted tasks, plus the share of their steps the running workers have reported.
const ratio = (f: Flow): number => (f.isFinished ? 1 : f.total ? Math.min(1, (f.done + (f.partial ?? 0)) / f.total) : 0)

// Deterministic noise so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// Another mod's band beneath this one gets a small gap above it, so the two read as separate rows. The gap's box
// is a column so that band still stretches to the full width (a row would shrink it to its content).
// The band is a flex row of small drawings (title, track, stats, crab) and Buttons, each
// as wide as its content (the track as wide as the row allows), spread edge to edge so the
// gaps between them grow and shrink with the window. Every drawing is H tall with its
// content centred, so they all share one centre line.
const H = 24
const BAR_H = 16
// The crab's drawing grid is 30 units wide, props included.
const CRAB_BOX = 30
const CELL = 3
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s)

// CJK, fullwidth forms and emoji advance about 1em; at 0.56em a Chinese title was sized at half its width and the bar drew over it.
// 中日韩文字、全角标点和 emoji 约占 1em；按 0.56em 算时中文标题宽度被低估近一半，进度条会压到标题上。
const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF01-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u

// Rough advance of system UI text, in em; good enough to size the title's slot.
const charEm = (ch: string): number =>
  WIDE.test(ch) ? 1 : /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-ZА-ЯЁmwшщжюМШЩЖЮ@%]/.test(ch) ? 0.72 : 0.56

const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

// Cuts `s` to fit `maxW` pixels, with an ellipsis when it had to cut.
const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

const SVG_STYLE = `<style>.t{fill:#1f1f1f}.m{fill:#8a8a8a}@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}@media (prefers-reduced-motion: reduce){.live{animation:none}}</style>`

// A dot and a bold word or title, as wide as the words: the band's left end.
const headSvg = (title: string, color: string, isLive: boolean, maxW = 600): { source: string; width: number } => {
  const rtl = isRtl()
  const text = fitText(title, 13, Math.max(40, maxW - 16))
  const W = Math.ceil(16 + textWidth(text, 13) + 2)
  const at = rtl ? `x="${W - 16}" direction="rtl" text-anchor="start"` : 'x="16"'
  return {
    width: W,
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${SVG_STYLE}
<circle${isLive ? ' class="live"' : ''} cx="${rtl ? W - 5 : 5}" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" ${at} y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(text)}</text>
</svg>`,
  }
}

// Muted figures (percent and time left, tool calls). Their width is measured with every digit
// read as a 0 and rounded up to 8px, so a ticking clock (a narrow 1 for an 8) never resizes the
// drawing: a new width moved every other piece of the row and redrew the track from scratch each
// second. `end` keeps the words against the drawing's far edge, so they grow away from the crab.
const statSvg = (text: string, maxW = 600, align: 'start' | 'end' = 'start'): { source: string; width: number } => {
  const rtl = isRtl()
  const shown = fitText(text, 12.5, maxW)
  const W = Math.max(8, Math.ceil((textWidth(shown.replace(/\d/g, '0'), 12.5) + 2) / 8) * 8)
  const atEnd = (align === 'end') !== rtl
  const at = `x="${atEnd ? W : 0}"${rtl ? ' direction="rtl"' : ''} text-anchor="${atEnd === rtl ? 'start' : 'end'}"`
  return {
    width: W,
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${SVG_STYLE}
<text class="m" ${at} y="${H / 2 + 4.5}" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${xml(shown)}</text>
</svg>`,
  }
}

// The flow's track, BAR_W wide: the dithered fill, the faint layer handed out, ticks, and the label pill.
// The bar redraws every second for its clock, and a redrawn image starts its animations over, so
// each drawing is given the time (`at`, ms): every loop's delay puts it where it would be by now,
// and the motion runs on across redraws instead of replaying the same first second.
const phase = (at: number, period: number, offset = 0): string => {
  const into = (((at / 1000 + offset) % period) + period) % period
  return `-${Math.round(into * 100) / 100}`
}

// The liquid fill. Left to right, inside the track's clip; `trackSvg` mirrors it for Hebrew.
// Every loop is phased by the clock, as the pixels are, so it carries on across redraws.
//   body:    the fill with a rippling front edge (a sine wave climbing the edge), deeper below
//   ghost:   a fainter copy of the edge just ahead of it, out of step, for depth
//   ripples: two light lines drifting through the liquid, one each way, at different speeds
//   bubbles: a few rising and fading, each on its own beat; a finished bar's liquid lies still
const WAVE_L = 8
const WAVE_A = 1.8

const liquid = (f: Flow, fillW: number, runW: number, color: string, at: number): { body: string; css: string } => {
  const calm = f.isFinished
  const edgeBeat = calm ? 3.6 : 1.2
  const ghostBeat = calm ? 4.4 : 1.7
  const r1Beat = calm ? 6 : 2.4
  const r2Beat = calm ? 8 : 3.4
  const fmt = (n: number): string => String(Math.round(n * 100) / 100)

  // The front edge from y = -L to BAR_H + L, so a one-wavelength climb never shows a gap.
  const edge = (x0: number, amp: number): string => {
    const points: string[] = []
    for (let y = -WAVE_L; y <= BAR_H + WAVE_L; y += 0.5) points.push(`L${fmt(x0 + amp * Math.sin((2 * Math.PI * y) / WAVE_L))} ${y}`)
    return `M-2 ${-WAVE_L} ${points.join(' ')} L-2 ${BAR_H + WAVE_L} Z`
  }
  // A light line across the fill, one wavelength wider on each side so its drift never shows an end.
  const ripple = (y: number, len: number, amp: number): string => {
    const points: string[] = []
    for (let x = -len; x <= fillW + len; x += 2) points.push(`${x === -len ? 'M' : 'L'}${x} ${fmt(y + amp * Math.sin((2 * Math.PI * x) / len))}`)
    return points.join(' ')
  }

  const bubbles: string[] = []
  if (!calm) {
    const count = Math.max(2, Math.min(8, Math.floor(fillW / 40)))
    for (let i = 0; i < count; i++) {
      const beat = Math.round((1.6 + noise(i, 3) * 1.6) * 10) / 10
      const x = 4 + noise(i * 3 + 1, 7) * Math.max(1, fillW - 12)
      const radius = 0.7 + noise(i, 11) * 0.6
      bubbles.push(`<circle class="bub" style="animation-duration:${beat}s;animation-delay:${phase(at, beat, i * 0.37 + noise(i, 5) * beat)}s" cx="${fmt(x)}" cy="${BAR_H - 2}" r="${fmt(radius)}" fill="#fff"/>`)
    }
  }

  const ahead = runW > fillW ? `<rect x="${fillW}" width="${runW - fillW}" height="${BAR_H}" fill="${color}" opacity="0.07"/>` : ''
  const body =
    fillW < 3
      ? ahead
      : `${ahead}
<path class="ghost" style="animation-delay:${phase(at, ghostBeat, ghostBeat / 3)}s" d="${edge(fillW + 1.4, WAVE_A * 0.8)}" fill="${color}" opacity="0.2"/>
<path class="edge" style="animation-delay:${phase(at, edgeBeat)}s" d="${edge(fillW, WAVE_A)}" fill="url(#lq)"/>
<g clip-path="url(#fl)" fill="none" stroke="#fff" stroke-linecap="round">
<path class="rip1" style="animation-delay:${phase(at, r1Beat)}s" d="${ripple(4.5, 14, 1)}" stroke-width="1" stroke-opacity="0.22"/>
<path class="rip2" style="animation-delay:${phase(at, r2Beat)}s" d="${ripple(11, 10, 0.8)}" stroke-width="0.9" stroke-opacity="0.14"/>
</g>
<g clip-path="url(#fl)" opacity="0.7">${bubbles.join('')}</g>`

  const css = `.edge{animation:edge ${edgeBeat}s linear infinite}.ghost{animation:edge ${ghostBeat}s linear infinite reverse}
@keyframes edge{to{transform:translateY(-${WAVE_L}px)}}
.rip1{animation:rip1 ${r1Beat}s linear infinite}@keyframes rip1{to{transform:translateX(-14px)}}
.rip2{animation:rip2 ${r2Beat}s linear infinite}@keyframes rip2{from{transform:translateX(-10px)}to{transform:translateX(0)}}
.bub{animation:rise 2s ease-in infinite}
@keyframes rise{0%{transform:translateY(0);opacity:0}20%{opacity:.85}100%{transform:translateY(-11px);opacity:0}}
@media (prefers-reduced-motion: reduce){.edge,.ghost,.rip1,.rip2,.bub{animation:none}.bub{opacity:0}}`
  return { body, css }
}

// The crab trail. Left to right; `trackSvg` mirrors it for Hebrew. A crab walks the track and
// stands where the work has got to; behind it, a pale wash and alternating footprints, fainter
// where it set out, with a glint that travels along them toward the crab. A finished trail ends
// with the crab resting. Like the other styles, every loop is phased by the clock.
const TRAIL_CRAB = 0.5
const TRAIL_STEP = 6

const trail = (f: Flow, fillW: number, runW: number, color: string, at: number, BAR_W: number, pillW: number): { body: string; css: string; pillX: number } => {
  const calm = f.isFinished
  const crabW = CRAB_BOX * TRAIL_CRAB
  const crabX = Math.round(Math.max(0, Math.min(BAR_W - crabW, fillW - crabW / 2)) * 10) / 10
  // The body (rows 10-26 of the crab's grid) centred on the track's middle.
  const crabY = Math.round((BAR_H / 2 - BODY_MID * TRAIL_CRAB) * 100) / 100
  const glint = calm ? 4 : 2.4
  const prints: string[] = []
  const count = Math.max(0, Math.floor((crabX - 4) / TRAIL_STEP))
  for (let i = 0; i < count; i++) {
    const x = 3 + i * TRAIL_STEP
    const up = i % 2 === 0
    const strength = Math.round((0.3 + 0.6 * (count > 1 ? i / (count - 1) : 1)) * 100) / 100
    prints.push(
      `<g class="print" style="animation-delay:${phase(at, glint, -i * 0.11)}s"><g opacity="${strength}">` +
        `<rect x="${x}" y="${up ? 4 : 9.5}" width="2.2" height="2.2" rx="1.1"/><rect x="${x + 2.6}" y="${up ? 5.2 : 10.7}" width="1.5" height="1.5" rx="0.75"/></g></g>`,
    )
  }
  const ahead = runW > fillW ? `<rect x="${fillW}" width="${runW - fillW}" height="${BAR_H}" fill="${color}" opacity="0.08"/>` : ''
  const body = `${ahead}<rect width="${Math.max(0, fillW)}" height="${BAR_H}" fill="${color}" opacity="0.16"/>
<g fill="${color}">${prints.join('')}</g>
${CRAB_CSS}${crab(crabX, crabY, calm ? 'rest' : 'other', false, !calm, TRAIL_CRAB)}`
  // The label rides just behind the crab, or just ahead of it while there is no room behind.
  const pillX = crabX >= pillW + 4 ? crabX - pillW - 2 : Math.min(BAR_W - pillW, crabX + crabW + 2)
  const css = `.print{animation:print ${glint}s ease-in-out infinite}@keyframes print{0%,100%{opacity:1}40%{opacity:.35}}
@media (prefers-reduced-motion: reduce){.print{animation:none}}`
  return { body, css, pillX }
}

// Aurora. Left to right; `trackSvg` mirrors it for Hebrew. Over a dim wash of the fill, soft
// blurred lights in four hues drift through it, each at its own pace; a seam of light pulses at
// its edge while work goes on. Phased by the clock, like the others.
const AURORA_HUES = ['', '#4fd1c5', '#e879c9', '#7aa7ff']

const aurora = (f: Flow, fillW: number, runW: number, color: string, at: number): { body: string; css: string } => {
  const calm = f.isFinished
  const fmt = (n: number): string => String(Math.round(n * 100) / 100)
  const travel = fillW + 140
  const lights: string[] = []
  for (let i = 0; i < 4; i++) {
    // Five to nine seconds a pass (half again once finished), each light its own.
    const beat = Math.round(((calm ? 8 : 5) + noise(i, 13) * 4) * 10) / 10
    const hue = AURORA_HUES[i] || color
    const cy = 3 + noise(i, 17) * 10
    lights.push(`<ellipse class="aur" style="animation-duration:${beat}s;animation-delay:${phase(at, beat, (i * beat) / 4)}s" cx="-70" cy="${fmt(cy)}" rx="${fmt(26 + noise(i, 19) * 14)}" ry="${fmt(7 + noise(i, 23) * 4)}" fill="${hue}" opacity="${calm ? 0.55 : 0.8}"/>`)
  }
  const ahead = runW > fillW ? `<rect x="${fillW}" width="${runW - fillW}" height="${BAR_H}" fill="${color}" opacity="0.06"/>` : ''
  const seam = !calm && fillW > 4 ? `<rect class="seam" style="animation-delay:${phase(at, 1.6)}s" x="${fillW - 1.5}" width="2" height="${BAR_H}" fill="#fff"/>` : ''
  const body = `${ahead}<rect width="${Math.max(0, fillW)}" height="${BAR_H}" fill="${color}" opacity="0.45"/>
<g clip-path="url(#fl)"><g filter="url(#ab)">${lights.join('')}</g></g>
${seam}`
  const css = `.aur{animation:aur 6s linear infinite}@keyframes aur{to{transform:translateX(${travel}px)}}
.seam{animation:seam 1.6s ease-in-out infinite}@keyframes seam{0%,100%{opacity:.3}50%{opacity:.85}}
@media (prefers-reduced-motion: reduce){.aur,.seam{animation:none}}`
  return { body, css }
}

// Circuit. Left to right; `trackSvg` mirrors it for Hebrew. A trace steps between two lanes
// along the track: dim ahead, lit up to the fill, a solder pad at each task boundary, and a
// pulse of light running the lit part to a blinking pad at its head. Phased by the clock.
const TRACE_SEG = 22
const TRACE_LANES = [5, 11]

const tracePoints = (BAR_W: number): [number, number][] => {
  const points: [number, number][] = [[2, TRACE_LANES[0] ?? 5]]
  let lane = 0
  for (let x = 2 + TRACE_SEG; x < BAR_W - 2; x += TRACE_SEG) {
    const y = TRACE_LANES[lane] ?? 5
    const next = TRACE_LANES[1 - lane] ?? 11
    points.push([x - 3, y], [x, next])
    lane = 1 - lane
  }
  points.push([BAR_W - 2, TRACE_LANES[lane] ?? 5])
  return points
}

// The trace up to `upTo`, and its length.
const traceTo = (points: [number, number][], upTo: number): { d: string; length: number; end: [number, number] } => {
  const kept: [number, number][] = []
  let length = 0
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i] as [number, number]
    if (i === 0) {
      kept.push([x, y])
      continue
    }
    const [px, py] = kept[kept.length - 1] as [number, number]
    if (x <= upTo) {
      kept.push([x, y])
      length += Math.hypot(x - px, y - py)
      continue
    }
    const t = x === px ? 0 : Math.max(0, Math.min(1, (upTo - px) / (x - px)))
    const cut: [number, number] = [px + (x - px) * t, py + (y - py) * t]
    kept.push(cut)
    length += Math.hypot(cut[0] - px, cut[1] - py)
    break
  }
  const fmt = (n: number): string => String(Math.round(n * 100) / 100)
  const d = kept.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`).join(' ')
  return { d, length: Math.round(length * 100) / 100, end: kept[kept.length - 1] ?? [2, 5] }
}

const circuit = (f: Flow, fillW: number, color: string, at: number, BAR_W: number): { body: string; css: string } => {
  const calm = f.isFinished
  const points = tracePoints(BAR_W)
  const all = traceTo(points, BAR_W)
  const lit = traceTo(points, calm ? BAR_W : fillW)
  const PULSE = 10
  const pulseBeat = Math.max(1, Math.round((lit.length / (calm ? 60 : 140)) * 10) / 10)
  const pads: string[] = []
  for (let i = 1; i < f.total; i++) {
    const x = (BAR_W * i) / f.total
    const y = traceTo(points, x).end[1]
    const isLit = calm || x <= fillW
    // A pad still ahead is an empty ring in the dim trace's grey, which reads on either theme.
    pads.push(`<circle class="pad" cx="${Math.round(x * 100) / 100}" cy="${Math.round(y * 100) / 100}" r="1.9" ${isLit ? `fill="${color}"` : 'fill="none" stroke="#808080" stroke-opacity="0.7" stroke-width="1"'}/>`)
  }
  const [hx, hy] = lit.end
  const head = !calm && fillW > 3 ? `<circle class="head-pad" style="animation-delay:${phase(at, 1.2)}s" cx="${Math.round(hx * 100) / 100}" cy="${Math.round(hy * 100) / 100}" r="2.6" fill="${color}"/>` : ''
  const showLit = lit.length > 0.5
  const body = `<path class="trace-dim" d="${all.d}" fill="none" stroke-width="1.2" stroke-linejoin="round"/>
${showLit ? `<path d="${lit.d}" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round" opacity="0.28"/>
<path class="trace-lit" d="${lit.d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
<path class="pulse" style="animation-delay:${phase(at, pulseBeat)}s" d="${lit.d}" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="${PULSE} ${lit.length}"/>` : ''}
${pads.join('')}
${head}`
  const css = `.trace-dim{stroke:#b4b4b0}@media (prefers-color-scheme: dark){.trace-dim{stroke:#4a4a4a}}
.pulse{animation:pulse ${pulseBeat}s linear infinite}@keyframes pulse{from{stroke-dashoffset:${PULSE}}to{stroke-dashoffset:-${lit.length}}}
.head-pad{animation:blink 1.2s ease-in-out infinite}@keyframes blink{50%{opacity:.35}}
@media (prefers-reduced-motion: reduce){.pulse,.head-pad{animation:none}.pulse{opacity:0}}`
  return { body, css }
}

const trackSvg = (f: Flow, BAR_W: number, at = 0, style: 'liquid' | 'pixels' | 'crab' | 'aurora' | 'circuit' = 'liquid'): string => {
  const beats = f.isFinished ? [3.2, 3.8, 4.4, 3.5] : [2.2, 2.8, 1.9, 3.3]
  const color = f.isFinished ? DONE : ACCENT
  const y0 = (H - BAR_H) / 2
  const fillW = Math.round(BAR_W * ratio(f))
  const runW = f.total ? Math.round((BAR_W * Math.min(f.total, f.done + f.running)) / f.total) : 0
  const dots: string[] = []
  // Positions are worked out left to right; right to left mirrors each box inside the bar.
  const rtl = isRtl()
  const bx = (x: number, w: number): number => (rtl ? BAR_W - x - w : x)

  // Dithered fill: sparse at the start, dense toward the head.
  const isLiquid = style === 'liquid'
  const isCrab = style === 'crab'
  const isAurora = style === 'aurora'
  const isCircuit = style === 'circuit'
  const isScene = isLiquid || isCrab || isAurora || isCircuit
  const cols = isScene ? 0 : Math.floor(fillW / CELL)
  const rows = Math.floor(BAR_H / CELL)
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++) {
      // Each pixel keeps its own place in its group's beat, so the fill shimmers rather than blinking in four sets.
      const k = Math.floor(noise(r, c) * 4)
      const beat = beats[k] ?? 2.2
      if (noise(c, r) < density) dots.push(`<rect class="t${k}" style="animation-delay:${phase(at, beat, noise(r * 7 + 3, c * 3 + 1) * beat)}s" x="${bx(c * CELL + 1, 2)}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
  }
  // Handed to workers, not yet accepted: a faint second layer.
  const faint: string[] = []
  for (let c = cols; !isScene && c < Math.floor(runW / CELL); c++) {
    for (let r = 0; r < rows; r++) {
      const k = Math.floor(noise(r + 5, c) * 4)
      const beat = beats[k] ?? 2.2
      if (noise(c + 7, r + 3) < 0.2) faint.push(`<rect class="t${k}" style="animation-delay:${phase(at, beat, noise(c * 5 + 2, r * 11 + 7) * beat)}s" x="${bx(c * CELL + 1, 1.7)}" y="${r * CELL + 1}" width="1.7" height="1.7"/>`)
    }
  }

  const ticks: string[] = []
  for (let i = 1; !isCircuit && i < f.total; i++) {
    const x = Math.round((BAR_W * i) / f.total)
    if (x > fillW + 4) ticks.push(`<rect x="${bx(x, 1.5)}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }

  const text = label(f)
  const pillW = Math.round(18 + text.length * 6.6)
  const walk = isCrab ? trail(f, fillW, runW, color, at, BAR_W, pillW) : null
  // The label rides the fill's head; a fill too short to hold it gets the label just ahead of it
  // instead, so the label never covers the progress it labels.
  const headPill = fillW >= pillW + 2 ? fillW - pillW : Math.min(BAR_W - pillW, fillW + 4)
  const pillX = bx(walk ? walk.pillX : headPill, pillW)
  // A soft band of light sweeps along the fill toward its head (slower once finished), every
  // pass the same length of time whatever the fill's width.
  const SHEEN_W = 36
  const sweep = fillW + SHEEN_W
  const sheenBeat = f.isFinished ? 4.8 : 2.4
  const flow = isLiquid
    ? liquid(f, fillW, runW, color, at)
    : isAurora
      ? aurora(f, fillW, runW, color, at)
      : isCircuit
        ? circuit(f, fillW, color, at, BAR_W)
        : (walk ?? { body: '', css: '' })
  // Right to left, a scene is mirrored whole: it then leads toward the left.
  const flowed = isScene ? `<g${rtl ? ` transform="translate(${BAR_W},0) scale(-1,1)"` : ''}>${flow.body}</g>` : ''
  const sheen =
    fillW > 8 && (style === 'pixels' || isLiquid)
      ? `<g clip-path="url(#fl)"><rect class="sheen" style="animation-delay:${phase(at, sheenBeat)}s" x="${rtl ? BAR_W : -SHEEN_W}" width="${SHEEN_W}" height="${BAR_H}" fill="url(#sh)"/></g>`
      : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_W}" height="${H}" viewBox="0 0 ${BAR_W} ${H}">
<style>
.k{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}
/* Pixels twinkle in four out-of-phase groups; a finished bar settles to a slow glow. */
.t0,.t1,.t2,.t3{animation:tw ${beats[0]}s ease-in-out infinite}
.t1{animation-duration:${beats[1]}s}.t2{animation-duration:${beats[2]}s}.t3{animation-duration:${beats[3]}s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${f.isFinished ? 0.8 : 0.3}}}
.sheen{animation:sheen ${sheenBeat}s cubic-bezier(.45,0,.55,1) infinite}
@keyframes sheen{from{transform:translateX(0)}to{transform:translateX(${rtl ? -sweep : sweep}px)}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3,.sheen{animation:none}.sheen{opacity:0}}
${flow.css}
</style>
<defs><clipPath id="c"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath>
<clipPath id="fl"><rect x="${bx(0, fillW)}" y="0" width="${fillW}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath>
<linearGradient id="sh" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<filter id="ab" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="5"/></filter>
<linearGradient id="lq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.82"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0.95"/></linearGradient></defs>
<g transform="translate(0,${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)">
${flowed}
<g fill="${color}">${dots.join('')}</g>
<g fill="${color}" opacity="0.45">${faint.join('')}</g>
<g class="tk">${ticks.join('')}</g>
</g>
${sheen}
<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle"${rtl ? ' direction="rtl"' : ''} font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(text)}</text>
</g>
</svg>`
}

// Of the room left after the fixed pieces, the track takes this share; the rest becomes the gaps.
const TRACK_SHARE = 0.72

// The main session's work, read off each tool call: what the crab dresses for while it works.
const TEST_COMMAND = /\b(test|tests|pytest|jest|vitest|mocha|spec)\b|npm (run )?test|go test|cargo test|bun test/
const LOOK_COMMAND = /^\s*(ls|dir|cat|type|head|tail|grep|rg|find|git (log|diff|status|show|blame)|wc|tree|Get-ChildItem|Get-Content|Select-String)\b/i
const DOC_FILE = /\.(md|mdx|txt|rst|docx?)$/i

const toolWork = (tool: string, input: Record<string, unknown>): string => {
  const name = toolName(tool)
  if (/secur|vuln/i.test(tool)) return 'secure'
  if (/^(WebFetch|WebSearch)$/.test(name) || /navigate|page_text|read_page/i.test(name)) return 'research'
  if (/^(Read|Grep|Glob|LS|ToolSearch|NotebookRead)$/.test(name) || /list|search_|read_|get_|find/i.test(name)) return 'explore'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return DOC_FILE.test(String(input.file_path ?? '')) ? 'write' : 'build'
  if (/^(Bash|PowerShell)$/.test(name)) {
    const command = String(input.command ?? '')
    if (TEST_COMMAND.test(command)) return 'test'
    if (LOOK_COMMAND.test(command)) return 'explore'
    return 'build'
  }
  if (/^(Agent|Workflow|TodoWrite|EnterPlanMode|ExitPlanMode|Skill|AskUserQuestion)$/.test(name) || /plan/i.test(name)) return 'plan'
  if (/review/i.test(name)) return 'review'
  return 'build'
}

// `mcp__server__tool` reads as `tool`.
const toolName = (tool: string): string => tool.split('__').pop() || tool

// Live while the turn runs; between turns, the last turn's totals, or nothing before the first.
const mainLine = (m: MainWork, at: number): string => {
  const s = tr()
  if (!m.isWorking) return m.endedAt === undefined ? '' : `${s.lastTurn}: ${m.toolCalls} ${s.toolCalls} · ${fmtTime(Math.max(0, m.endedAt - m.startedAt))}`
  const parts = [`${m.toolCalls} ${s.toolCalls}`, fmtTime(Math.max(0, at - m.startedAt))]
  if (m.lastTool) parts.push(toolName(m.lastTool))
  return parts.join(' · ')
}

const mainHead = (m: MainWork): string => (m.isWorking ? tr().working : tr().ready)

// The crab fills the row's height like the label pill and a line of text beside it: 28 grid units at 0.8 is 22px in a 24px row.
const BAND_CRAB = 0.8
const bandCrabW = Math.ceil(CRAB_BOX * BAND_CRAB) + 2

// The bar's crab: the newest running subagent's work (the main session's when that reads as nothing),
// else the flow's phase, else what the main session is doing, else resting.
const barCostume = (f: Flow, list: AgentRun[], m: MainWork): string => {
  // Newest by start, later in the list on a tie: the list is in spawn order.
  const newest = list.filter(a => a.status === 'running').reduce<AgentRun | undefined>((n, a) => (!n || a.startedAt >= n.startedAt ? a : n), undefined)
  if (newest) {
    const work = costumeOf(newest.type, newest.description)
    return work === 'other' && m.isWorking ? mainCostume(m) : work
  }
  if (f.isFinished) return 'rest'
  if (f.phase === 'plan' || f.phase === 'design') return 'plan'
  if (f.phase === 'review') return 'review'
  return mainCostume(m)
}

// The crab dresses for the work while the turn runs (thinking before the first tool), and rests between turns.
const mainCostume = (m: MainWork): string => (m.isWorking ? (m.work ?? 'plan') : 'rest')

// The crab's grid is 28 units tall, but its body and legs fill rows 10-26 (hats and props sit
// above): centring the grid drew the body low. Its own drawing centres the body, a little taller
// than the row so a hat's top still fits; the row centres the drawing, so the body sits on the
// same line as the text.
const BODY_MID = 17.5
const CRAB_H = 28

const crabSvg = (costume: string, isBusy: boolean): string => {
  const y = Math.round((CRAB_H / 2 - BODY_MID * BAND_CRAB) * 100) / 100
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bandCrabW}" height="${CRAB_H}" viewBox="0 0 ${bandCrabW} ${CRAB_H}">${CRAB_CSS}${crab(1, y, costume, false, isBusy && costume !== 'rest', BAND_CRAB, isRtl())}</svg>`
}

const barText = (f: Flow, width: number): string => {
  const filled = Math.round(width * ratio(f))
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

// ---------------------------------------------------------------------------
// Agents panel: every subagent of the session, plus the tasks the flow planned.

const TIER_COLOR: Record<string, string> = {
  fable: '#7F77DD',
  heavy: '#D85A30',
  careful: '#BA7517',
  medium: '#378ADD',
  light: '#1D9E75',
  other: '#888780',
}

// What each savvy tier runs on, for planned tasks that have no run yet.
const colorOf = (tier: string): string => TIER_COLOR[tier] ?? WORK_COLOR[tier] ?? '#888780'

const TIER_MODEL: Record<string, [model: string, effort: string]> = {
  fable: ['Fable', 'high'],
  heavy: ['Opus', 'xhigh'],
  careful: ['Opus', 'high'],
  medium: ['Opus', 'medium'],
  light: ['Opus', 'low'],
}

// "Opus · xhigh", with the effort word in the panel's language; '' for an unknown tier.
const tierModel = (tier: string): string => {
  const m = TIER_MODEL[tier]
  return m ? `${m[0]} · ${effortWord(m[1])}` : ''
}

// "Opus 5.5 · low" for a run, or just the model when no effort was seen.
const runModel = (a: AgentRun): string => (a.effort ? `${modelName(a.model)} · ${effortWord(a.effort)}` : modelName(a.model))

// USD per million tokens: input, output, cache read, cache write. The first row that
// matches a model id wins, so a release sits above its family.
// The engine reports tokens, not money, so the panel's cost is an estimate. It reports
// one cache-write count with no split by lifetime; writes are priced at the 1-hour
// rate (2x input), which is what Claude Code writes on a subscription.
type Price = [input: number, output: number, cacheRead: number, cacheWrite: number]

const PRICES: [RegExp, Price][] = [
  [/(fable|mythos)-5-1/, [10, 50, 0.25, 20]],
  [/fable|mythos/, [10, 50, 1, 20]],
  [/opus-5-5/, [4, 20, 0.2, 8]],
  [/opus/, [5, 25, 0.5, 10]],
  [/sonnet-5-5/, [2, 10, 0.1, 4]],
  [/sonnet-5/, [2, 10, 0.2, 4]],
  [/sonnet/, [3, 15, 0.3, 6]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.2]],
  [/haiku/, [1, 5, 0.1, 2]],
]

// Haiku 5.5 is priced by prompt length: a request whose prompt (input, cache reads and
// cache writes together) is over 100,000 tokens pays these prices instead.
const HAIKU_LONG_PROMPT = 100_000
const HAIKU_LONG: Price = [0.5, 2.5, 0.05, 1]

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const priceOf = (model: string, prompt: number): Price => {
  const id = model.toLowerCase()
  if (prompt > HAIKU_LONG_PROMPT && /haiku-5-5/.test(id)) return HAIKU_LONG
  return PRICES.find(([re]) => re.test(id))?.[1] ?? [4, 20, 0.2, 8]
}

// `isRequest` says the usage is one model request, which is what a prompt-length price
// is set by; a turn's sum is priced at the model's ordinary prices.
const costOf = (model: string, u: Usage, isRequest: boolean): number => {
  const prompt = isRequest ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0
  const [i, o, r, w] = priceOf(model, prompt)
  return (
    ((u.input_tokens || 0) * i +
      (u.output_tokens || 0) * o +
      (u.cache_read_input_tokens || 0) * r +
      (u.cache_creation_input_tokens || 0) * w) /
    1e6
  )
}

// Haiku 4.5 and the Claude 3 models have a 200K window; the rest, Haiku 5.5 included, 1M.
const windowOf = (model: string): number => (/haiku-4|claude-3/i.test(model) ? 200_000 : 1_000_000)

// `savvy-careful`, or `savvy-flow:savvy-careful` when the agents ship in a plugin.
const tierOf = (type: string): string => {
  const bare = type.replace(/^[^:]*:/, '')
  const t = bare.replace(/^savvy-/, '').toLowerCase()
  return Object.hasOwn(TIER_COLOR, t) && bare.startsWith('savvy-') ? t : 'other'
}

const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const fmtTokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`

const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const elapsed = (a: AgentRun, at: number): number => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt

// Time left, extrapolated from the pace so far: elapsed / done x remaining.
// Null until there is a pace to go on (one step or task done) or nothing is left.
const remaining = (spent: number, done: number, total: number): number | null =>
  done > 0 && total > done && spent > 0 ? (spent / done) * (total - done) : null

// Counting down from the last report: at the pace so far, the steps left needed `est` then;
// the time since comes off it, but never below what the steps after the current one need, so a
// slow step holds the figure instead of letting it run out. Null once it has.
const countdown = (start: number, reportAt: number, done: number, total: number, at: number): number | null => {
  if (done <= 0 || total <= done || reportAt <= start) return null
  const pace = (reportAt - start) / done
  const left = Math.max(pace * (total - done) - Math.max(0, at - reportAt), pace * (total - done - 1))
  return left > 0 ? left : null
}

const agentLeft = (a: AgentRun, at: number): number | null => {
  if (a.status !== 'running' || !a.stepTotal) return null
  return a.stepAt === undefined
    ? remaining(elapsed(a, at), a.stepDone ?? 0, a.stepTotal)
    : countdown(a.startedAt, a.stepAt, a.stepDone ?? 0, a.stepTotal, at)
}

// The flow's pace once a task is accepted; before that, the slowest running worker's own estimate.
const flowLeft = (f: Flow, list: AgentRun[], at: number): number | null => {
  if (f.isFinished || !f.total || f.done >= f.total) return null
  // Parallel runs are not a pace: an automatic bar waits for the slowest worker.
  if (f.done > 0 && f.startedAt && !f.isAuto) {
    return f.progressAt === undefined ? remaining(Math.max(0, at - f.startedAt), f.done, f.total) : countdown(f.startedAt, f.progressAt, f.done, f.total, at)
  }
  const workers = list.map(a => agentLeft(a, at)).filter((ms): ms is number => ms !== null)
  return workers.length ? Math.max(...workers) : null
}

// With no flow reported, the bar follows the subagents running now: the batch is
// every run since the earliest of them started, finished ones counted done.
const autoFlow = (list: AgentRun[]): Flow | null => {
  const running = list.filter(a => a.status === 'running')
  if (!running.length) return null
  const start = Math.min(...running.map(a => a.startedAt))
  const batch = list.filter(a => (a.endedAt ?? Infinity) >= start)
  return {
    ...blank(),
    title: tr().pane,
    total: batch.length,
    done: batch.length - running.length,
    running: running.length,
    phase: 'delegate',
    startedAt: start,
    isAuto: true,
  }
}

// The running workers' reported steps, in tasks: each counts its share of one task. An automatic
// bar counts every running subagent; a reported flow, the workers on its planned tasks (all of
// them when it planned none). Never more than the tasks still open.
const withPartial = (f: Flow, list: AgentRun[]): Flow => {
  if (f.isFinished || !f.total) return f
  const planned = new Set((f.tasks ?? []).map(t => norm(t.title)))
  const counts = (a: AgentRun) => f.isAuto || planned.size === 0 || planned.has(norm(a.description))
  const partial = list
    .filter(a => a.status === 'running' && a.stepTotal && counts(a))
    .reduce((sum, a) => sum + Math.min(1, (a.stepDone ?? 0) / (a.stepTotal ?? 1)), 0)
  return { ...f, partial: Math.min(partial, Math.max(0, f.total - f.done)) }
}

const fmtLeft = (ms: number): string => tr().left.replace('{t}', fmtTime(ms))

type Planned = PlannedTask & { n: number }

const plannedOf = (f: Flow | null, list: AgentRun[]): Planned[] => {
  if (!f || f.isFinished) return []
  const started = new Set(list.map(a => norm(a.description)))
  return (f.tasks ?? []).map((t, i) => ({ ...t, n: i + 1 })).filter(t => !started.has(norm(t.title)))
}

const totals = (list: AgentRun[], at: number) => {
  const cost = list.reduce((s, a) => s + a.costUsd, 0)
  const tokens = list.reduce((s, a) => s + a.tokens, 0)
  const start = Math.min(...list.map(a => a.startedAt))
  const end = Math.max(...list.map(a => a.endedAt ?? Math.max(at, a.startedAt)))
  return { cost, tokens, time: list.length ? end - start : 0 }
}

// --- desktop drawings: each row is one SVG, as the band above the prompt is.

// The pane's backdrop: a dotted grid as tall as the content laid over it; the
// row SVGs are transparent, so it shows through between their marks.
const GRID_STEP = 16
// A Text or Button row on the desktop is about 20px; the grid errs taller.
const LINE_H = 24
// The engine refuses an Svg taller than 4096px, so a long grid is stacked from
// tiles of at most this height; a multiple of GRID_STEP keeps the dots aligned.
const GRID_TILE = 4096
const gridTiles = (H: number) => Array.from({ length: Math.ceil(H / GRID_TILE) }, (_, i) => Math.min(GRID_TILE, H - i * GRID_TILE))
const gridSvg = (W: number, H: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>.d{fill:#d9d8d4}@media (prefers-color-scheme: dark){.d{fill:#3a3a38}}</style>
<defs><pattern id="g" width="${GRID_STEP}" height="${GRID_STEP}" patternUnits="userSpaceOnUse"><circle class="d" cx="${GRID_STEP / 2}" cy="${GRID_STEP / 2}" r="1"/></pattern></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>
</svg>`

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

// Pixel Clawd from DockCrab (Clawdy): a 24×18 crab on a 30×28 grid, one costume per tier.
// The body keeps the brand clay; the tier's color lives in the costume's accent.
const CLAY = '#D97757'
const INK = '#1F1E1D'

// `cls` puts a pixel in a named group: `bd` (the default) is the body and its
// costume, `la`/`lb` the leg pairs, anything else a prop with its own motion.
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

// `armCls` lets a raised claw travel with the prop it holds.
const crabBody = (f: Fill, armFront = 0, armCls?: string): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK)
  f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

// Pure CSS, run by the compositor: no redraws. Periods divide one second, so the
// once-a-second redraw of a running row restarts them in phase. Every crab walks;
// each costume adds its prop's own motion on top.
const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
/* Acting, not walking: the feet stay put and the body leans into the work at a calmer beat. */
.act .la,.act .lb{animation:none!important}.run.act .bd{animation:bob 1s ease-in-out infinite}
.c-fable.run{animation:float 1s ease-in-out infinite}
.c-fable.run .la,.c-fable.run .lb,.c-fable.run .bd{animation:none}
.c-fable.run .ant{animation:blink 1s steps(1) infinite}
.c-fable.run .star{animation:blink .5s steps(1) infinite -.25s}
@keyframes float{50%{transform:translateY(-2px)}}@keyframes blink{50%{opacity:.15}}
.c-heavy.run .it{animation:scan 1s steps(1) infinite}
.c-heavy.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-careful.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
.c-medium.run .pan{transform-origin:0 50%;animation:tilt 1s ease-in-out infinite}
.c-medium.run .egg{animation:flip 1s ease-in-out infinite}
@keyframes tilt{20%,40%{transform:rotate(-12deg)}}@keyframes flip{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:translateY(0)}}
.c-light.run .la{animation-duration:.25s}.c-light.run .lb{animation-duration:.25s;animation-delay:-.125s}
.c-light.run .flag{transform-origin:0 50%;animation:wave .25s steps(1) infinite}
@keyframes wave{50%{transform:skewY(-12deg) scaleX(.85)}}
.c-explore.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
.c-review.run .it{animation:scan 1s steps(1) infinite}.c-review.run .gl{animation:blink 1s steps(1) infinite -.5s}
.c-build.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
.c-test.run .it{transform-origin:50% 100%;animation:shake .5s steps(2) infinite}.c-test.run .bub{animation:rise 1s steps(4) infinite}
@keyframes shake{25%{transform:rotate(10deg)}75%{transform:rotate(-10deg)}}@keyframes rise{100%{transform:translateY(-3px);opacity:0}}
.c-research.run .pg{animation:blink .5s steps(1) infinite}.c-research.run .tas{transform-origin:50% 0;animation:sway 1s ease-in-out infinite}
@keyframes sway{50%{transform:rotate(15deg)}}
.c-write.run .it{animation:scrib .5s steps(1) infinite}
@keyframes scrib{25%{transform:translate(1px,0)}50%{transform:translate(1px,1px)}75%{transform:translate(0,1px)}}
.c-plan.run .it{transform-origin:0 50%;animation:unroll 1s ease-in-out infinite}@keyframes unroll{50%{transform:scaleX(1.3)}}
.c-secure.run .pl{transform-origin:50% 100%;animation:sway .5s ease-in-out infinite}.c-secure.run .it{animation:st 1s steps(1) infinite}
.c-rest .bd{animation:breathe 4s ease-in-out infinite}
.c-rest .steam{animation:steam 2s ease-in-out infinite}.c-rest .steam2{animation:steam 2s ease-in-out infinite -1s}
.c-rest g{transform-box:fill-box}
@keyframes breathe{50%{transform:translateY(.6px)}}@keyframes steam{0%{opacity:0;transform:translateY(1px)}40%{opacity:.9}100%{opacity:0;transform:translateY(-3px)}}
@media (prefers-reduced-motion: reduce){.run,.run g,.c-rest .bd,.c-rest g{animation:none!important}}
</style>`

const COSTUMES: Record<string, (f: Fill, t: string) => void> = {
  // Fable: astronaut in a glass dome; floats instead of walking, the antenna and the star blink.
  fable: (f, t) => {
    crabBody(f)
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2')
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)'); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff')
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t)
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star')
  },
  // Heavy: detective with a deerstalker; the magnifier sweeps and glints.
  heavy: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  // Careful: engineer in a hard hat; the wrench turns a bolt.
  careful: (f, t) => {
    crabBody(f)
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it')
  },
  // Medium: chef, the toque traced from DockCrab's Sprites.chefHat; tosses the omelette.
  medium: (f, t) => {
    crabBody(f, -4, 'pan')
    stamp(f, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: t, d: '#B45F43' })
    f(22, 8, 7, 2, '#4A4A48', 'pan'); f(26, 10, 1, 1, '#4A4A48', 'pan'); f(24, 7, 3, 1, '#F5B731', 'egg')
  },
  // Light: racer in a helmet; runs at double pace, the checkered flag flutters.
  light: (f, t) => {
    crabBody(f, -4)
    stamp(f, 6, 5, ['....rrrrrrrrrr....', '..rrrrrrwwrrrrrr..', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.kkkkkkkkkkkkkkkkr'], { r: t, w: '#F8F6F1', k: INK })
    f(25, 1, 1, 9, '#8E929A')
    stamp(f, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK }, 'flag')
  },
  // Explore: pirate scouting the code; the cutlass fences.
  explore: f => {
    crabBody(f)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it')
  },
  // Test: lab goggles; the test tube shakes and bubbles.
  test: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 8, 11, ['kkkk......kkkk', 'k..kkkkkkkk..k', 'k..k......k..k', 'kkkk......kkkk'], { k: '#55514C' })
    f(7, 12, 1, 1, '#55514C'); f(22, 12, 1, 1, '#55514C')
    stamp(f, 24, 3, ['g.g', 'g.g', 'gtg', 'gtg', 'gtg', '.g.'], { g: '#C9CCD2', t }, 'it')
    f(25, 1, 1, 1, t, 'bub')
  },
  // Research: mortarboard with a swinging tassel; the open book's page turns.
  research: (f, t) => {
    crabBody(f, -3, 'it')
    // Navy, not black: a black board vanishes on a dark band.
    f(5, 7, 20, 1, '#5C6390'); f(5, 8, 20, 1, '#3C4166'); f(9, 9, 12, 1, '#3C4166'); f(14, 6, 2, 1, '#F5C542')
    f(6, 9, 1, 4, t, 'tas')
    stamp(f, 22, 6, ['cccccc', 'cppppc', 'cplppc', 'cppppc', 'cccccc'], { c: t, p: '#F8F6F1', l: '#C9CCD2' }, 'it')
    f(24, 8, 2, 1, '#8E929A', 'pg')
  },
  // Write: a beret; the quill scribbles.
  write: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 7, 6, ['...bbbbbbbbb....', '.bbbbbbbbbbbbbb.', 'bbbbbbbbbbbbbbbb', '.dddddddddddddd.'], { b: '#8C2F39', d: '#6E2430' })
    f(13, 5, 2, 1, '#8C2F39')
    stamp(f, 23, 4, ['.....wt', '....wtw', '...wtw.', '..wtw..', '.ww....', 'k......'], { w: '#F8F6F1', t, k: INK }, 'it')
  },
  // Plan: architect's glasses; the blueprint unrolls.
  plan: f => {
    crabBody(f, -4, 'it')
    stamp(f, 8, 11, ['kkkk......kkkk', 'k..kkkkkkkk..k', 'k..k......k..k', 'kkkk......kkkk'], { k: '#8E929A' })
    f(21, 7, 1, 3, '#2A5592', 'it')
    stamp(f, 22, 7, ['bbbbbbb', 'bwbwbwb', 'bbbbbbb'], { b: '#3B6FB6', w: '#DDE8F5' }, 'it')
  },
  // Secure: knight's helmet with a plume; the shield stands guard.
  secure: (f, t) => {
    crabBody(f)
    stamp(f, 6, 3, ['.....gggggggg.....', '...gggggggggggg...', '..gggggggggggggg..', '.gggggggggggggggg.', '.gghhhhhhhhhhhhgg.', 'gggggggggggggggggg'], { g: '#A9ADB5', h: '#7D828B' })
    f(14, 0, 2, 3, t, 'pl')
    stamp(f, 22, 11, ['ssssss', 'stwtts', 'swwwts', 'stwtts', '.stts.', '..ss..'], { s: '#8E929A', t, w: '#F8F6F1' }, 'it')
  },
  // Rest: between turns, eyes half shut over a mug of coffee; the steam curls up.
  rest: f => {
    crabBody(f)
    f(9, 12, 2, 1, CLAY); f(19, 12, 2, 1, CLAY)
    stamp(f, 23, 11, ['wwww.', 'wccwh', 'wwww.h', 'wwww.'], { w: '#F4F3EE', c: '#6B4226', h: '#F4F3EE' }, 'mug')
    f(24, 6, 1, 3, '#C9CCD2', 'steam'); f(26, 5, 1, 3, '#C9CCD2', 'steam2')
  },
  other: f => crabBody(f),
}
// Review and build wear the detective's and the engineer's kit.
COSTUMES.review = COSTUMES.heavy as (f: Fill, t: string) => void
COSTUMES.build = COSTUMES.careful as (f: Fill, t: string) => void

// What a subagent is doing, read from its type and then its task description; the first match wins
// (research before explore: "research" holds "search").
const WORKS: readonly [work: string, pattern: RegExp][] = [
  ['secure', /secur|vuln|threat|pentest|exploit|xss|csrf|injection|\bcve\b/],
  ['review', /review|audit|verif|inspect|critique|\bcheck|validat|\blint/],
  ['test', /\btest|debug|reproduc|benchmark|diagnos|bisect|\bqa\b/],
  ['plan', /\bplan|design|architect|\bspec\b|outline|roadmap|strateg/],
  ['research', /research|investigat|analy[sz]|compar|\bstudy|summar|evaluat|\bweb\b|\bread/],
  ['explore', /explor|search|\bfind|locat|\bscan|\bmap\b|grep|look ?up|discover|\bcount|\blist\b|inventor/],
  ['write', /\bwrit|draft|document|readme|translat|changelog|\bdocs?\b|\bcopy\b|blog|email/],
  ['build', /implement|\bbuild|\bfix|\bcod(e|ing)|refactor|\badd|creat|updat|migrat|\bwire|\bport\b|patch|install|deploy|generat|\bmake|\bedit/],
]

const WORK_COLOR: Record<string, string> = {
  explore: '#2E86AB',
  review: '#8E5BB5',
  build: '#D9A021',
  test: '#2FA58A',
  research: '#4F6BD8',
  write: '#C2557A',
  plan: '#3B7DC4',
  secure: '#6B7A8F',
}

// Terminal rows have no drawings: one glyph per kind of work.
const WORK_GLYPH: Record<string, string> = {
  explore: '⌕', review: '◉', build: '⚒', test: '⚗', research: '❐', write: '✎', plan: '▦', secure: '⛨',
}

const workOf = (type: string, description = ''): string | null => {
  const bare = type.replace(/^[^:]*:/, '')
  if (bare === 'Explore') return 'explore'
  if (bare === 'Plan') return 'plan'
  // A named agent type says its work (a reviewer, a security scanner); savvy tiers and general-purpose say nothing.
  const typed = WORKS.find(([, re]) => re.test(type.toLowerCase()))
  if (typed && !bare.startsWith('savvy-') && bare !== 'general-purpose') return typed[0]
  return WORKS.find(([, re]) => re.test(description.toLowerCase()))?.[0] ?? null
}

const workWord = (work: string): string => (tr().work as Record<string, string>)[work] ?? work

// The crab dresses for the work; with no work to read, a savvy worker keeps its tier's costume.
const costumeOf = (type: string, description = ''): string => workOf(type, description) ?? tierOf(type)

const CRAB_SCALE = 1.1

// Costumes whose motion is the walk itself: the plain crab, the racer, the floating astronaut.
// Every other costume stands and works its prop.
const WALKERS = new Set(['other', 'light', 'fable'])

// Body and props nest inside `bd` so a prop rides the bob and adds its own motion;
// legs stay outside it and step on their own. `mirror` flips the crab inside its
// own box (x .. x + CRAB_BOX * scale) so it faces left.
const crab = (x: number, y: number, costume: string, dim = false, isWalking = false, scale = CRAB_SCALE, mirror = false): string => {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  const draw = COSTUMES[costume] ?? ((g: Fill) => crabBody(g))
  draw(f, colorOf(costume))
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`
  const place = mirror ? `translate(${x + CRAB_BOX * scale},${y}) scale(${-scale},${scale})` : `translate(${x},${y}) scale(${scale})`
  const isActing = isWalking && !WALKERS.has(costume)
  return `<g transform="${place}" opacity="${dim ? 0.45 : 1}" shape-rendering="crispEdges"><g class="c-${costume}${isWalking ? ' run' : ''}${isActing ? ' act' : ''}">${body}${group('la')}${group('lb')}</g></g>`
}

const statusMark = (x: number, y: number, status: string, color: string): string => {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done') return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (status === 'failed') return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
  return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#9a9a96" stroke-width="1.4"/><path d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke="#9a9a96" stroke-width="1.4" stroke-linecap="round"/>`
}

// Panel rows are laid out left to right; in Hebrew each box mirrors across the
// row (`mx`) and text hugs the mirrored side. `words` text may hold Hebrew and
// takes `direction="rtl"` (whose `start` is the right edge); numbers stay
// left to right so "≈$0.25" keeps its order.
const mx = (W: number, x: number, w = 0): number => (isRtl() ? W - x - w : x)

// Text that starts at x: left-aligned, or right-aligned at the mirrored x.
const startText = (W: number, x: number, y: number, words = true): string =>
  !isRtl()
    ? `x="${x}" y="${y}"`
    : `x="${W - x}" y="${y}"${words ? ' direction="rtl" text-anchor="start"' : ' text-anchor="end"'}`

// Text that ends at x: right-aligned, or left-aligned at the mirrored x.
const endText = (W: number, x: number, y: number, words = false): string =>
  !isRtl() ? `x="${x}" y="${y}" text-anchor="end"` : `x="${W - x}" y="${y}"${words ? ' direction="rtl" text-anchor="end"' : ''}`

const crabWidth = (scale: number): number => Math.round(CRAB_BOX * scale * 100) / 100

// A panel crab at x in a row of width W: on the mirrored side and facing left in Hebrew.
const rowCrab = (W: number, x: number, y: number, costume: string, dim = false, isWalking = false): string =>
  crab(mx(W, x, crabWidth(CRAB_SCALE)), y, costume, dim, isWalking, CRAB_SCALE, isRtl())

const svg = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${CRAB_CSS}${body}</svg>`

// The pane's own title already says "Agents": the header names the flow, if any.
const headerSvg = (W: number, title: string, t: ReturnType<typeof totals>): string => {
  const s = tr()
  const gap = 6
  const tw = (W - gap * 2) / 3
  const top = title ? 28 : 0
  const tile = (i: number, k: string, v: string) =>
    `<rect class="tile" x="${mx(W, i * (tw + gap), tw)}" y="${top}" width="${tw}" height="40" rx="8"/>
<text class="s" ${startText(W, i * (tw + gap) + 9, top + 16)} font-family="${FONT}" font-size="11">${k}</text>
<text class="t" ${startText(W, i * (tw + gap) + 9, top + 33, false)} font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${v}</text>`
  return svg(
    W,
    headerHeight(title),
    `${title ? `<text class="t" ${startText(W, 0, 15)} font-family="${FONT}" font-size="14" font-weight="600">${xml(fitText(title, 14, W))}</text>` : ''}
${tile(0, s.cost, '≈' + fmtCost(t.cost))}${tile(1, s.tokens, fmtTokens(t.tokens))}${tile(2, s.time, fmtTime(t.time))}`,
  )
}

const headerHeight = (title: string): number => (title ? 72 : 44)

// The task's own progress when the worker reports steps; a finished run is full.
const progressOf = (a: AgentRun): number | null => {
  if (a.status === 'done') return 1
  if (a.stepTotal) return Math.min(1, (a.stepDone ?? 0) / a.stepTotal)
  return null
}

const ctxOf = (a: AgentRun): number => (a.contextMax ? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100)) : 0)

const agentSvg = (W: number, a: AgentRun, at: number): string => {
  const s = tr()
  const tier = tierOf(a.type)
  const color = colorOf(tier)
  const ctx = ctxOf(a)
  const textW = W - 42 - 22
  const meta = [runModel(a)]
  const work = workOf(a.type, a.description)
  if (work) meta.push(workWord(work))
  if (a.round > 1) meta.push(`${s.round} ${a.round}`)
  if (a.status === 'failed') meta.push(s.failed)
  const barW = textW
  const progress = progressOf(a)
  const left = agentLeft(a, at)
  const stats = `${s.ctx} ${ctx}% · ${fmtTokens(a.contextTokens)}  ≈${fmtCost(a.costUsd)}  ${fmtTime(elapsed(a, at))}${left === null ? '' : ` · ${fmtLeft(left)}`}`
  const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' · ' + a.stepNote : ''}` : ''
  const stepsW = Math.max(0, barW - textWidth(stats, 11) - 12)
  // Without reported steps there is no progress to draw: a running row gets a moving stripe that
  // says it is working, a finished one an empty track. The context stays in the words beside it.
  const fillW = Math.round(barW * (progress ?? 0))
  const busyW = Math.max(24, Math.round(barW * 0.18))
  const busy =
    progress === null && a.status === 'running'
      ? `<g clip-path="url(#bw${a.id.replace(/[^\w-]/g, '')})"><rect class="busy" x="${mx(W, 42 - busyW, busyW)}" y="55" width="${busyW}" height="4" rx="2" fill="${color}" opacity="0.7"/></g>
<defs><clipPath id="bw${a.id.replace(/[^\w-]/g, '')}"><rect x="${mx(W, 42, barW)}" y="55" width="${barW}" height="4" rx="2"/></clipPath></defs>
<style>.busy{animation:busy 1.6s cubic-bezier(.45,0,.55,1) infinite}@keyframes busy{to{transform:translateX(${isRtl() ? -(barW + busyW) : barW + busyW}px)}}@media (prefers-reduced-motion: reduce){.busy{animation:none;opacity:.35}}</style>`
      : ''
  return svg(
    W,
    66,
    `${rowCrab(W, 0, 14, costumeOf(a.type, a.description), false, a.status === 'running')}
<text class="t" ${startText(W, 42, 18)} font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(a.description || a.type, 13, textW))}</text>
<text ${startText(W, 42, 34)} font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(tier === 'other' ? a.type : tierWord(tier))}</tspan><tspan class="s">  ${xml(meta.join('  ·  '))}</tspan></text>
${steps && stepsW > 30 ? `<text class="t" ${startText(W, 42, 49)} font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(steps, 11, stepsW))}</text>` : ''}
<text class="s" ${endText(W, 42 + barW, 49, true)} font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${stats}</text>
<rect class="k" x="${mx(W, 42, barW)}" y="55" width="${barW}" height="4" rx="2"/>${fillW > 0 ? `<rect x="${mx(W, 42, fillW)}" y="55" width="${fillW}" height="4" rx="2" fill="${color}"/>` : ''}${busy}
${statusMark(mx(W, W - 8), 16, a.status, color)}
<line class="ln" x1="0" y1="65.5" x2="${W}" y2="65.5"/>`,
  )
}

const plannedSvg = (W: number, p: Planned): string => {
  const tier = p.tier in TIER_COLOR ? p.tier : 'other'
  const color = colorOf(tier)
  const textW = W - 42 - 22
  const meta = [tierModel(tier)]
  if (p.after.length) meta.push(`${tr().after} ${p.after.join(', ')}`)
  return svg(
    W,
    46,
    `${rowCrab(W, 0, 6, costumeOf(`savvy-${tier}`, p.title), true)}
<text class="s" ${startText(W, 42, 18)} font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(`${p.n}. ${p.title}`, 13, textW))}</text>
<text ${startText(W, 42, 34)} font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(tierWord(tier))}</tspan><tspan class="m">  ${xml(meta.filter(Boolean).join('  ·  '))}</tspan></text>
${statusMark(mx(W, W - 8), 16, 'planned', color)}
<line class="ln" x1="0" y1="45.5" x2="${W}" y2="45.5"/>`,
  )
}

const compactSvg = (W: number, list: AgentRun[], planned: Planned[], t: ReturnType<typeof totals>): string => {
  const icons = [
    ...list.filter(a => a.status === 'running').map(a => ({ k: costumeOf(a.type, a.description), c: colorOf(tierOf(a.type)), s: 'running', dim: false })),
    ...list.filter(a => a.status !== 'running').map(a => ({ k: costumeOf(a.type, a.description), c: colorOf(tierOf(a.type)), s: a.status, dim: false })),
    ...planned.map(p => ({ k: costumeOf(`savvy-${p.tier}`, p.title), c: colorOf(p.tier), s: 'planned', dim: true })),
  ]
  const fit = Math.max(1, Math.floor((W - 150) / 36))
  const shown = icons.slice(0, fit)
  const more = icons.length - shown.length
  const body = shown
    .map((ic, i) => rowCrab(W, i * 36, 0, ic.k, ic.dim, ic.s === 'running') + (ic.s === 'running' ? `<circle class="live" cx="${mx(W, i * 36 + 32)}" cy="4" r="3" fill="${ic.c}"/>` : ''))
    .join('')
  const x = shown.length * 36 + (more ? 4 : 0)
  return svg(
    W,
    32,
    `${body}${more ? `<text class="s" ${startText(W, x, 21, false)} font-family="${FONT}" font-size="12">+${more}</text>` : ''}
<text class="s" ${endText(W, W, 21)} font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">≈${fmtCost(t.cost)} · ${fmtTokens(t.tokens)} · ${fmtTime(t.time)}</text>`,
  )
}

// --- terminal drawing: the same rows in text.

const ctxBar = (pct: number, width: number): string => {
  const filled = Math.round((width * pct) / 100)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

const STATUS_GLYPH: Record<string, string> = { running: '●', done: '✓', failed: '✗', planned: '◷' }

// Opens the agents pane, or closes it when it is up; true when it ends up open.
// A run whose end never reached the mod (stopped, or ended while waiting on work of its own)
// would stay "running" for good and count as an open task. Claude Code's own list says which
// runs are alive: one it reports ended, or no longer lists, is closed at the last time it was
// seen working, so it falls out of the current batch. A run just spawned may not be listed yet.
const ENDED = new Set(['completed', 'failed', 'killed'])
const LIST_GRACE_MS = 10_000

async function reconcile($: EngineInterface, at: number): Promise<void> {
  const live = await $.agent.list().catch(() => null)
  if (live === null) return
  const byId = new Map(live.map(info => [info.id, info]))
  const isGone = (a: AgentRun): boolean => {
    if (a.status !== 'running' || !a.agentId) return false
    const info = byId.get(a.agentId)
    return info ? ENDED.has(info.status) : at - a.startedAt > LIST_GRACE_MS
  }
  if (!(await read($, agents)).some(isGone)) return
  await update($, agents, list =>
    list.map((a): AgentRun => {
      if (!isGone(a)) return a
      const info = a.agentId ? byId.get(a.agentId) : undefined
      return { ...a, status: info && info.status !== 'completed' ? 'failed' : 'done', endedAt: Math.min(at, a.seenAt ?? a.startedAt) }
    }),
  )
}

// The track's looks. /bar-style picks one and keeps it in the store, so it holds across
// sessions and wins over the setting; with neither, the liquid.
const BAR_STYLES = ['liquid', 'pixels', 'crab', 'aurora', 'circuit'] as const
type BarStyle = (typeof BAR_STYLES)[number]
const isBarStyle = (v: unknown): v is BarStyle => typeof v === 'string' && (BAR_STYLES as readonly string[]).includes(v)
const BAR_STYLE_HELP = 'liquid (the default): a liquid with a rippling edge, drifting ripples and rising bubbles · pixels: a dithered fill of twinkling pixels · crab: a crab walks the track to where the work has got to, leaving footprints · aurora: soft lights drift through the fill · circuit: a lit circuit trace with a pulse running to its head'

async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  const at = await $.clock.now()
  await update($, now, () => at)
  await $.ui.open({ id: PANE, title: tr().pane })
  return true
}

async function autoOpen($: EngineInterface, key: string): Promise<void> {
  const p = await read($, panel)
  if (p.autoOpenedFor === key) return
  await update($, panel, prev => ({ ...prev, autoOpenedFor: key }))
  void $.ui.open({ id: PANE, title: tr().pane })
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    lang = await detectLang($, options.language)
    await $.tool.register({
      name: 'progress',
      description:
        'Report /savvy-flow progress to the progress bar above the prompt and the agents panel. ' +
        'Call it after presenting the plan (title, total, tasks, phase "delegate"), each time a task is accepted (done), ' +
        'when switching phase or re-planning (tasks), and once at the end with finished: true. Fields left out keep their previous value. ' +
        'For the main session only: a call from a subagent is ignored (workers report with `step`).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name of the overall task, a few words.' },
          total: { type: 'integer', minimum: 0, description: 'Number of planned worker tasks.' },
          done: { type: 'integer', minimum: 0, description: 'Number of tasks accepted after review.' },
          phase: { type: 'string', enum: [...PHASES] },
          finished: { type: 'boolean', description: 'True once the flow is closed.' },
          tasks: {
            type: 'array',
            description:
              'The planned worker tasks in order, numbered from 1. Each title must equal the Agent tool `description` the task will be delegated with, so the panel can match runs to tasks.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'A few words; reused verbatim as the Agent description.' },
                tier: { type: 'string', enum: [...TIERS] },
                after: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the tasks this one waits for.' },
              },
              required: ['title', 'tier'],
            },
          },
        },
      },
    })
    await $.tool.register({
      name: 'step',
      description:
        'For savvy-flow workers: report progress on your own task to the agents panel. ' +
        'Right after reading the brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; ' +
        'call it again as each step finishes. Cheap and silent: it only draws a bar.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
        },
        required: ['done'],
      },
      // In every agent's tool list, not behind ToolSearch: workers do not go looking for it.
      isDeferred: false,
    })
    await $.command.register({
      name: 'bar-style',
      description: 'Pick the progress bar look: pixels or liquid',
    })
    const storedStyle = await $.store.get('barStyle').catch(() => undefined)
    if (isBarStyle(storedStyle)) await update($, barStyleAtom, () => storedStyle)
    await $.command.register({
      name: 'agents-info',
      description: 'Show or hide the panel of subagents: running, finished and planned, with model, context, cost and time',
    })

    // Ticks the running agents' clocks and the main session's; quiet when nothing runs.
    $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, agents)
        const m = await read($, main)
        if (!list.some(a => a.status === 'running') && !m.isWorking) return
        const at = await $.clock.now()
        if (list.some(a => a.status === 'running')) await reconcile($, at)
        await update($, now, () => at)
      })()
    })
    // autoOpen 'always': the panel opens with every session.
    if (options.autoOpen === 'always') await autoOpen($, 'session')
    return started
  })

  // A follow-up message wakes a subagent for a new run, which never saw its spawn's brief:
  // the brief rides along, so the new run reports its steps too (as the setting allows).
  on('session.send', async ($, e, next) => {
    if (e.text.includes(STEP_TOOL)) return next(e)
    const row = (await read($, agents)).find(a => a.agentId !== undefined && a.agentId === e.to)
    if (!row) return next(e)
    const isSavvy = row.type.startsWith('savvy-')
    const brief = isSavvy ? STEP_BRIEF : options.stepReports !== 'savvy' ? ANY_BRIEF : ''
    return next(brief ? { ...e, text: e.text + brief } : e)
  })

  on('command.run', { command: 'bar-style' }, async ($, e) => {
    const asked = (e.args ?? '').trim().toLowerCase()
    const current = (await read($, barStyleAtom)) || (isBarStyle(options.barStyle) ? options.barStyle : 'liquid')
    if (!isBarStyle(asked)) return { text: `Progress bar style: ${current}. Choose with /bar-style <style>: ${BAR_STYLE_HELP}.` }
    await update($, barStyleAtom, () => asked)
    await $.store.set('barStyle', asked).catch(() => undefined)
    return { text: `Progress bar style set to ${asked}.` }
  })

  on('command.run', { command: 'agents-info' }, async ($, e) => {
    // `/agents-info open` opens the panel, or brings it forward from behind another tab, without toggling it.
    if ((e.args ?? '').trim() === 'open') {
      const at = await $.clock.now()
      await update($, now, () => at)
      await $.ui.open({ id: PANE, title: tr().pane })
      return { text: tr().opened }
    }
    const isOpen = await togglePane($)
    return { text: isOpen ? tr().opened : tr().closed }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    // The flow is the main session's: a call from a worker's loop carries its agentId
    // and changes nothing, or any subagent could rename, finish or reset the flow.
    if (e.agentId) return { result: 'ignored: only the main session reports the flow' }
    const input = e as unknown as ProgressInput
    const prev = await read($, flow)
    if (isNewFlow(prev, input) && input.title !== undefined) {
      // A new flow starts with a clean list; agents still running stay.
      await update($, agents, list => list.filter(a => a.status === 'running'))
    }
    const reportedAt = await $.clock.now().catch(() => undefined)
    const next = await update($, flow, p => {
      const merged = merge(p, input)
      const moved = input.done !== undefined && merged.done !== (isNewFlow(p, input) ? 0 : (p?.done ?? 0))
      return moved && reportedAt !== undefined ? { ...merged, progressAt: reportedAt } : merged
    })
    if (next && input.tasks?.length) await autoOpen($, next.title)
    return { result: `ok: ${label(next ?? blank())}` }
  })

  // A worker's own progress: the call runs in the worker's loop, so agentId names it.
  on('tool.call', { tool: STEP_TOOL }, async ($, e) => {
    const input = e as unknown as { done?: number; total?: number; note?: string }
    const agentId = e.agentId
    if (!agentId) return { result: 'ignored: only subagents report steps' }
    const seen = await $.clock.now()
    let matched = false
    await update($, agents, list =>
      list.map(a => {
        if (a.agentId !== agentId) return a
        matched = true
        const total = Math.max(0, Math.round(input.total ?? a.stepTotal ?? 0))
        const done = Math.max(0, Math.round(input.done ?? a.stepDone ?? 0))
        const stepDone = total ? Math.min(total, done) : done
        const moved = stepDone !== (a.stepDone ?? 0) || total !== (a.stepTotal ?? 0)
        return { ...a, stepTotal: total, stepDone, stepNote: input.note?.trim() || undefined, seenAt: seen, stepAt: moved ? seen : a.stepAt }
      }),
    )
    return { result: matched ? 'ok' : `ignored: no panel row for agent ${agentId}` }
  })

  // Safety net: worker launches move the faint layer even if the orchestrator forgets to report.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const type = String(e.subagent_type ?? '')
    if (!type.startsWith('savvy-')) return next(e)

    await update($, flow, prev => {
      const base = prev && !prev.isFinished ? { ...blank(), ...prev } : blank()
      return { ...base, running: base.running + 1, phase: base.phase === 'plan' ? 'delegate' : base.phase }
    })
    try {
      return await next(e)
    } finally {
      await update($, flow, prev => (prev ? { ...prev, running: Math.max(0, prev.running - 1) } : prev))
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const isSavvy = e.subagentType.startsWith('savvy-')
    const brief = isSavvy ? STEP_BRIEF : options.stepReports !== 'savvy' ? ANY_BRIEF : ''
    const started = await next(brief && !e.prompt.includes(STEP_TOOL) ? { ...e, prompt: e.prompt + brief } : e)
    if (started.deny !== undefined) return started

    const at = await $.clock.now()
    await update($, agents, list => {
      const round = 1 + list.filter(a => norm(a.description) === norm(e.description) && e.description).length
      const run: AgentRun = {
        id: started.agentId ?? e.tool_use_id,
        agentId: started.agentId,
        type: e.subagentType,
        description: e.description,
        model: started.model,
        status: 'running',
        startedAt: at,
        seenAt: at,
        contextTokens: 0,
        contextMax: windowOf(started.model),
        tokens: 0,
        costUsd: 0,
        steps: 0,
        round,
      }
      return [...list.filter(a => a.id !== run.id), run].slice(-200)
    })
    await update($, now, () => at)
    // The flow's clock starts with its first worker: the time-left estimate counts from here.
    await update($, flow, f => (f && !f.isFinished && f.startedAt === undefined ? { ...f, startedAt: at } : f))
    if (e.subagentType.startsWith('savvy-')) {
      const f = await read($, flow)
      await autoOpen($, f && !f.isFinished ? f.title : 'savvy-flow')
    } else if (options.autoOpen !== 'savvy') {
      await autoOpen($, 'any-agent')
    }
    return started
  })

  // Each model request of a subagent: live context, tokens and cost.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!agentId || !usage) return result

    const model = usage.model || e.model
    const seen = await $.clock.now()
    await update($, agents, list =>
      list.map((a): AgentRun =>
        a.agentId !== agentId
          ? a
          : {
              ...a,
              model,
              effort: typeof e.effort === 'string' ? e.effort : a.effort,
              status: 'running',
              endedAt: undefined,
              seenAt: seen,
              contextTokens:
                (usage.input_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0) +
                (usage.output_tokens || 0),
              contextMax: windowOf(model),
              tokens:
                a.tokens +
                (usage.input_tokens || 0) +
                (usage.output_tokens || 0) +
                (usage.cache_read_input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0),
              costUsd: a.costUsd + costOf(model, usage, true),
              steps: a.steps + 1,
            },
      ),
    )
    return result
  })

  // The main session's own turn: no agentId on the main loop. A subagent's turn that starts while
  // its row stands finished is that agent woken again (a message sent to it): a new round, with
  // the first run's steps cleared, counted as open work again.
  on('turn.start', async ($, e, next) => {
    if (e.agentId) {
      const agentId = e.agentId
      const list = await read($, agents)
      if (list.some(a => a.agentId === agentId && a.status !== 'running')) {
        const at = await $.clock.now()
        await update($, agents, rows =>
          rows.map((a): AgentRun =>
            a.agentId !== agentId || a.status === 'running'
              ? a
              : { ...a, status: 'running', startedAt: at, seenAt: at, endedAt: undefined, round: a.round + 1, stepDone: undefined, stepTotal: undefined, stepNote: undefined, stepAt: undefined },
          ),
        )
        await update($, now, () => at)
      }
    }
    if (!e.agentId) {
      const at = await $.clock.now()
      await update($, main, () => ({ isWorking: true, startedAt: at, toolCalls: 0 }))
      await update($, now, () => at)
    }
    return next(e)
  })

  // Every tool call of the main loop counts; a subagent's carries its agentId.
  on('tool.call', async ($, e, next) => {
    if (!e.agentId) {
      const work = toolWork(e.tool, e as unknown as Record<string, unknown>)
      await update($, main, m => (m.isWorking ? { ...m, toolCalls: m.toolCalls + 1, lastTool: e.tool, work } : m))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const ended = await $.clock.now()
      await update($, main, m => ({ ...m, isWorking: false, endedAt: ended }))
    }
    const agentId = e.agentId
    if (agentId) {
      const at = await $.clock.now()
      await update($, agents, list =>
        list.map((a): AgentRun => {
          if (a.agentId !== agentId) return a
          // A run whose steps went unseen still gets the turn's own sum.
          const fallback = a.steps === 0 && e.usage
          return {
            ...a,
            status: e.reason === 'answer' ? 'done' : 'failed',
            endedAt: at,
            ...(fallback && e.usage
              ? {
                  model: e.usage.model || a.model,
                  tokens:
                    e.usage.input_tokens +
                    e.usage.output_tokens +
                    e.usage.cache_read_input_tokens +
                    e.usage.cache_creation_input_tokens,
                  costUsd: costOf(e.usage.model || a.model, e.usage, false),
                }
              : {}),
          }
        }),
      )
      await update($, now, () => at)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = tr()
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const f = await read($, flow)
    const p: Panel = await read($, panel)
    const at = Math.max(await read($, now), ...list.map(a => a.startedAt), 0)

    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const planned = plannedOf(f, list)
    const t = totals(list, at)
    // The pane's title says "Agents"; inside, only the flow's own name.
    const title = f && !f.isFinished ? f.title : ''

    const toggleCompact = (
      <Button
        key="compact"
        label={p.isCompact ? s.expand : s.collapse}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isCompact: !prev.isCompact }))}
      />
    )
    const toggleDone = (
      <Button
        key="done"
        label={`${p.isDoneCollapsed ? (isRtl() ? '◂' : '▸') : '▾'} ${s.finished} · ${finished.length}`}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
      />
    )
    const isEmpty = list.length === 0 && planned.length === 0
    const summary = `≈${fmtCost(t.cost)}, ${fmtTokens(t.tokens)} ${s.tokensWord}, ${fmtTime(t.time)}`

    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui
      const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
      const section = (key: string, text: string) => (
        <Text key={key} dimColor>
          {text}
        </Text>
      )

      // In Hebrew the column hugs the right edge: section heads and buttons right-aligned.
      const align = isRtl() ? 'flex-end' : undefined
      if (p.isCompact) {
        return (
          <Box flexDirection="column" gap={1} alignItems={align}>
            <Svg source={compactSvg(W, list, planned, t)} alt={`${list.length} ${s.agentsCount}, ${summary}`} width={W} height={32} />
            {toggleCompact}
          </Box>
        )
      }
      const shownDone = p.isDoneCollapsed ? 0 : finished.length
      const lines = 1 + (isEmpty ? 1 : 0) + (running.length > 0 ? 1 : 0) + (finished.length > 0 ? 1 : 0) + (planned.length > 0 ? 1 : 0)
      const gridH = headerHeight(title) + lines * LINE_H + (running.length + shownDone) * 66 + planned.length * 46
      return (
        <Box flexDirection="column">
          {/* The grid sizes the pane; the content is placed over it, as an
              absolute Box paints over the siblings before it. */}
          {gridTiles(gridH).map((tileH, i) => (
            <Svg key={`grid-${i}`} source={gridSvg(W, tileH)} alt="dotted grid" width={W} height={tileH} />
          ))}
          <Box flexDirection="column" position="absolute" top={0} left={0} right={0} alignItems={align}>
            <Svg source={headerSvg(W, title, t)} alt={title ? `${title}: ${summary}` : summary} width={W} height={headerHeight(title)} />
            {toggleCompact}
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {running.length > 0 && section('h-run', `${s.running} · ${running.length}`)}
            {running.map(a => (
              <Svg key={a.id} source={agentSvg(W, a, at)} alt={`${a.description}: ${modelName(a.model)}, ${s.isRunning}`} width={W} height={66} />
            ))}
            {finished.length > 0 && toggleDone}
            {!p.isDoneCollapsed &&
              finished.map(a => (
                <Svg key={a.id} source={agentSvg(W, a, at)} alt={`${a.description}: ${modelName(a.model)}, ${s.isFinished}`} width={W} height={66} />
              ))}
            {planned.length > 0 && section('h-plan', `${s.planned} · ${planned.length}`)}
            {planned.map(pl => (
              <Svg key={`plan-${pl.n}`} source={plannedSvg(W, pl)} alt={`${pl.n}. ${pl.title}: ${s.isPlanned}`} width={W} height={46} />
            ))}
          </Box>
        </Box>
      )
    }

    // Terminal: the same content in text rows.
    const cols = Math.max(24, e.props.bodyColumns || 40)
    const barW = Math.max(6, Math.min(20, cols - 34))
    const row = (a: AgentRun) => {
      const tier = tierOf(a.type)
      const color = colorOf(tier)
      const ctx = ctxOf(a)
      const progress = progressOf(a)
      const model = runModel(a)
      const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' ' + a.stepNote : ''} · ` : ''
      return (
        <Box key={a.id} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={color}>{WORK_GLYPH[workOf(a.type, a.description) ?? ''] ?? '▣'}</Text>
            <Text bold wrap="truncate-end">
              {a.description || a.type}
            </Text>
            <Text color={a.status === 'failed' ? 'red' : a.status === 'done' ? 'green' : color}>{STATUS_GLYPH[a.status]}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {'  '}
            {tier === 'other' ? a.type : tierWord(tier)} · {model}
            {workOf(a.type, a.description) ? ` · ${workWord(workOf(a.type, a.description) ?? '')}` : ''}
            {a.round > 1 ? ` · ${s.round} ${a.round}` : ''}
          </Text>
          <Text wrap="truncate-end">
            {'  '}
            {progress === null ? <Text dimColor>{ctxBar(0, barW)}</Text> : <Text color={color}>{ctxBar(progress * 100, barW)}</Text>}
            <Text dimColor>
              {' '}
              {steps}{s.ctx} {ctx}% · {fmtTokens(a.contextTokens)} ≈{fmtCost(a.costUsd)} {fmtTime(elapsed(a, at))}
              {agentLeft(a, at) === null ? '' : ` · ${fmtLeft(agentLeft(a, at) ?? 0)}`}
            </Text>
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold wrap="truncate-end">
            {title}
          </Text>
          {toggleCompact}
        </Box>
        <Text dimColor>
          ≈{fmtCost(t.cost)} · {fmtTokens(t.tokens)} {s.tokensWord} · {fmtTime(t.time)}
        </Text>
        {p.isCompact ? (
          <Text wrap="truncate-end">
            {[...running, ...finished].map(a => (
              <Text key={a.id} color={colorOf(tierOf(a.type))}>
                {STATUS_GLYPH[a.status]}{' '}
              </Text>
            ))}
            {planned.map(pl => (
              <Text key={`plan-${pl.n}`} dimColor>
                ◷{' '}
              </Text>
            ))}
          </Text>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {running.length > 0 && <Text dimColor>{s.running} · {running.length}</Text>}
            {running.map(row)}
            {finished.length > 0 && toggleDone}
            {!p.isDoneCollapsed && finished.map(row)}
            {planned.length > 0 && <Text dimColor>{s.planned} · {planned.length}</Text>}
            {planned.map(pl => {
              const tier = pl.tier in TIER_COLOR ? pl.tier : 'other'
              return (
                <Box key={`plan-${pl.n}`} flexDirection="column" marginBottom={1}>
                  <Text dimColor wrap="truncate-end">
                    <Text color={colorOf(tier)}>▢</Text> {pl.n}. {pl.title} ◷
                  </Text>
                  <Text dimColor wrap="truncate-end">
                    {'  '}
                    {tierWord(tier)} · {tierModel(tier)}
                    {pl.after.length ? ` · ${s.after} ${pl.after.join(', ')}` : ''}
                  </Text>
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const reported = await read($, flow)
    const list = await read($, agents)
    // A reported flow wins, unless it is finished and new subagents are running.
    const isLive = list.some(a => a.status === 'running')
    const shown = reported && !(reported.isFinished && isLive) ? reported : autoFlow(list)
    const f = shown && withPartial(shown, list)
    if (e.props.hasSurvey) return next(e)
    if (f === null) {
      const m = await read($, main)
      if (options.mainBar === 'off') return next(e)
      const drawnBelow = await Promise.resolve(next(e)).catch(() => null)
      const beneath = drawnBelow && typeof drawnBelow === 'object' && (drawnBelow as { type?: string }).type !== 'engine' ? drawnBelow : null
      const at = Math.max(await read($, now), m.startedAt)
      const ui = $.ui.resolve(e)
      const { Box, Text, Button } = ui
      // With subagents in the session, the count sits beside the crab here too, so the crab keeps its place as the bar changes.
      const crew = list.length ? <Button key="savvy-agents" label={`×${list.length}`} plain onPress={() => void togglePane($)} /> : null
      if (e.surface !== 'terminal' && 'Svg' in ui) {
        const { Svg } = ui
        const row = isRtl() ? 'row-reverse' : 'row'
        const slot = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 16))
        const head = headSvg(mainHead(m), m.isWorking ? ACCENT : DONE, m.isWorking)
        const line = mainLine(m, at)
        const stats = statSvg(line, Math.max(40, slot - head.width - bandCrabW - 80))
        const work = mainCostume(m)
        // Head and figures read as one phrase on the left; the crab holds the far edge; the gap between them is what the row has left.
        return (
          <Box flexDirection="column">
            <Box key="savvy-main" flexDirection={row} justifyContent="space-between" alignItems="center">
              <Box flexDirection={row} alignItems="center" gap="sm">
                <Svg source={head.source} alt={mainHead(m)} width={head.width} height={H} />
                {line ? <Svg source={stats.source} alt={line} width={stats.width} height={H} /> : null}
              </Box>
              <Box flexDirection={row} alignItems="center" gap="xs">
                <Svg source={crabSvg(work, m.isWorking)} alt={work === 'rest' ? 'crab resting' : `crab at work: ${workWord(work)}`} width={bandCrabW} height={CRAB_H} />
                {crew}
              </Box>
            </Box>
            {beneath ? <Box key="savvy-below" flexDirection="column" marginTop="sm">{beneath}</Box> : null}
          </Box>
        )
      }
      return (
        <Box flexDirection="column">
          <Box key="savvy-main" flexDirection="row" gap={1}>
            <Text color={m.isWorking ? ACCENT : DONE}>●</Text>
            <Text bold>{mainHead(m)}</Text>
            {m.isWorking && <Text color={colorOf(mainCostume(m))}>{WORK_GLYPH[mainCostume(m)] ?? '▣'}</Text>}
            <Text dimColor wrap="truncate-end">{mainLine(m, at)}</Text>
          </Box>
          {beneath}
        </Box>
      )
    }
    // Draw this row with the other mods' bands beneath it. Claude Code's own placeholder ({ type: 'engine' }) is
    // never nested: the desktop drops a band that nests it.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const at = Math.max(await read($, now), ...list.map(a => a.startedAt), 0)
    const left = flowLeft(f, list, at)
    const crew = list.length + plannedOf(f, list).length
    const crewButton = (
      <Button key="savvy-agents" label={`×${crew}`} plain onPress={() => void togglePane($)} />
    )
    const percent = `${Math.round(ratio(f) * 100)}%`
    const dismiss = f.isAuto ? null : (
      <Button
        key="savvy-dismiss"
        label="✕"
        plain
        role="dismiss"
        onPress={() => update($, flow, () => null)}
      />
    )

    // The terminal's element table is completed with an `Svg` that draws nothing: test the surface too.
    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const row = isRtl() ? 'row-reverse' : 'row'
      // About 8 CSS px per reported column. The fixed pieces take their own width; the track takes
      // most of what is left and the rest is spread as equal gaps between the four groups.
      const slot = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 16))
      const head = headSvg(f.title, f.isFinished ? DONE : ACCENT, false, slot * 0.3)
      const stats = statSvg(left === null ? percent : `${percent} · ${fmtLeft(left)}`, 600, 'end')
      const cluster = bandCrabW + 8 + 8 * String(crew).length + 26 + (dismiss ? 34 : 0)
      const room = slot - head.width - stats.width - cluster
      const trackW = Math.max(80, Math.round(room * TRACK_SHARE))
      const m = await read($, main)
      const costume = barCostume(f, list, m)
      const picked = await read($, barStyleAtom)
      const barStyle: BarStyle = isBarStyle(picked) ? picked : isBarStyle(options.barStyle) ? options.barStyle : 'liquid'
      // The wall clock, not the once-a-second tick: the track's loops are phased by it.
      const clockNow = await $.clock.now().catch(() => at)
      const isBusy = list.some(a => a.status === 'running') || m.isWorking
      return (
        <Box flexDirection="column">
          <Box flexDirection={row} justifyContent="space-between" alignItems="center">
            <Svg source={head.source} alt={f.title} width={head.width} height={H} />
            <Svg source={trackSvg(f, trackW, clockNow, barStyle)} alt={label(f)} width={trackW} height={H} />
            <Svg source={stats.source} alt={left === null ? percent : `${percent}, ${fmtLeft(left)}`} width={stats.width} height={H} />
            <Box flexDirection={row} alignItems="center" gap="xs">
              <Svg source={crabSvg(costume, isBusy)} alt={costume === 'rest' ? 'crab resting' : `crab at work: ${workWord(costume)}`} width={bandCrabW} height={CRAB_H} />
              {crewButton}
              {dismiss}
            </Box>
          </Box>
          {below ? <Box key="savvy-below" flexDirection="column" marginTop="sm">{below}</Box> : null}
        </Box>
      )
    }

    const cols = e.props.bodyColumns
    const titleW = Math.max(8, Math.min(30, f.title.length + 2, Math.floor(cols / 3)))
    const width = Math.max(6, Math.min(40, cols - titleW - 32))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Box width={titleW} flexShrink={0}>
            <Text color={f.isFinished ? DONE : ACCENT}>● </Text>
            <Text wrap="truncate-end">{f.title}</Text>
          </Box>
          <Text color={f.isFinished ? DONE : ACCENT}>{barText(f, width)}</Text>
          <Text bold>{label(f)}</Text>
          <Text dimColor>{percent}</Text>
          {left !== null && <Text dimColor>{fmtLeft(left)}</Text>}
          <Text color={CLAY}>▣</Text>
          {crewButton}
          {dismiss}
        </Box>
        {below}
      </Box>
    )
  })
}
