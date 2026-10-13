import type { BackgroundStatus, BackgroundTask } from '../types'
import { tr } from './i18n'
import { clip, fmtTime } from './text'

// --- background shell commands, followed through their output files.

export const BG_SILENT_MS = 60_000
// What a background task's ID looks like; anything else did not come from the engine.
export const BG_ID = /^[A-Za-z0-9_-]{1,64}$/
export const BG_READ_MAX = 4 * 1024 * 1024
export const BG_KEEP_DONE = 5

// The last thing a command printed, with terminal colour codes and carriage
// returns (progress bars redrawing one line) resolved to what a terminal shows.
export const outputLines = (text: string): string[] =>
  text
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .split('\n')
    .map(l => l.split('\r').filter(Boolean).pop() ?? '')
    .map(l => l.trim())
    .filter(Boolean)

// The line the engine appends when a background command ends.
export const endOf = (line: string): BackgroundStatus | undefined => {
  const exit = /^\[exited with code (-?\d+)\]$/.exec(line)
  if (exit) return exit[1] === '0' ? 'completed' : 'failed'
  return /^\[(killed|stopped|terminated)\]$/i.test(line) ? 'killed' : undefined
}

// Progress the output reports itself: the latest `n/m`, `n of m` or `n%`.
export const progressIn = (text: string): number | undefined => {
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

export const bgStatusLabel = (b: BackgroundTask): string => {
  const s = tr()
  return b.status === 'completed' ? s.bgCompleted : b.status === 'failed' ? s.bgFailed : b.status === 'killed' ? s.bgKilled : s.bgRunning
}

export const bgMark = (b: BackgroundTask): string =>
  b.status === 'running' ? 'running' : b.status === 'completed' ? 'done' : 'failed'

export const isSilent = (b: BackgroundTask, at: number): boolean =>
  b.status === 'running' && at - (b.lastOutputAt ?? b.startedAt) > BG_SILENT_MS

// What the row says under its title: the latest output, or how long it has been quiet.
export const bgDetail = (b: BackgroundTask, at: number): string => {
  if (isSilent(b, at)) return `${tr().silentFor} ${fmtTime(at - (b.lastOutputAt ?? b.startedAt))}${b.lastLine ? ` · ${b.lastLine}` : ''}`
  return b.lastLine || (b.status === 'running' ? tr().waitingOutput : '')
}

export const bgElapsed = (b: BackgroundTask, at: number): number => (b.endedAt ?? Math.max(at, b.startedAt)) - b.startedAt

// Running commands first, then the most recent finished ones.
export const bgShown = (list: BackgroundTask[]): BackgroundTask[] => [
  ...list.filter(b => b.status === 'running'),
  ...list.filter(b => b.status !== 'running').slice(-BG_KEEP_DONE).reverse(),
]

// The status line names what runs in the background, so it shows without the panel.
export const bgStatusLine = (list: BackgroundTask[], at: number): string | undefined => {
  const running = list.filter(b => b.status === 'running')
  const b = running[0]
  if (!b) return undefined
  const more = running.length > 1 ? ` +${running.length - 1}` : ''
  const pct = b.progress !== undefined ? ` · ${Math.round(b.progress * 100)}%` : ''
  // The numbers first: a narrow status line cuts the name, not the time.
  return `⏳ ${fmtTime(bgElapsed(b, at))}${pct}${more} · ${clip(b.label, 48)}`
}

// What a toast says about a command: how it ended, or that it went quiet.
export const bgToast = (b: BackgroundTask, at: number): string => {
  const label = clip(b.label, 60)
  const time = fmtTime(bgElapsed(b, at))
  if (b.status === 'completed') return `✓ ${label}: ${tr().bgCompleted} · ${time}`
  if (b.status === 'running') return `⏳ ${label}: ${tr().silentFor} ${fmtTime(at - (b.lastOutputAt ?? b.startedAt))}`
  const why = b.lastLine ? ` · ${clip(b.lastLine, 80)}` : ''
  return `${b.status === 'failed' ? '✗' : '■'} ${label}: ${bgStatusLabel(b)} · ${time}${why}`
}
