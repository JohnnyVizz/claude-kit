import type { AgentRun, BackgroundTask, Flow, LimitWindow, PlannedTask, SessionFigures, StepStatus } from '../types'
import { ACCENT } from './constants'
import { isRtl, tierWord, tr } from './i18n'
import { FONT, fitText, fmtCost, fmtTime, fmtTokens, textWidth, wrap2, wrapLines, xml } from './text'
import { TIER_COLOR, colorOf, ctxOf, elapsed, progressOf, runModel, tierModel, tierOf, totals } from './models'
import { CRAB_CSS, CRAB_SCALE, avatarOf, costumeOf, crab, crabWidth } from './crabs'
import type { Mood } from './crabs'
import type { Planned } from './flow'
import { bgDetail, bgElapsed, bgMark, bgStatusLabel, isSilent } from './background'

// --- desktop drawings: each row is one SVG, as the band above the prompt is.

// The pane's backdrop: a dotted grid as tall as the content laid over it; the
// row SVGs are transparent, so it shows through between their marks.
export const GRID_STEP = 16
// A Text or Button row on the desktop is about 20px; the grid errs taller.
export const LINE_H = 24
// A line of a Code diff on the desktop, with room to spare.
export const DIFF_LINE_H = 20
// The engine refuses an Svg taller than 4096px, so a long grid is stacked from
// tiles of at most this height; a multiple of GRID_STEP keeps the dots aligned.
export const GRID_TILE = 4096
export const gridTiles = (H: number) => Array.from({ length: Math.ceil(H / GRID_TILE) }, (_, i) => Math.min(GRID_TILE, H - i * GRID_TILE))
export const gridSvg = (W: number, H: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>.d{fill:#d9d8d4}@media (prefers-color-scheme: dark){.d{fill:#3a3a38}}</style>
<defs><pattern id="g" width="${GRID_STEP}" height="${GRID_STEP}" patternUnits="userSpaceOnUse"><circle class="d" cx="${GRID_STEP / 2}" cy="${GRID_STEP / 2}" r="1"/></pattern></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>
</svg>`

export const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

export const statusMark = (x: number, y: number, status: string, color: string): string => {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done') return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (status === 'failed') return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
  return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#9a9a96" stroke-width="1.4"/><path d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke="#9a9a96" stroke-width="1.4" stroke-linecap="round"/>`
}

// Panel rows are laid out left to right; in Hebrew each box mirrors across the
// row (`mx`) and text hugs the mirrored side. `words` text may hold Hebrew and
// takes `direction="rtl"` (whose `start` is the right edge); numbers stay
// left to right so "≈$0.25" keeps its order.
export const mx = (W: number, x: number, w = 0): number => (isRtl() ? W - x - w : x)

// Text that starts at x: left-aligned, or right-aligned at the mirrored x.
export const startText = (W: number, x: number, y: number, words = true): string =>
  !isRtl()
    ? `x="${x}" y="${y}"`
    : `x="${W - x}" y="${y}"${words ? ' direction="rtl" text-anchor="start"' : ' text-anchor="end"'}`

// Text that ends at x: right-aligned, or left-aligned at the mirrored x.
export const endText = (W: number, x: number, y: number, words = false): string =>
  !isRtl() ? `x="${x}" y="${y}" text-anchor="end"` : `x="${W - x}" y="${y}"${words ? ' direction="rtl" text-anchor="end"' : ''}`

// A panel crab at x in a row of width W: on the mirrored side and facing left in Hebrew.
export const rowCrab = (W: number, x: number, y: number, costume: string, dim = false, isWalking = false, mood?: Mood): string =>
  crab(mx(W, x, crabWidth(CRAB_SCALE)), y, costume, dim, isWalking, CRAB_SCALE, isRtl(), mood)

export const svg = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${CRAB_CSS}${body}</svg>`

export type Tile = { k: string; v: string }

// Subagent totals while any ran; otherwise the session's own figures, which are
// the engine's and exact.
export const tilesOf = (list: AgentRun[], f: Flow | null, u: SessionFigures, at: number): Tile[] => {
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
export const LIMIT_ORDER = ['five_hour', 'seven_day']
export const limitsOf = (u: SessionFigures): LimitWindow[] =>
  [...u.rateLimits].sort((a, b) => {
    const ia = LIMIT_ORDER.indexOf(a.kind)
    const ib = LIMIT_ORDER.indexOf(b.kind)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

export const limitName = (kind: string): string =>
  kind === 'five_hour' ? tr().sessionLimit : kind === 'seven_day' ? tr().weeklyLimit : kind.replace(/_/g, ' ')

export const limitColor = (pct: number): string => (pct >= 90 ? '#D0453F' : pct >= 75 ? '#BA7517' : ACCENT)

export const fmtResets = (resetsAt: string | undefined, at: number): string => {
  const ms = resetsAt ? Date.parse(resetsAt) - at : NaN
  if (!(ms > 0)) return ''
  const m = Math.ceil(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mm = m % 60
  return `${tr().resetsIn} ${d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`}`
}

export const LIMIT_ROW = 54
export const limitRows = (n: number): number => Math.ceil(n / 2)

// The pane's own title already says "Agents": the header names the flow, if any.
export const headerSvg = (W: number, title: string, tiles: Tile[], limits: LimitWindow[], at: number): string => {
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

export const headerHeight = (title: string, limits = 0): number =>
  (title ? 72 : 44) + (limits ? limitRows(limits) * LIMIT_ROW - 2 : 0)

export const tilesAlt = (tiles: Tile[], limits: LimitWindow[]): string =>
  [...tiles.map(t => `${t.k} ${t.v}`), ...limits.map(l => `${limitName(l.kind)} ${Math.round(l.percentUsed)}%`)].join(', ')

// --- steps the orchestrator works through itself.

// An active step shows how long it has been going, so a slow one never looks frozen.
export const stepLabel = (p: Pick<PlannedTask, 'status' | 'activeSince' | 'endedAt'>, at: number): string =>
  p.status === 'done'
    ? `${tr().stepDone}${p.activeSince !== undefined && p.endedAt !== undefined ? ` · ${fmtTime(p.endedAt - p.activeSince)}` : ''}`
    : p.status === 'active'
      ? `${tr().stepActive}${p.activeSince !== undefined ? ` · ${fmtTime(at - p.activeSince)}` : ''}`
      : tr().stepPending

export const stepColor = (status: StepStatus | undefined): string =>
  status === 'done' ? '#3B9C5F' : status === 'active' ? ACCENT : '#9a9a96'

// What a step spent of the session: money and context, so far while it runs,
// in all once done. Empty for a step never seen active.
export const stepSpend = (p: PlannedTask, u: SessionFigures): string => {
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
export const STEP_X = 42
export const spendWidth = (spend: string): number => (spend ? textWidth(spend, 11) + 12 : 0)
export const stepLines = (W: number, p: Planned, spend: string): string[] =>
  wrap2(p.summary ?? '', 11.5, W - STEP_X - 4 - spendWidth(spend))

export const stepHeight = (W: number, p: Planned, u: SessionFigures): number =>
  Math.max(46, 30 + stepLines(W, p, stepSpend(p, u)).length * 15)

export const stepSvg = (W: number, p: Planned, at: number, u: SessionFigures): string => {
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

// The description gets the row's full width and up to three lines, so a long one
// (often where the progress hint lives) is read, not cut.
export const bgTitleLines = (W: number, b: BackgroundTask): string[] => wrapLines(b.label, 13, W - 24, 3)

export const bgHeight = (W: number, b: BackgroundTask): number => 56 + (bgTitleLines(W, b).length - 1) * 16

export const bgSvg = (W: number, b: BackgroundTask, at: number): string => {
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

export const agentSvg = (W: number, a: AgentRun, at: number): string => {
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

export const plannedSvg = (W: number, p: Planned): string => {
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

export const compactSvg = (W: number, list: AgentRun[], planned: Planned[], t: ReturnType<typeof totals>): string => {
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

export const ctxBar = (pct: number, width: number): string => {
  const filled = Math.round((width * pct) / 100)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

export const STATUS_GLYPH: Record<string, string> = { running: '●', done: '✓', failed: '✗', planned: '◷' }
