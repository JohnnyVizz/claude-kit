import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  AgentRun,
  BackgroundStatus,
  BackgroundTask,
  Flow,
  LimitWindow,
  Panel,
  Phase,
  PlannedTask,
  SessionFigures,
  StepFile,
  StepStatus,
} from '../types'

const flow = atom({ plugin: 'savvy-progress', key: 'flow' } as const, null)
const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, [])
const panel = atom({ plugin: 'savvy-progress', key: 'panel' } as const, {
  isCompact: false,
  isDoneCollapsed: false,
  autoOpenedFor: '',
})
const now = atom({ plugin: 'savvy-progress', key: 'now' } as const, 0)
const usage = atom({ plugin: 'savvy-progress', key: 'usage' } as const, { rateLimits: [] } as SessionFigures)
const bgCommands = atom({ plugin: 'savvy-progress', key: 'background' } as const, [] as BackgroundTask[])
const snapshots = atom({ plugin: 'savvy-progress', key: 'snapshots' } as const, {} as Record<string, string | null>)

const TOOL = 'mcp__savvy-progress__progress'
const STEP_TOOL = 'mcp__savvy-progress__step'
// Added to the end of each savvy worker's brief. Their system prompt words step
// reporting as a condition ("if the step tool appears among your tools") and they
// skip it even with the tool listed; the same request in the brief is followed.
const STEP_BRIEF = `

Progress reporting: before any other work, call \`${STEP_TOOL}\` with \`total\` (your plan in 3-8 steps) and \`done: 0\`; call it again with \`done\` and a few-word \`note\` as each step finishes. It only draws a progress bar.`
const PANE = 'savvy-agents'
const PHASES: readonly Phase[] = ['plan', 'design', 'delegate', 'review', 'close']
const TIERS: readonly string[] = ['fable', 'heavy', 'careful', 'medium', 'light']
// The tools' schemas are advice to the model, not a check: what a call may ask
// the band and the panel to draw is bounded here.
const MAX_TASKS = 200
const MAX_AFTER = 20
const MAX_TITLE = 120
const MAX_SUMMARY = 300
const ACCENT = '#8f8cf4'
const DONE = '#5fbf8f'

type ProgressInput = {
  title?: string
  total?: number
  done?: number
  phase?: Phase
  finished?: boolean
  tasks?: { title?: string; tier?: string; after?: number[]; status?: string; summary?: string; avatar?: string }[]
}

const STEP_STATUSES: readonly StepStatus[] = ['pending', 'active', 'done']

// The crab a solo step wears, named for what it looks like rather than the tier
// that wears it on a subagent, so the model can pick one that suits the step.
const AVATARS: Record<string, string> = {
  detective: 'heavy',
  engineer: 'careful',
  chef: 'medium',
  racer: 'light',
  pirate: 'explore',
  astronaut: 'fable',
}
const AVATAR_NAMES = Object.keys(AVATARS)

// ---------------------------------------------------------------------------
// Language: the `language` option, else Claude Code's `language` setting, else the
// process locale; English when nothing says Hebrew or Russian.

type Lang = 'en' | 'ru' | 'he'

const STRINGS = {
  en: {
    pane: 'Agents',
    cost: 'Cost',
    apiCost: 'API cost',
    details: 'Details',
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
    steps: 'Steps',
    stepActive: 'working on',
    stepPending: 'pending',
    stepDone: 'complete',
    context: 'Context',
    sessionLimit: 'Session limit',
    weeklyLimit: 'Weekly limit',
    resetsIn: 'resets in',
    background: 'Background',
    bgRunning: 'running',
    bgCompleted: 'finished',
    bgFailed: 'failed',
    bgKilled: 'stopped',
    silentFor: 'no output for',
    waitingOutput: 'waiting for output…',
    ctx: 'ctx',
    tier: { light: 'light', medium: 'medium', careful: 'careful', heavy: 'heavy', fable: 'fable', other: 'other' },
    effort: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    ctxWord: 'context',
    file: 'file',
    files: 'files',
    filesFew: 'files',
    changed: 'changed',
    finder: 'Finder',
    diff: 'Diff',
    hideDiff: 'Hide diff',
    noChanges: 'No changes left in this file.',
    tooBig: 'No diff for this file: too large, or diff could not run.',
    fileRead: 'read',
    fileNew: 'new',
    edits: 'edits',
    revealFailed: 'Could not show the file',
  },
  ru: {
    pane: 'Агенты',
    cost: 'Стоимость',
    apiCost: 'Цена по API',
    details: 'Подробнее',
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
    steps: 'Шаги',
    stepActive: 'в работе',
    stepPending: 'ожидает',
    stepDone: 'готово',
    context: 'Контекст',
    sessionLimit: 'Лимит сессии',
    weeklyLimit: 'Недельный лимит',
    resetsIn: 'сброс через',
    background: 'Фоновые задачи',
    bgRunning: 'работает',
    bgCompleted: 'завершена',
    bgFailed: 'ошибка',
    bgKilled: 'остановлена',
    silentFor: 'нет вывода',
    waitingOutput: 'ждём вывода…',
    ctxWord: 'контекста',
    file: 'файл',
    files: 'файлов',
    filesFew: 'файла',
    changed: 'изменено',
    finder: 'Finder',
    diff: 'Дифф',
    hideDiff: 'Скрыть дифф',
    noChanges: 'В этом файле не осталось изменений.',
    tooBig: 'Диффа нет: файл слишком большой или diff не запустился.',
    fileRead: 'прочитан',
    fileNew: 'новый',
    edits: 'правок',
    revealFailed: 'Не удалось показать файл',
    ctx: 'ctx',
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
    tier: { light: 'קל', medium: 'בינוני', careful: 'זהיר', heavy: 'כבד', fable: 'פייבל', other: 'אחר' },
    effort: { low: 'נמוך', medium: 'בינוני', high: 'גבוה', xhigh: 'גבוה מאוד', max: 'מקסימלי' },
    apiCost: 'עלות API',
    details: 'פרטים',
    steps: 'שלבים',
    stepActive: 'בעבודה',
    stepPending: 'ממתין',
    stepDone: 'הושלם',
    context: 'הקשר',
    sessionLimit: 'מגבלת סשן',
    weeklyLimit: 'מגבלה שבועית',
    resetsIn: 'מתאפס בעוד',
    background: 'ברקע',
    bgRunning: 'פועל',
    bgCompleted: 'הסתיים',
    bgFailed: 'נכשל',
    bgKilled: 'נעצר',
    silentFor: 'אין פלט כבר',
    waitingOutput: 'ממתין לפלט…',
    ctxWord: 'הקשר',
    file: 'קובץ',
    files: 'קבצים',
    filesFew: 'קבצים',
    changed: 'שונו',
    finder: 'Finder',
    diff: 'שינויים',
    hideDiff: 'הסתרת שינויים',
    noChanges: 'לא נשארו שינויים בקובץ הזה.',
    tooBig: 'אין תצוגת שינויים לקובץ הזה: הוא גדול מדי, או ש-diff לא רץ.',
    fileRead: 'נקרא',
    fileNew: 'חדש',
    edits: 'עריכות',
    revealFailed: 'לא ניתן להציג את הקובץ',
  },
} as const

// Module scope is fine here: session.start sets it again on every (re)load.
let lang: Lang = 'en'
// A language that lacks a label shows it in English, so one added before or
// after a new label never draws `undefined`.
const withEnglish = new Map<Lang, (typeof STRINGS)['en']>()
const tr = (): (typeof STRINGS)['en'] => {
  let s = withEnglish.get(lang)
  if (!s) {
    s = { ...STRINGS.en, ...STRINGS[lang] } as (typeof STRINGS)['en']
    withEnglish.set(lang, s)
  }
  return s
}

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
  startedAt: 0,
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
      ...(STEP_STATUSES.includes(t.status as StepStatus) ? { status: t.status as StepStatus } : {}),
      ...(t.summary?.trim() ? { summary: clip(t.summary.trim(), MAX_SUMMARY) } : {}),
      ...(AVATAR_NAMES.includes(t.avatar?.trim().toLowerCase() ?? '') ? { avatar: t.avatar?.trim().toLowerCase() } : {}),
    }))

// Steps the orchestrator works through itself carry a status; worker tasks do not.
const stepsOf = (f: Flow | null): (PlannedTask & { n: number })[] =>
  (f?.tasks ?? []).map((t, i) => ({ ...t, n: i + 1 })).filter(t => t.status)

const activeSteps = (f: Flow): number => f.tasks.filter(t => t.status === 'active').length

// The bar's crab dresses as the step being worked on, or, once the flow is
// done, as the step that finished it.
const barCostume = (f: Flow): string => {
  const step = f.isFinished ? f.tasks.filter(t => t.status).pop() : f.tasks.find(t => t.status === 'active')
  return step ? avatarOf(step) : 'other'
}

// A flow that just finished gets a celebration; later redraws leave it still.
const PARTY_MS = 10_000
const barMood = (f: Flow, at: number): Mood | undefined =>
  f.isFinished && f.endedAt !== undefined && at - f.endedAt < PARTY_MS ? 'party' : undefined

// The session's running figures, read when a step starts and when it finishes.
type Figures = { cost?: number; ctx?: number }

const TIMING_KEYS = ['activeSince', 'endedAt', 'costFrom', 'costTo', 'ctxFrom', 'ctxTo'] as const
const untimed = (t: PlannedTask): PlannedTask => {
  const out = { ...t }
  for (const k of TIMING_KEYS) delete out[k]
  return out
}

// A step's clock and figures, carried from what the flow held before: set when
// it becomes active, closed when it turns done, kept while it stays either.
// The files a step touched ride along whatever the model resends.
const settle = (t: PlannedTask, was: PlannedTask | undefined, at: number, fig: Figures): PlannedTask => {
  const timed = settleTiming(t, was, at, fig)
  return was?.files ? { ...timed, files: was.files } : timed
}

const settleTiming = (t: PlannedTask, was: PlannedTask | undefined, at: number, fig: Figures): PlannedTask => {
  const bare = untimed(t)
  if (t.status === 'active') {
    if (was?.status === 'active') return { ...bare, activeSince: was.activeSince ?? at, costFrom: was.costFrom, ctxFrom: was.ctxFrom }
    return { ...bare, activeSince: at, costFrom: fig.cost, ctxFrom: fig.ctx }
  }
  if (t.status === 'done' && was?.status === 'active') {
    return { ...bare, activeSince: was.activeSince, endedAt: at, costFrom: was.costFrom, ctxFrom: was.ctxFrom, costTo: fig.cost, ctxTo: fig.ctx }
  }
  if (t.status === 'done' && was?.status === 'done') {
    return { ...bare, ...Object.fromEntries(TIMING_KEYS.map(k => [k, was[k]]).filter(([, v]) => v !== undefined)) }
  }
  return bare
}

const merge = (prev: Flow | null, input: ProgressInput, at: number, fig: Figures = {}): Flow => {
  // A new title means a new flow: never carry counters over from an earlier one.
  const isNew = isNewFlow(prev, input) || !prev
  const base = isNew ? { ...blank(), startedAt: at } : { ...blank(), ...prev }
  const before = new Map(base.tasks.map(t => [norm(t.title), t]))
  const incoming = cleanTasks(input.tasks) ?? base.tasks
  // Closing the flow completes every step still open.
  const closed = input.finished ? incoming.map(t => (t.status ? { ...t, status: 'done' as const } : t)) : incoming
  const tasks = closed.map(t => settle(t, before.get(norm(t.title)), at, fig))
  const total = Math.min(MAX_TASKS, Math.max(0, Math.round(input.total ?? (input.tasks ? tasks.length : base.total))))
  const stepsDone = tasks.some(t => t.status) ? tasks.filter(t => t.status === 'done').length : undefined
  const done = Math.min(total || Infinity, Math.max(0, Math.round(input.done ?? stepsDone ?? base.done)))
  const phase = input.phase && PHASES.includes(input.phase) ? input.phase : base.phase
  return {
    ...base,
    title: clip(input.title?.trim() || base.title, MAX_TITLE),
    total,
    done,
    phase: input.finished ? 'close' : phase,
    isFinished: input.finished === true,
    tasks,
    endedAt: input.finished ? at : undefined,
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

const ratio = (f: Flow): number => (f.isFinished ? 1 : f.total ? f.done / f.total : 0)

// Deterministic noise so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// The whole row is one SVG: the desktop wraps sibling elements onto new lines,
// so title, bar, percent and the crab live in one drawing; only the count and
// the dismiss are Buttons beside it.
const H = 22
const BAR_H = 16
const CRAB_W = 26
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

const rowSvg = (f: Flow, W: number, isWorking: boolean, costume = 'other', mood?: Mood): string => {
  // The title takes what it needs, up to 40% of the row; the bar takes the rest.
  const title = fitText(f.title, 13, Math.max(60, W * 0.4))
  const BAR_X = Math.round(16 + textWidth(title, 13) + 12)
  const BAR_W = Math.max(60, W - BAR_X - 46 - CRAB_W)
  const color = f.isFinished ? DONE : ACCENT
  const y0 = (H - BAR_H) / 2
  const fillW = Math.round(BAR_W * ratio(f))
  const runW = f.total ? Math.round((BAR_W * Math.min(f.total, f.done + f.running + activeSteps(f))) / f.total) : 0
  const dots: string[] = []
  // Positions are worked out left to right; right to left mirrors each box
  // inside the bar (`bx`) and across the row (`rx`). Text is never mirrored.
  const rtl = isRtl()
  const bx = (x: number, w: number): number => (rtl ? BAR_W - x - w : x)
  const rx = (x: number, w: number): number => (rtl ? W - x - w : x)

  // Dithered fill: sparse at the start, dense toward the head.
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(BAR_H / CELL)
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density) dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${bx(c * CELL + 1, 2)}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
  }
  // Handed to workers, not yet accepted: a faint second layer.
  const faint: string[] = []
  for (let c = cols; c < Math.floor(runW / CELL); c++) {
    for (let r = 0; r < rows; r++) {
      if (noise(c + 7, r + 3) < 0.2) faint.push(`<rect class="t${Math.floor(noise(r + 5, c) * 4)}" x="${bx(c * CELL + 1, 1.7)}" y="${r * CELL + 1}" width="1.7" height="1.7"/>`)
    }
  }

  const ticks: string[] = []
  for (let i = 1; i < f.total; i++) {
    const x = Math.round((BAR_W * i) / f.total)
    if (x > fillW + 4) ticks.push(`<rect x="${bx(x, 1.5)}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }

  const text = label(f)
  const pillW = Math.round(18 + text.length * 6.6)
  const pillX = bx(Math.max(0, Math.min(BAR_W - pillW, fillW - pillW)), pillW)
  const percent = `${Math.round(ratio(f) * 100)}%`
  // `direction="rtl"` puts Hebrew words and numbers in reading order; `start` is then the right edge.
  const titleAt = rtl ? `x="${W - 16}" direction="rtl" text-anchor="start"` : 'x="16"'
  const percentAt = rtl ? `x="${CRAB_W + 6}" y="${H / 2 + 4.5}"` : `x="${W - CRAB_W - 6}" y="${H / 2 + 4.5}" text-anchor="end"`
  const crabW = CRAB_BOX * 0.8

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}
/* Pixels twinkle in four out-of-phase groups; a finished bar settles to a slow glow. */
.t0,.t1,.t2,.t3{animation:tw ${f.isFinished ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${f.isFinished ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${f.isFinished ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${f.isFinished ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${f.isFinished ? 0.8 : 0.3}}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>
<defs><clipPath id="c"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
<circle cx="${rtl ? W - 5 : 5}" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" ${titleAt} y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(title)}</text>
<g transform="translate(${rx(BAR_X, BAR_W)},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)">
<g fill="${color}">${dots.join('')}</g>
<g fill="${color}" opacity="0.45">${faint.join('')}</g>
<g class="tk">${ticks.join('')}</g>
</g>
<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle"${rtl ? ' direction="rtl"' : ''} font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(text)}</text>
</g>
<text class="m" ${percentAt} font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${percent}</text>
${CRAB_CSS}${crab(rx(W - CRAB_W + 1, crabW), 0, costume, false, isWorking, 0.8, rtl, mood)}
</svg>`
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
const colorOf = (tier: string): string => TIER_COLOR[tier] ?? '#888780'

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

type Planned = PlannedTask & { n: number }

const plannedOf = (f: Flow | null, list: AgentRun[]): Planned[] => {
  if (!f || f.isFinished) return []
  const started = new Set(list.map(a => norm(a.description)))
  return (f.tasks ?? []).map((t, i) => ({ ...t, n: i + 1 })).filter(t => !t.status && !started.has(norm(t.title)))
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
// A line of a Code diff on the desktop, with room to spare.
const DIFF_LINE_H = 20
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
/* Knocked out: on its back, legs kicking a few times, stars circling overhead. */
.ko .la{animation:st .25s steps(1) 8}.ko .lb{animation:st .25s steps(1) 8 -.125s}.ko g{transform-box:fill-box}
.dz0,.dz1,.dz2{animation:blink 1.2s steps(1) infinite}.dz1{animation-delay:-.4s}.dz2{animation-delay:-.8s}
/* Celebrating: three hops, confetti that rises and fades once. */
.party{animation:hop .4s ease-out 3}@keyframes hop{50%{transform:translateY(-3px)}}
.cf{opacity:0;animation:cf 1.4s ease-out 2 both}.cf1{animation-delay:.15s}.cf2{animation-delay:.3s}.cf3{animation-delay:.45s}
@keyframes cf{0%{opacity:0;transform:translateY(4px)}25%{opacity:1}100%{opacity:0;transform:translateY(-6px)}}
@media (prefers-reduced-motion: reduce){.run,.run g,.ko g,.party,.dz0,.dz1,.dz2{animation:none!important}.cf{display:none}}
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
  other: f => crabBody(f),
}

const costumeOf = (type: string): string => (type === 'Explore' ? 'explore' : tierOf(type))

// A step without a chosen avatar gets one from its title, so it keeps the same
// crab across updates and re-plans.
const avatarOf = (p: Pick<PlannedTask, 'title' | 'avatar'>): string => {
  if (p.avatar && AVATAR_NAMES.includes(p.avatar)) return AVATARS[p.avatar] ?? 'other'
  let h = 0
  for (const ch of norm(p.title)) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return AVATARS[AVATAR_NAMES[h % AVATAR_NAMES.length] ?? ''] ?? 'other'
}

const CRAB_SCALE = 1.1

// Body and props nest inside `bd` so a prop rides the bob and adds its own motion;
// legs stay outside it and step on their own. `mirror` flips the crab inside its
// own box (x .. x + CRAB_BOX * scale) so it faces left.
// How a crab feels: `ko` lies on its back under circling stars (a failed run),
// `party` hops in confetti (a finished flow).
type Mood = 'ko' | 'party'

const DIZZY = [4, 14, 24].map((x, i) => `<rect class="dz${i}" x="${x}" y="0" width="2" height="2" fill="#F5C542"/>`).join('')
const CONFETTI = [
  [1, 8, '#D85A30'],
  [27, 6, '#378ADD'],
  [5, 3, '#F5C542'],
  [24, 2, '#1D9E75'],
  [14, 1, '#7F77DD'],
  [10, 5, '#D0453F'],
]
  .map(([x, y, c], i) => `<rect class="cf cf${i % 4}" x="${x}" y="${y}" width="2" height="2" fill="${c}"/>`)
  .join('')

const crab = (
  x: number,
  y: number,
  costume: string,
  dim = false,
  isWalking = false,
  scale = CRAB_SCALE,
  mirror = false,
  mood?: Mood,
): string => {
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
  const parts = `${body}${group('la')}${group('lb')}`
  // On its back: flipped about the crab's middle, the stars drawn upright above.
  const pose = mood === 'ko' ? `<g transform="translate(0,30) scale(1,-1)">${parts}</g>${DIZZY}` : parts
  const cls = `c-${costume}${isWalking && !mood ? ' run' : ''}${mood ? ` ${mood}` : ''}`
  return `<g transform="${place}" opacity="${dim ? 0.45 : 1}" shape-rendering="crispEdges"><g class="${cls}">${pose}</g>${mood === 'party' ? CONFETTI : ''}</g>`
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
const rowCrab = (W: number, x: number, y: number, costume: string, dim = false, isWalking = false, mood?: Mood): string =>
  crab(mx(W, x, crabWidth(CRAB_SCALE)), y, costume, dim, isWalking, CRAB_SCALE, isRtl(), mood)

const svg = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${CRAB_CSS}${body}</svg>`

type Tile = { k: string; v: string }

// Subagent totals while any ran; otherwise the session's own figures, which are
// the engine's and exact.
const tilesOf = (list: AgentRun[], f: Flow | null, u: SessionFigures, at: number): Tile[] => {
  const s = tr()
  if (list.length) {
    const t = totals(list, at)
    return [
      { k: s.cost, v: '≈' + fmtCost(t.cost) },
      { k: s.tokens, v: fmtTokens(t.tokens) },
      { k: s.time, v: fmtTime(t.time) },
    ]
  }
  const since = f?.startedAt ? (f.endedAt ?? Math.max(at, f.startedAt)) - f.startedAt : 0
  return [
    { k: s.apiCost, v: u.costUsd === undefined ? '—' : fmtCost(u.costUsd) },
    { k: s.context, v: u.contextPercent === undefined ? '—' : `${Math.round(u.contextPercent)}%` },
    { k: s.time, v: fmtTime(since) },
  ]
}

// The session window first, then the weekly all-models one, then anything else.
const LIMIT_ORDER = ['five_hour', 'seven_day']
const limitsOf = (u: SessionFigures): LimitWindow[] =>
  [...u.rateLimits].sort((a, b) => {
    const ia = LIMIT_ORDER.indexOf(a.kind)
    const ib = LIMIT_ORDER.indexOf(b.kind)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

const limitName = (kind: string): string =>
  kind === 'five_hour' ? tr().sessionLimit : kind === 'seven_day' ? tr().weeklyLimit : kind.replace(/_/g, ' ')

const limitColor = (pct: number): string => (pct >= 90 ? '#D0453F' : pct >= 75 ? '#BA7517' : ACCENT)

const fmtResets = (resetsAt: string | undefined, at: number): string => {
  const ms = resetsAt ? Date.parse(resetsAt) - at : NaN
  if (!(ms > 0)) return ''
  const m = Math.ceil(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mm = m % 60
  return `${tr().resetsIn} ${d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`}`
}

const LIMIT_ROW = 54
const limitRows = (n: number): number => Math.ceil(n / 2)

// The pane's own title already says "Agents": the header names the flow, if any.
const headerSvg = (W: number, title: string, tiles: Tile[], limits: LimitWindow[], at: number): string => {
  const gap = 6
  const tw = (W - gap * 2) / 3
  const top = title ? 28 : 0
  const tile = (i: number, { k, v }: Tile) =>
    `<rect class="tile" x="${mx(W, i * (tw + gap), tw)}" y="${top}" width="${tw}" height="40" rx="8"/>
<text class="s" ${startText(W, i * (tw + gap) + 9, top + 16)} font-family="${FONT}" font-size="11">${xml(k)}</text>
<text class="t" ${startText(W, i * (tw + gap) + 9, top + 33, false)} font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${xml(v)}</text>`
  const lw = (W - gap) / 2
  const limit = (i: number, l: LimitWindow) => {
    const x = (i % 2) * (lw + gap)
    const y = top + 46 + Math.floor(i / 2) * LIMIT_ROW
    const pct = Math.max(0, Math.min(100, l.percentUsed))
    const barX = x + 58
    const barW = Math.max(20, lw - 67)
    const fillW = Math.round((barW * pct) / 100)
    const resets = fmtResets(l.resetsAt, at)
    const name = fitText(limitName(l.kind), 11, resets ? lw * 0.5 : lw - 18)
    // In Hebrew the tile mirrors: name and percent on the right, the reset time and the bar's start on the left.
    const fillX = isRtl() ? mx(W, barX, barW) + barW - fillW : barX
    return `<rect class="tile" x="${mx(W, x, lw)}" y="${y}" width="${lw}" height="48" rx="8"/>
<text class="s" ${startText(W, x + 9, y + 16)} font-family="${FONT}" font-size="11">${xml(name)}</text>
${resets ? `<text class="m" ${endText(W, x + lw - 9, y + 16, true)} font-family="${FONT}" font-size="10.5" font-variant-numeric="tabular-nums">${xml(fitText(resets, 10.5, lw * 0.45))}</text>` : ''}
<text class="t" ${startText(W, x + 9, y + 37, false)} font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${Math.round(pct)}%</text>
<rect class="k" x="${mx(W, barX, barW)}" y="${y + 29}" width="${barW}" height="5" rx="2.5"/><rect x="${fillX}" y="${y + 29}" width="${fillW}" height="5" rx="2.5" fill="${limitColor(pct)}"/>`
  }
  return svg(
    W,
    headerHeight(title, limits.length),
    `${title ? `<text class="t" ${startText(W, 0, 15)} font-family="${FONT}" font-size="14" font-weight="600">${xml(fitText(title, 14, W))}</text>` : ''}
${tiles.map((t, i) => tile(i, t)).join('')}${limits.map((l, i) => limit(i, l)).join('')}`,
  )
}

const headerHeight = (title: string, limits = 0): number =>
  (title ? 72 : 44) + (limits ? limitRows(limits) * LIMIT_ROW - 2 : 0)

const tilesAlt = (tiles: Tile[], limits: LimitWindow[]): string =>
  [...tiles.map(t => `${t.k} ${t.v}`), ...limits.map(l => `${limitName(l.kind)} ${Math.round(l.percentUsed)}%`)].join(', ')

// --- steps the orchestrator works through itself.

// An active step shows how long it has been going, so a slow one never looks frozen.
const stepLabel = (p: Pick<PlannedTask, 'status' | 'activeSince' | 'endedAt'>, at: number): string =>
  p.status === 'done'
    ? `${tr().stepDone}${p.activeSince !== undefined && p.endedAt !== undefined ? ` · ${fmtTime(p.endedAt - p.activeSince)}` : ''}`
    : p.status === 'active'
      ? `${tr().stepActive}${p.activeSince !== undefined ? ` · ${fmtTime(at - p.activeSince)}` : ''}`
      : tr().stepPending

const stepColor = (status: StepStatus | undefined): string =>
  status === 'done' ? '#3B9C5F' : status === 'active' ? ACCENT : '#9a9a96'

// Up to `max` lines of `s`, word-wrapped to `maxW`.
const wrapLines = (s: string, size: number, maxW: number, max: number): string[] => {
  const lines: string[] = []
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1]
    if (last !== undefined && textWidth(`${last} ${w}`, size) <= maxW) lines[lines.length - 1] = `${last} ${w}`
    else lines.push(w)
  }
  // Whatever runs past the last line ends it with an ellipsis.
  const kept = lines.slice(0, max - 1)
  const rest = lines.slice(max - 1)
  return [...kept, ...(rest.length ? [rest.join(' ')] : [])].map(l => fitText(l, size, maxW))
}

// Up to two lines of a step's summary.
const wrap2 = (s: string, size: number, maxW: number): string[] => wrapLines(s, size, maxW, 2)

// What a step spent of the session: money and context, so far while it runs,
// in all once done. Empty for a step never seen active.
const stepSpend = (p: PlannedTask, u: SessionFigures): string => {
  const isLive = p.status === 'active'
  const cost = isLive ? u.costUsd : p.costTo
  const ctx = isLive ? u.contextPercent : p.ctxTo
  const parts: string[] = []
  if (cost !== undefined && p.costFrom !== undefined) parts.push(`+${fmtCost(Math.max(0, cost - p.costFrom))}`)
  const ctxDelta = ctx !== undefined && p.ctxFrom !== undefined ? Math.round(ctx - p.ctxFrom) : 0
  if (ctxDelta >= 1) parts.push(`+${ctxDelta}% ${tr().ctxWord}`)
  return parts.join(' · ')
}

// Steps sit beside a crab, as agent rows do, and keep room for it without a summary.
// The spend sits right of the summary, which wraps in what is left.
const STEP_X = 42
const spendWidth = (spend: string): number => (spend ? textWidth(spend, 11) + 12 : 0)
const stepLines = (W: number, p: Planned, spend: string): string[] =>
  wrap2(p.summary ?? '', 11.5, W - STEP_X - 4 - spendWidth(spend))

const stepHeight = (W: number, p: Planned, u: SessionFigures): number =>
  Math.max(46, 30 + stepLines(W, p, stepSpend(p, u)).length * 15)

const stepSvg = (W: number, p: Planned, at: number, u: SessionFigures): string => {
  const color = stepColor(p.status)
  const tag = stepLabel(p, at)
  const tagW = textWidth(tag, 11) + 4
  const spend = stepSpend(p, u)
  const H = stepHeight(W, p, u)
  const lines = stepLines(W, p, spend)
  const mark = statusMark(mx(W, W - 8), 14, p.status === 'active' ? 'running' : p.status === 'done' ? 'done' : 'planned', color)
  // The active crab walks; a pending one waits, faded; a finished one stands still.
  return svg(
    W,
    H,
    `${rowCrab(W, 0, 6, avatarOf(p), p.status === 'pending', p.status === 'active')}${mark}
<text class="${p.status === 'pending' ? 's' : 't'}" ${startText(W, STEP_X, 18)} font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(`${p.n}. ${p.title}`, 13, W - STEP_X - tagW - 30))}</text>
<text ${endText(W, W - 22, 18, true)} font-family="${FONT}" font-size="11" font-weight="500" fill="${color}">${xml(tag)}</text>
${lines.map((l, i) => `<text class="s" ${startText(W, STEP_X, 35 + i * 15)} font-family="${FONT}" font-size="11.5">${xml(l)}</text>`).join('')}
${spend ? `<text class="m" ${endText(W, W - 22, 35, true)} font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(spend)}</text>` : ''}
<line class="ln" x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}"/>`,
  )
}

// --- background shell commands, followed through their output files.

const BG_SILENT_MS = 60_000
// What a background task's ID looks like; anything else did not come from the engine.
const BG_ID = /^[A-Za-z0-9_-]{1,64}$/
const BG_READ_MAX = 4 * 1024 * 1024
const BG_KEEP_DONE = 5

// The last thing a command printed, with terminal colour codes and carriage
// returns (progress bars redrawing one line) resolved to what a terminal shows.
const outputLines = (text: string): string[] =>
  text
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .split('\n')
    .map(l => l.split('\r').filter(Boolean).pop() ?? '')
    .map(l => l.trim())
    .filter(Boolean)

// The line the engine appends when a background command ends.
const endOf = (line: string): BackgroundStatus | undefined => {
  const exit = /^\[exited with code (-?\d+)\]$/.exec(line)
  if (exit) return exit[1] === '0' ? 'completed' : 'failed'
  return /^\[(killed|stopped|terminated)\]$/i.test(line) ? 'killed' : undefined
}

// Progress the output reports itself: the latest `n/m`, `n of m` or `n%`.
const progressIn = (text: string): number | undefined => {
  const tail = text.slice(-4000)
  let best: { at: number; value: number } | undefined
  for (const m of tail.matchAll(/(\d[\d,]*)\s*(?:\/|of)\s*(\d[\d,]*)/g)) {
    const n = Number((m[1] ?? '').replace(/,/g, ''))
    const total = Number((m[2] ?? '').replace(/,/g, ''))
    if (total > 1 && n <= total && (m.index ?? 0) >= (best?.at ?? -1)) best = { at: m.index ?? 0, value: n / total }
  }
  for (const m of tail.matchAll(/(\d{1,3}(?:\.\d+)?)\s?%/g)) {
    const pct = Number(m[1])
    if (pct <= 100 && (m.index ?? 0) >= (best?.at ?? -1)) best = { at: m.index ?? 0, value: pct / 100 }
  }
  return best?.value
}

const bgStatusLabel = (b: BackgroundTask): string => {
  const s = tr()
  return b.status === 'completed' ? s.bgCompleted : b.status === 'failed' ? s.bgFailed : b.status === 'killed' ? s.bgKilled : s.bgRunning
}

const bgMark = (b: BackgroundTask): string =>
  b.status === 'running' ? 'running' : b.status === 'completed' ? 'done' : 'failed'

const isSilent = (b: BackgroundTask, at: number): boolean =>
  b.status === 'running' && at - (b.lastOutputAt ?? b.startedAt) > BG_SILENT_MS

// What the row says under its title: the latest output, or how long it has been quiet.
const bgDetail = (b: BackgroundTask, at: number): string => {
  if (isSilent(b, at)) return `${tr().silentFor} ${fmtTime(at - (b.lastOutputAt ?? b.startedAt))}${b.lastLine ? ` · ${b.lastLine}` : ''}`
  return b.lastLine || (b.status === 'running' ? tr().waitingOutput : '')
}

const bgElapsed = (b: BackgroundTask, at: number): number => (b.endedAt ?? Math.max(at, b.startedAt)) - b.startedAt

// The description gets the row's full width and up to three lines, so a long one
// (often where the progress hint lives) is read, not cut.
const bgTitleLines = (W: number, b: BackgroundTask): string[] => wrapLines(b.label, 13, W - 24, 3)

const bgHeight = (W: number, b: BackgroundTask): number => 56 + (bgTitleLines(W, b).length - 1) * 16

const bgSvg = (W: number, b: BackgroundTask, at: number): string => {
  const silent = isSilent(b, at)
  const color = b.status === 'failed' || b.status === 'killed' ? '#D0453F' : b.status === 'completed' ? '#3B9C5F' : silent ? '#BA7517' : ACCENT
  // A finished row says how it ended beside its time; a running one, its progress.
  const right =
    b.status === 'running'
      ? `${b.progress !== undefined ? `${Math.round(b.progress * 100)}% · ` : ''}${fmtTime(bgElapsed(b, at))}`
      : `${bgStatusLabel(b)} · ${fmtTime(bgElapsed(b, at))}`
  const rightW = textWidth(right, 11) + 4
  const barW = W - 24
  const title = bgTitleLines(W, b)
  const dy = (title.length - 1) * 16
  const H = bgHeight(W, b)
  const fill = b.status === 'completed' ? 1 : b.progress
  // Without a reported figure a running command gets a sweeping bar: alive, amount
  // unknown. It sweeps only while output keeps coming; a quiet one holds still.
  // One second a sweep, as the once-a-second redraw restarts it.
  const sweepW = Math.round(barW * 0.3)
  const fillW = fill !== undefined ? Math.round(barW * fill) : 0
  // The bar fills from its start: the left edge, or the right in Hebrew.
  const bar =
    fill !== undefined
      ? `<rect x="${mx(W, 24, fillW)}" y="${44 + dy}" width="${fillW}" height="4" rx="2" fill="${color}"/>`
      : b.status === 'running' && !silent
        ? `<rect x="${mx(W, 24, sweepW)}" y="${44 + dy}" width="${sweepW}" height="4" rx="2" fill="${color}"><animate attributeName="x" values="${mx(W, 24, sweepW)};${mx(W, 24 + barW - sweepW, sweepW)};${mx(W, 24, sweepW)}" dur="1s" repeatCount="indefinite"/></rect>`
        : ''
  return svg(
    W,
    H,
    `${statusMark(mx(W, 9), 14, bgMark(b), color)}
${title.map((l, i) => `<text class="t" ${startText(W, 24, 18 + i * 16)} font-family="${FONT}" font-size="13" font-weight="600">${xml(l)}</text>`).join('')}
<text ${startText(W, 24, 35 + dy)} font-family="${FONT}" font-size="11.5"${silent ? ` fill="${color}"` : ' class="s"'}>${xml(fitText(bgDetail(b, at), 11.5, W - 24 - rightW - 10))}</text>
<text class="s" ${endText(W, W, 35 + dy)} font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(right)}</text>
${b.status === 'running' || b.status === 'completed' ? `<rect class="k" x="${mx(W, 24, barW)}" y="${44 + dy}" width="${barW}" height="4" rx="2"/>` : ''}${bar}
<line class="ln" x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}"/>`,
  )
}

// Running commands first, then the most recent finished ones.
const bgShown = (list: BackgroundTask[]): BackgroundTask[] => [
  ...list.filter(b => b.status === 'running'),
  ...list.filter(b => b.status !== 'running').slice(-BG_KEEP_DONE).reverse(),
]

// The status line names what runs in the background, so it shows without the panel.
const bgStatusLine = (list: BackgroundTask[], at: number): string | undefined => {
  const running = list.filter(b => b.status === 'running')
  const b = running[0]
  if (!b) return undefined
  const more = running.length > 1 ? ` +${running.length - 1}` : ''
  const pct = b.progress !== undefined ? ` · ${Math.round(b.progress * 100)}%` : ''
  // The numbers first: a narrow status line cuts the name, not the time.
  return `⏳ ${fmtTime(bgElapsed(b, at))}${pct}${more} · ${clip(b.label, 48)}`
}

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
  if (a.round > 1) meta.push(`${s.round} ${a.round}`)
  if (a.status === 'failed') meta.push(s.failed)
  const barW = textW
  const progress = progressOf(a)
  const stats = `${s.ctx} ${ctx}% · ${fmtTokens(a.contextTokens)}  ≈${fmtCost(a.costUsd)}  ${fmtTime(elapsed(a, at))}`
  const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' · ' + a.stepNote : ''}` : ''
  const stepsW = Math.max(0, barW - textWidth(stats, 11) - 12)
  // Without reported steps the bar falls back to the context, drawn grey.
  const fillW = Math.round(barW * (progress ?? ctx / 100))
  return svg(
    W,
    66,
    `${rowCrab(W, 0, 14, costumeOf(a.type), false, a.status === 'running', a.status === 'failed' ? 'ko' : undefined)}
<text class="t" ${startText(W, 42, 18)} font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(a.description || a.type, 13, textW))}</text>
<text ${startText(W, 42, 34)} font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(tier === 'other' ? a.type : tierWord(tier))}</tspan><tspan class="s">  ${xml(meta.join('  ·  '))}</tspan></text>
${steps && stepsW > 30 ? `<text class="t" ${startText(W, 42, 49)} font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(steps, 11, stepsW))}</text>` : ''}
<text class="s" ${endText(W, 42 + barW, 49, true)} font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${stats}</text>
<rect class="k" x="${mx(W, 42, barW)}" y="55" width="${barW}" height="4" rx="2"/><rect${progress === null ? ' class="m"' : ''} x="${mx(W, 42, fillW)}" y="55" width="${fillW}" height="4" rx="2"${progress === null ? '' : ` fill="${color}"`}/>
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
    `${rowCrab(W, 0, 6, tier, true)}
<text class="s" ${startText(W, 42, 18)} font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(`${p.n}. ${p.title}`, 13, textW))}</text>
<text ${startText(W, 42, 34)} font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(tierWord(tier))}</tspan><tspan class="m">  ${xml(meta.filter(Boolean).join('  ·  '))}</tspan></text>
${statusMark(mx(W, W - 8), 16, 'planned', color)}
<line class="ln" x1="0" y1="45.5" x2="${W}" y2="45.5"/>`,
  )
}

const compactSvg = (W: number, list: AgentRun[], planned: Planned[], t: ReturnType<typeof totals>): string => {
  const icons = [
    ...list.filter(a => a.status === 'running').map(a => ({ k: costumeOf(a.type), c: colorOf(tierOf(a.type)), s: 'running', dim: false })),
    ...list.filter(a => a.status !== 'running').map(a => ({ k: costumeOf(a.type), c: colorOf(tierOf(a.type)), s: a.status, dim: false })),
    ...planned.map(p => ({ k: p.tier in TIER_COLOR ? p.tier : 'other', c: colorOf(p.tier), s: 'planned', dim: true })),
  ]
  const fit = Math.max(1, Math.floor((W - 150) / 36))
  const shown = icons.slice(0, fit)
  const more = icons.length - shown.length
  const body = shown
    .map((ic, i) => rowCrab(W, i * 36, 0, ic.k, ic.dim, ic.s === 'running', ic.s === 'failed' ? 'ko' : undefined) + (ic.s === 'running' ? `<circle class="live" cx="${mx(W, i * 36 + 32)}" cy="4" r="3" fill="${ic.c}"/>` : ''))
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

async function storeUsage(
  $: EngineInterface,
  u: { rateLimits: LimitWindow[]; cost?: { usd: number }; context: { percent?: number } },
): Promise<void> {
  await update($, usage, () => ({
    rateLimits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    costUsd: u.cost?.usd,
    contextPercent: u.context.percent,
  }))
}

// Reads what the running background commands printed since the last look: the
// last line and any progress figure. `only` limits it to one command.
async function followOutput($: EngineInterface, at: number, only?: string): Promise<void> {
  const list = await read($, bgCommands)
  for (const b of list) {
    if (b.status !== 'running' || !b.outputFile || (only && b.id !== only)) continue
    // A row that already read its end line (before this check existed) ends now.
    const seenEnd = endOf(b.lastLine ?? '')
    if (seenEnd) {
      await update($, bgCommands, all =>
        all.map(x => (x.id === b.id ? { ...x, status: seenEnd, endedAt: x.lastOutputAt ?? at } : x)),
      )
      continue
    }
    try {
      const { size, mtimeMs } = await $.fs.stat(b.outputFile)
      if (size === b.outputBytes) continue
      // Past the read limit the size still proves it is alive; the text stays as it was.
      const text = size <= BG_READ_MAX ? await $.fs.read(b.outputFile) : undefined
      const lines = text === undefined ? [] : outputLines(text)
      // The engine closes the file with `[exited with code N]` or `[killed]`: the
      // command is over whether or not its notification ever reaches a hook.
      const ended = endOf(lines[lines.length - 1] ?? '')
      const shown = ended ? lines.slice(0, -1) : lines
      const line = shown[shown.length - 1] || b.lastLine
      const progress = text === undefined ? b.progress : (progressIn(shown.join('\n')) ?? b.progress)
      const endedAt = mtimeMs > b.startedAt ? Math.min(at, mtimeMs) : at
      await update($, bgCommands, all =>
        all.map(x =>
          x.id === b.id
            ? { ...x, outputBytes: size, lastOutputAt: at, lastLine: line, progress, isSilenceAnnounced: false, ...(ended ? { status: ended, endedAt } : {}) }
            : x,
        ),
      )
    } catch {
      // Not written yet: try again next tick. Gone a minute in (cleaned up, or its
      // session ended): the command is not running any more.
      if (at - b.startedAt > 60_000 && !(await $.fs.exists(b.outputFile).catch(() => false))) {
        await update($, bgCommands, all => all.map(x => (x.id === b.id ? { ...x, status: 'killed' as const, endedAt: at } : x)))
      }
    }
  }
}

// What a toast says about a command: how it ended, or that it went quiet.
const bgToast = (b: BackgroundTask, at: number): string => {
  const label = clip(b.label, 60)
  const time = fmtTime(bgElapsed(b, at))
  if (b.status === 'completed') return `✓ ${label}: ${tr().bgCompleted} · ${time}`
  if (b.status === 'running') return `⏳ ${label}: ${tr().silentFor} ${fmtTime(at - (b.lastOutputAt ?? b.startedAt))}`
  const why = b.lastLine ? ` · ${clip(b.lastLine, 80)}` : ''
  return `${b.status === 'failed' ? '✗' : '■'} ${label}: ${bgStatusLabel(b)} · ${time}${why}`
}

// Tells the person once when a background command ends, and once each time it
// goes quiet, so it is seen without the panel open.
async function announceBackground($: EngineInterface, at: number): Promise<void> {
  const list = await read($, bgCommands)
  const ended = list.filter(b => b.status !== 'running' && !b.isAnnounced)
  const quiet = list.filter(b => isSilent(b, at) && !b.isSilenceAnnounced)
  if (!ended.length && !quiet.length) return
  const endedIds = new Set(ended.map(b => b.id))
  const quietIds = new Set(quiet.map(b => b.id))
  await update($, bgCommands, all =>
    all.map(b =>
      endedIds.has(b.id) ? { ...b, isAnnounced: true } : quietIds.has(b.id) ? { ...b, isSilenceAnnounced: true } : b,
    ),
  )
  for (const b of [...ended, ...quiet]) $.ui.toast(bgToast(b, at), { timeoutMs: b.status === 'completed' ? 6000 : 10000 })
}

// --- files each step read or changed, and what it changed in them.

const FILE_TOOLS = { Read: 'read', Edit: 'edit', Write: 'edit', NotebookEdit: 'edit' } as const
type FileTool = keyof typeof FILE_TOOLS

const SNAPSHOT_MAX = 512 * 1024
const DIFF_MAX = 40_000
// A snapshot too large to keep: the step lists the file, without a diff.
const TOO_BIG = '\u0000too-big'

const stepKey = (t: Pick<PlannedTask, 'title'>): string => norm(t.title)
const fileKey = (step: string, path: string): string => `${step}|${path}`

// The session's folder and home, to show paths short; set on every (re)load.
let cwd = ''
let home = ''

const shortPath = (path: string): string =>
  cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path

const pathOf = (e: unknown): string => {
  const input = e as { file_path?: unknown; notebook_path?: unknown }
  return String(input.file_path ?? input.notebook_path ?? '').trim()
}

// One more read or edit of `path` on each step in `keys`.
const touch = (f: Flow, keys: Set<string>, path: string, kind: 'read' | 'edit', isNew: boolean): Flow => ({
  ...f,
  tasks: f.tasks.map(t => {
    if (!keys.has(stepKey(t))) return t
    const files = t.files ?? []
    const was = files.find(x => x.path === path)
    const base: StepFile = was ?? { path, reads: 0, edits: 0, ...(isNew && kind === 'edit' ? { isNew: true } : {}) }
    // An edit makes any diff made so far stale.
    const entry: StepFile =
      kind === 'read' ? { ...base, reads: base.reads + 1 } : { ...base, edits: base.edits + 1, diff: undefined, added: undefined, removed: undefined }
    return { ...t, files: was ? files.map(x => (x.path === path ? entry : x)) : [...files, entry].slice(-50) }
  }),
})

// Cuts a long diff at a hunk boundary, so what is kept still parses.
const cutDiff = (text: string): string => {
  if (text.length <= DIFF_MAX) return text
  const at = text.lastIndexOf('\n@@', DIFF_MAX)
  return at > 0 ? text.slice(0, at + 1) : text.slice(0, text.lastIndexOf('\n', DIFF_MAX) + 1)
}

// What changed in `path` since `before`, by the system's diff: the text read
// from stdin against the file as it is now (or /dev/null once it is gone).
async function makeDiff($: EngineInterface, before: string | null | undefined, path: string): Promise<Partial<StepFile>> {
  if (before === undefined || before === TOO_BIG) return {}
  const exists = await $.fs.exists(path).catch(() => false)
  const label = shortPath(path)
  const r = await $.process.run(['diff', '-u', '--label', `a/${label}`, '--label', `b/${label}`, '-', exists ? path : '/dev/null'], {
    stdin: before ?? '',
  })
  // 0: the same, 1: different, anything else: diff failed.
  if (r.exitCode > 1) return {}
  let added = 0
  let removed = 0
  for (const l of r.stdout.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) added++
    else if (l.startsWith('-') && !l.startsWith('---')) removed++
  }
  return { diff: cutDiff(r.stdout), added, removed }
}

// Saves the diffs of the given step files into the flow; the snapshots they
// came from go when `isFinal`.
async function storeDiffs($: EngineInterface, made: Map<string, Partial<StepFile>>, isFinal: boolean): Promise<void> {
  if (!made.size) return
  await update($, flow, p =>
    p
      ? {
          ...p,
          tasks: p.tasks.map(t =>
            t.files
              ? { ...t, files: t.files.map(x => ({ ...x, ...(made.get(fileKey(stepKey(t), x.path)) ?? {}) })) }
              : t,
          ),
        }
      : p,
  )
  if (isFinal) await update($, snapshots, all => Object.fromEntries(Object.entries(all).filter(([k]) => !made.has(k))))
}

// Diffs every file a finished step changed, once, as the step closes.
async function finalizeSteps($: EngineInterface): Promise<void> {
  const f = await read($, flow)
  if (!f) return
  const snaps = await read($, snapshots)
  const made = new Map<string, Partial<StepFile>>()
  for (const t of f.tasks) {
    if (t.status !== 'done') continue
    for (const file of t.files ?? []) {
      const k = fileKey(stepKey(t), file.path)
      if (!file.edits || !(k in snaps)) continue
      try {
        made.set(k, snaps[k] === TOO_BIG ? { diff: undefined } : await makeDiff($, snaps[k], file.path))
      } catch {
        made.set(k, {})
      }
    }
  }
  await storeDiffs($, made, true)
}

// Shows the file in Finder; elsewhere, opens its folder.
async function reveal($: EngineInterface, path: string): Promise<void> {
  try {
    const r = await $.process.run(['open', '-R', path])
    if (r.exitCode === 0) return
  } catch {
    // Not macOS: try the desktop's opener on the folder.
  }
  try {
    const r = await $.process.run(['xdg-open', path.replace(/\/[^/]*$/, '') || '/'])
    if (r.exitCode === 0) return
  } catch {
    // Fall through to the toast.
  }
  $.ui.toast(`${tr().revealFailed}: ${shortPath(path)}`)
}

// Opens or closes one file's diff; a running step's diff is made fresh.
async function toggleDiff($: EngineInterface, step: PlannedTask, file: StepFile): Promise<void> {
  const k = fileKey(stepKey(step), file.path)
  const p = await read($, panel)
  if (p.diffOpen === k) {
    await update($, panel, prev => ({ ...prev, diffOpen: '' }))
    return
  }
  const snaps = await read($, snapshots)
  if (k in snaps && (step.status === 'active' || file.diff === undefined)) {
    try {
      await storeDiffs($, new Map([[k, await makeDiff($, snaps[k], file.path)]]), false)
    } catch {
      // Shown without a diff.
    }
  }
  await update($, panel, prev => ({ ...prev, diffOpen: k }))
}

const toggleStep = ($: EngineInterface, key: string) =>
  update($, panel, prev => {
    const open = new Set(prev.expandedSteps ?? [])
    if (open.has(key)) open.delete(key)
    else open.add(key)
    return { ...prev, expandedSteps: [...open] }
  })

const fileStats = (file: StepFile): string => {
  const s = tr()
  if (!file.edits) return s.fileRead
  const counts = file.added !== undefined ? `+${file.added} −${file.removed ?? 0}` : `${file.edits} ${s.edits}`
  return file.isNew ? `${s.fileNew} · ${counts}` : counts
}

// "1 file", "3 files"; Russian has a third form for 2-4 (but not 12-14).
const filesWord = (n: number): string => {
  const s = tr()
  const last = n % 10
  const lastTwo = n % 100
  if (last === 1 && lastTwo !== 11) return s.file
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return s.filesFew
  return s.files
}

const filesHint = (files: StepFile[], isOpen: boolean): string =>
  files.length
    ? `${isOpen ? '▾' : '▸'} ${files.length} ${filesWord(files.length)}${files.some(f => f.edits) ? ` · ${files.filter(f => f.edits).length} ${tr().changed}` : ''}`
    : ''

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
    cwd = started.cwd.replace(/\/$/, '')
    home = ((await $.env.get('HOME')) ?? '').replace(/\/$/, '')
    await $.tool.register({
      name: 'progress',
      description:
        'Report /savvy-flow progress to the progress bar above the prompt and the agents panel. ' +
        'Call it after presenting the plan (title, total, tasks, phase "delegate"), each time a task is accepted (done), ' +
        'when switching phase or re-planning (tasks), and once at the end with finished: true. Fields left out keep their previous value. ' +
        'For the main session only: a call from a subagent is ignored (workers report with `step`). ' +
        'Working without subagents: give each task a `status` and a one-sentence `summary` and resend the full `tasks` list as steps start and finish; ' +
        '`done` is then counted from the statuses.',
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
                status: {
                  type: 'string',
                  enum: [...STEP_STATUSES],
                  description: 'Only for steps you do yourself, without a subagent: pending, active (working on it) or done.',
                },
                summary: { type: 'string', description: 'One sentence: what the step does, or what it did once done.' },
                avatar: {
                  type: 'string',
                  enum: AVATAR_NAMES,
                  description:
                    'Optional, for steps you do yourself: the crab that shows the step in the panel. detective to investigate, engineer to build or fix, chef to prepare or assemble, racer for quick checks and tests, pirate to explore, astronaut for research or design. Picked from the title when left out.',
                },
              },
              required: ['title'],
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
      name: 'agents-info',
      description: 'Show or hide the panel of subagents: running, finished and planned, with model, context, cost and time',
    })

    // Ticks the running agents', steps' and background commands' clocks, and
    // follows the commands' output; quiet when nothing runs.
    $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, agents)
        const f = await read($, flow)
        const bg = await read($, bgCommands)
        const isBgRunning = bg.some(b => b.status === 'running')
        if (!list.some(a => a.status === 'running') && !(f && !f.isFinished && activeSteps(f)) && !isBgRunning) return
        const at = await $.clock.now()
        if (isBgRunning) {
          await followOutput($, at)
          await announceBackground($, at)
        }
        // An active step's cost climbs as it goes: read the session's figures every few seconds.
        if (f && !f.isFinished && activeSteps(f) && Math.floor(at / 1000) % 5 === 0) {
          try {
            await storeUsage($, await $.session.usage())
          } catch {
            // Keep the last figures.
          }
        }
        await update($, now, () => at)
        $.ui.status(bgStatusLine(await read($, bgCommands), at))
      })()
    })

    try {
      await storeUsage($, await $.session.usage())
    } catch {
      // No figures yet: session.measure brings them after the first turn.
    }
    // Rows that ended before this load are old news: no toast for them. A running
    // row with no ID or output file the engine would give was never a command (an
    // earlier version read them out of any command's output text): it goes.
    await update($, bgCommands, list =>
      list
        .filter(b => b.status !== 'running' || (BG_ID.test(b.id) && b.outputFile?.startsWith('/')))
        .map(b => (b.status === 'running' ? b : { ...b, isAnnounced: true })),
    )
    return started
  })

  // The session's limits, cost and context, pushed after each turn.
  on('session.measure', async ($, e, next) => {
    await storeUsage($, e)
    return next(e)
  })

  // A shell command that went to the background, asked for or after its timeout:
  // its result names the task and the file its output goes to.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    // Only the engine's own record says a command went to the background. The
    // text is the command's output and may say anything, this hook's source included.
    const record = (result.deny === undefined ? result.result : undefined) as { backgroundTaskId?: unknown } | undefined
    const id = typeof record?.backgroundTaskId === 'string' && BG_ID.test(record.backgroundTaskId) ? record.backgroundTaskId : undefined
    if (!id) return result
    const text = 'text' in result && typeof result.text === 'string' ? result.text : ''
    const input = e as unknown as { command?: string; description?: string }
    const at = await $.clock.now()
    const task: BackgroundTask = {
      id,
      label: input.description?.trim() || clip((input.command ?? '').trim(), 60) || id,
      outputFile: /Output is being written to: (\/\S+?)\.?(?:\s|$)/.exec(text)?.[1],
      status: 'running',
      startedAt: at,
      outputBytes: 0,
    }
    await update($, bgCommands, list => [...list.filter(b => b.id !== id), task].slice(-20))
    await update($, now, () => at)
    $.ui.status(bgStatusLine(await read($, bgCommands), at))
    return result
  })

  // Reads and edits while a step is active belong to that step. Before a step
  // first changes a file, the file's text is kept, so the step's diff is its own.
  on('tool.call', { tool: /^(Read|Edit|Write|NotebookEdit)$/ }, async ($, e, next) => {
    const kind = FILE_TOOLS[e.tool as FileTool]
    const path = pathOf(e)
    const f = await read($, flow)
    const active = f && !f.isFinished ? f.tasks.filter(t => t.status === 'active') : []
    if (!path || !active.length) return next(e)
    let isNew = false
    if (kind === 'edit') {
      const snaps = await read($, snapshots)
      const missing = active.filter(t => !(fileKey(stepKey(t), path) in snaps))
      if (missing.length) {
        let before: string | null
        try {
          const { size } = await $.fs.stat(path)
          before = size <= SNAPSHOT_MAX ? await $.fs.read(path) : TOO_BIG
        } catch {
          before = null
        }
        isNew = before === null
        await update($, snapshots, all => ({ ...all, ...Object.fromEntries(missing.map(t => [fileKey(stepKey(t), path), before])) }))
      }
    }
    const result = await next(e)
    if (result.deny !== undefined || result.isError) return result
    const keys = new Set(active.map(stepKey))
    await update($, flow, p => (p ? touch(p, keys, path, kind, isNew) : p))
    return result
  })

  // Stopping a task by hand ends its row at once.
  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const result = await next(e)
    const input = e as unknown as { task_id?: string; shell_id?: string }
    const id = input.task_id ?? input.shell_id
    if (id) {
      const at = await $.clock.now()
      await update($, bgCommands, list =>
        list.map(b => (b.id === id && b.status === 'running' ? { ...b, status: 'killed' as const, endedAt: at, isAnnounced: true } : b)),
      )
      $.ui.status(bgStatusLine(await read($, bgCommands), at))
    }
    return result
  })

  // The engine announces a finished background task as a notification turn. The
  // matcher says so up front, so the module's other prompt.submit hooks can sit beside it.
  on('prompt.submit', { origin: { kind: 'task-notification' } }, async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      const id = /<task-id>([^<]+)<\/task-id>/.exec(e.text)?.[1]?.trim()
      const word = /<status>([^<]+)<\/status>/.exec(e.text)?.[1]?.trim().toLowerCase() ?? ''
      const bg = id ? await read($, bgCommands) : []
      if (id && bg.some(b => b.id === id && b.status === 'running')) {
        const at = await $.clock.now()
        await followOutput($, at, id)
        const status: BackgroundStatus = word === 'completed' ? 'completed' : word === 'killed' ? 'killed' : 'failed'
        await update($, bgCommands, list => list.map(b => (b.id === id ? { ...b, status, endedAt: at } : b)))
        await announceBackground($, at)
        await update($, now, () => at)
        $.ui.status(bgStatusLine(await read($, bgCommands), at))
      }
    }
    return next(e)
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
      // A new flow starts with a clean list: agents and background commands
      // still running stay, what finished belongs to the work before.
      await update($, agents, list => list.filter(a => a.status === 'running'))
      await update($, bgCommands, list => list.filter(b => b.status === 'running'))
      await update($, snapshots, () => ({}))
    }
    // A host with no clock (a test kit, say) still takes the report: step times then stand at the last tick.
    const at = await $.clock.now().catch(() => read($, now))
    await update($, now, () => at)
    // The session's figures right now, so a step's cost starts and stops on this call.
    let fig: Figures = {}
    try {
      const u = await $.session.usage()
      await storeUsage($, u)
      fig = { cost: u.cost?.usd, ctx: u.context.percent }
    } catch {
      // No figures: the step keeps its time, without a cost.
    }
    const next = await update($, flow, p => merge(p, input, at, fig))
    await finalizeSteps($)
    if (next && input.tasks?.length) await autoOpen($, next.title)
    return { result: `ok: ${label(next ?? blank())}` }
  })

  // A worker's own progress: the call runs in the worker's loop, so agentId names it.
  on('tool.call', { tool: STEP_TOOL }, async ($, e) => {
    const input = e as unknown as { done?: number; total?: number; note?: string }
    const agentId = e.agentId
    if (!agentId) return { result: 'ignored: only subagents report steps' }
    let matched = false
    await update($, agents, list =>
      list.map(a => {
        if (a.agentId !== agentId) return a
        matched = true
        const total = Math.max(0, Math.round(input.total ?? a.stepTotal ?? 0))
        const done = Math.max(0, Math.round(input.done ?? a.stepDone ?? 0))
        return { ...a, stepTotal: total, stepDone: total ? Math.min(total, done) : done, stepNote: input.note?.trim() || undefined }
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
    const isUnbriefed = e.subagentType.startsWith('savvy-') && !e.prompt.includes(STEP_TOOL)
    const started = await next(isUnbriefed ? { ...e, prompt: e.prompt + STEP_BRIEF } : e)
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
    if (e.subagentType.startsWith('savvy-')) {
      const f = await read($, flow)
      await autoOpen($, f && !f.isFinished ? f.title : 'savvy-flow')
    } else if (options.autoOpen === 'any') {
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
    await update($, agents, list =>
      list.map((a): AgentRun =>
        a.agentId !== agentId
          ? a
          : {
              ...a,
              model,
              effort: typeof e.effort === 'string' ? e.effort : a.effort,
              status: 'running' as const,
              endedAt: undefined,
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

  on('turn.complete', async ($, e, next) => {
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
            status: e.reason === 'answer' ? ('done' as const) : ('failed' as const),
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
    const u = await read($, usage)
    const clockAt = await $.clock.now().catch(() => read($, now))
    const at = Math.max(await read($, now), ...list.map(a => a.startedAt), 0)

    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const planned = plannedOf(f, list)
    const steps = stepsOf(f)
    const t = totals(list, at)
    const tiles = tilesOf(list, f, u, Math.max(at, clockAt))
    const limits = limitsOf(u)
    const stepsHeader = `${s.steps} · ${steps.filter(p => p.status === 'done').length}/${steps.length}`
    const liveAt = Math.max(at, clockAt)
    const bg = bgShown(await read($, bgCommands))
    const bgRunning = bg.filter(b => b.status === 'running').length
    const bgHeader = `${s.background} · ${bgRunning ? `${bgRunning} ${s.bgRunning}` : bg.length}`
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
    const isEmpty = list.length === 0 && planned.length === 0 && steps.length === 0 && bg.length === 0
    const summary = tilesAlt(tiles, limits)
    const expanded = new Set(p.expandedSteps ?? [])
    // Indent from where a line starts reading: the left, or the right in Hebrew.
    const indent = (n: number) => (isRtl() ? { marginRight: n } : { marginLeft: n })
    const { Code } = ui

    // A step's files: each with what the step did to it, a button to show it in
    // Finder and, for a changed file, one to open its diff underneath.
    const fileList = (step: Planned) => (
      <Box key={`files-${stepKey(step)}`} flexDirection="column" {...indent(e.surface === 'desktop' ? 5 : 2)} marginBottom={1}>
        {(step.files ?? []).map(file => {
          const k = fileKey(stepKey(step), file.path)
          const isDiffOpen = p.diffOpen === k
          return (
            <Box key={`file-${k}`} flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Text wrap="truncate-start">{shortPath(file.path)}</Text>
                <Text dimColor={!file.edits} color={file.edits ? (file.isNew ? 'green' : undefined) : undefined}>
                  {fileStats(file)}
                </Text>
                <Button key={`finder-${k}`} label={s.finder} plain onPress={() => reveal($, file.path)} />
                {file.edits ? (
                  <Button key={`diff-${k}`} label={isDiffOpen ? s.hideDiff : s.diff} plain onPress={() => toggleDiff($, step, file)} />
                ) : null}
              </Box>
              {isDiffOpen ? (
                file.diff ? (
                  <Code key={`code-${k}`} source={file.diff} format="diff" path={file.path} />
                ) : (
                  <Text dimColor>{file.diff === '' ? s.noChanges : s.tooBig}</Text>
                )
              ) : null}
            </Box>
          )
        })}
      </Box>
    )

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
      const sections = (steps.length > 0 ? 1 : 0) + (bg.length > 0 ? 1 : 0)
      // A step's files button, and when open a line per file and the open diff's lines.
      const filesHeight = (st: Planned): number => {
        if (!st.files?.length) return 0
        if (!expanded.has(stepKey(st))) return LINE_H
        const open = st.files.find(fl => p.diffOpen === fileKey(stepKey(st), fl.path))
        const diffLines = open?.diff ? open.diff.split('\n').length : open ? 1 : 0
        return LINE_H * (2 + st.files.length) + diffLines * DIFF_LINE_H
      }
      const gridH =
        headerHeight(title, limits.length) +
        (lines + sections) * LINE_H +
        steps.reduce((h, st) => h + stepHeight(W, st, u) + filesHeight(st), 0) +
        bg.reduce((h, b) => h + bgHeight(W, b), 0) +
        (running.length + shownDone) * 66 +
        planned.length * 46
      return (
        <Box flexDirection="column">
          {/* The grid sizes the pane; the content is placed over it, as an
              absolute Box paints over the siblings before it. */}
          {gridTiles(gridH).map((tileH, i) => (
            <Svg key={`grid-${i}`} source={gridSvg(W, tileH)} alt="dotted grid" width={W} height={tileH} />
          ))}
          <Box flexDirection="column" position="absolute" top={0} left={0} right={0} alignItems={align}>
            <Svg
              source={headerSvg(W, title, tiles, limits, clockAt)}
              alt={title ? `${title}: ${summary}` : summary}
              width={W}
              height={headerHeight(title, limits.length)}
            />
            {toggleCompact}
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {steps.length > 0 && section('h-steps', stepsHeader)}
            {steps.map(p => {
              const isOpen = expanded.has(stepKey(p))
              const row = (
                <Svg
                  key={`step-${p.n}`}
                  source={stepSvg(W, p, liveAt, u)}
                  alt={`${p.n}. ${p.title}: ${stepLabel(p, liveAt)}${stepSpend(p, u) ? `, ${stepSpend(p, u)}` : ''}${p.summary ? `. ${p.summary}` : ''}`}
                  width={W}
                  height={stepHeight(W, p, u)}
                />
              )
              // A step with files says how many under its row; a tap there opens them.
              return p.files?.length ? (
                <Box key={`step-${p.n}`} flexDirection="column" alignItems={align}>
                  {row}
                  <Box {...indent(5)}>
                    <Button key={`open-${stepKey(p)}`} label={filesHint(p.files, isOpen)} plain onPress={() => toggleStep($, stepKey(p))} />
                  </Box>
                  {isOpen && fileList(p)}
                </Box>
              ) : (
                row
              )
            })}
            {bg.length > 0 && section('h-bg', bgHeader)}
            {bg.map(b => (
              <Svg
                key={`bg-${b.id}`}
                source={bgSvg(W, b, liveAt)}
                alt={`${b.label}: ${bgStatusLabel(b)}, ${fmtTime(bgElapsed(b, liveAt))}. ${bgDetail(b, liveAt)}`}
                width={W}
                height={bgHeight(W, b)}
              />
            ))}
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
            <Text color={color}>▣</Text>
            <Text bold wrap="truncate-end">
              {a.description || a.type}
            </Text>
            <Text color={a.status === 'failed' ? 'red' : a.status === 'done' ? 'green' : color}>{STATUS_GLYPH[a.status]}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {'  '}
            {tier === 'other' ? a.type : tierWord(tier)} · {model}
            {a.round > 1 ? ` · ${s.round} ${a.round}` : ''}
          </Text>
          <Text wrap="truncate-end">
            {'  '}
            {progress === null ? <Text dimColor>{ctxBar(ctx, barW)}</Text> : <Text color={color}>{ctxBar(progress * 100, barW)}</Text>}
            <Text dimColor>
              {' '}
              {steps}{s.ctx} {ctx}% · {fmtTokens(a.contextTokens)} ≈{fmtCost(a.costUsd)} {fmtTime(elapsed(a, at))}
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
        <Text dimColor wrap="truncate-end">{tiles.map(x => `${x.k} ${x.v}`).join(' · ')}</Text>
        {limits.map(l => (
          <Text key={`limit-${l.kind}`} wrap="truncate-end">
            <Text dimColor>{limitName(l.kind)} </Text>
            <Text color={limitColor(l.percentUsed)}>{ctxBar(Math.min(100, l.percentUsed), Math.max(6, Math.min(16, cols - 40)))}</Text>
            <Text> {Math.round(l.percentUsed)}%</Text>
            <Text dimColor> {fmtResets(l.resetsAt, clockAt)}</Text>
          </Text>
        ))}
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
            {steps.length > 0 && <Text dimColor>{stepsHeader}</Text>}
            {steps.map(pl => (
              <Box key={`step-${pl.n}`} flexDirection="column" marginBottom={1}>
                <Box flexDirection="row" gap={1}>
                  <Text color={stepColor(pl.status)}>{STATUS_GLYPH[pl.status === 'active' ? 'running' : pl.status === 'done' ? 'done' : 'planned']}</Text>
                  <Text bold={pl.status !== 'pending'} dimColor={pl.status === 'pending'} wrap="truncate-end">
                    {pl.n}. {pl.title}
                  </Text>
                  <Text color={stepColor(pl.status)}>{stepLabel(pl, liveAt)}</Text>
                  {stepSpend(pl, u) ? <Text dimColor>{stepSpend(pl, u)}</Text> : null}
                </Box>
                {pl.summary ? (
                  <Text dimColor wrap="wrap">
                    {'  '}
                    {pl.summary}
                  </Text>
                ) : null}
                {pl.files?.length ? (
                  <Button
                    key={`open-${stepKey(pl)}`}
                    label={`  ${filesHint(pl.files, expanded.has(stepKey(pl)))}`}
                    plain
                    onPress={() => toggleStep($, stepKey(pl))}
                  />
                ) : null}
                {expanded.has(stepKey(pl)) && fileList(pl)}
              </Box>
            ))}
            {bg.length > 0 && <Text dimColor>{bgHeader}</Text>}
            {bg.map(b => {
              const color = b.status === 'completed' ? 'green' : b.status === 'running' ? (isSilent(b, liveAt) ? 'yellow' : ACCENT) : 'red'
              const pct = b.progress !== undefined && b.status === 'running' ? `${Math.round(b.progress * 100)}% · ` : ''
              return (
                <Box key={`bg-${b.id}`} flexDirection="column" marginBottom={1}>
                  <Box flexDirection="row" gap={1}>
                    <Text color={color}>{STATUS_GLYPH[bgMark(b)]}</Text>
                    <Text bold wrap="wrap">
                      {b.label}
                    </Text>
                    <Text dimColor>
                      {b.status === 'running' ? pct : `${bgStatusLabel(b)} · `}
                      {fmtTime(bgElapsed(b, liveAt))}
                    </Text>
                  </Box>
                  {b.progress !== undefined && b.status === 'running' ? (
                    <Text color={color}>
                      {'  '}
                      {ctxBar(b.progress * 100, barW)}
                    </Text>
                  ) : null}
                  <Text dimColor={!isSilent(b, liveAt)} color={isSilent(b, liveAt) ? 'yellow' : undefined} wrap="truncate-end">
                    {'  '}
                    {bgDetail(b, liveAt)}
                  </Text>
                </Box>
              )
            })}
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
    const f = await read($, flow)
    if (f === null || e.props.hasSurvey) return next(e)
    // Draw this row with the other mods' bands beneath it. Claude Code's own placeholder ({ type: 'engine' }) is
    // never nested: the desktop drops a band that nests it.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const crew = list.length + plannedOf(f, list).length
    const isWorking =
      list.some(a => a.status === 'running') ||
      (!f.isFinished && activeSteps(f) > 0) ||
      (await read($, bgCommands)).some(b => b.status === 'running')
    const crewButton = (
      <Button key="savvy-agents" label={crew ? `×${crew}` : tr().details} plain onPress={() => void togglePane($)} />
    )
    const percent = `${Math.round(ratio(f) * 100)}%`
    const mood = barMood(f, await $.clock.now().catch(() => read($, now)))
    const dismiss = (
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
      // About 8 CSS px per reported column; the rest is the count, the dismiss
      // and their gaps. No floor above the slot: a row wider than it would wrap.
      const width = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 96))
      return (
        <Box flexDirection="column">
          <Box flexDirection={isRtl() ? 'row-reverse' : 'row'} alignItems="center" gap={1}>
            <Svg source={rowSvg(f, width, isWorking, barCostume(f), mood)} alt={`${f.title}: ${label(f)}, ${percent}`} width={width} height={H} />
            {crewButton}
            {dismiss}
          </Box>
          {below}
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
          <Text color={CLAY}>▣</Text>
          {crewButton}
          {dismiss}
        </Box>
        {below}
      </Box>
    )
  })
}
