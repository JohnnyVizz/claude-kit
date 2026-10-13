import type { Flow, PlannedTask, StepFile } from '../types'
import { filesWord, tr } from './i18n'
import { norm } from './text'

// --- files each step read or changed, and what it changed in them.

export const FILE_TOOLS = { Read: 'read', Edit: 'edit', Write: 'edit', NotebookEdit: 'edit' } as const
export type FileTool = keyof typeof FILE_TOOLS

export const SNAPSHOT_MAX = 512 * 1024
export const DIFF_MAX = 40_000
// A snapshot too large to keep: the step lists the file, without a diff.
export const TOO_BIG = '\u0000too-big'

export const stepKey = (t: Pick<PlannedTask, 'title'>): string => norm(t.title)
export const fileKey = (step: string, path: string): string => `${step}|${path}`

// The session's folder and home, to show paths short; set on every (re)load.
let cwd = ''
let home = ''
export const setCwd = (folder: string): void => {
  cwd = folder.replace(/\/$/, '')
}
export const setHome = (homeDir: string): void => {
  home = homeDir.replace(/\/$/, '')
}

export const shortPath = (path: string): string =>
  cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path

export const pathOf = (e: unknown): string => {
  const input = e as { file_path?: unknown; notebook_path?: unknown }
  return String(input.file_path ?? input.notebook_path ?? '').trim()
}

// One more read or edit of `path` on each step in `keys`.
export const touch = (f: Flow, keys: Set<string>, path: string, kind: 'read' | 'edit', isNew: boolean): Flow => ({
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
export const cutDiff = (text: string): string => {
  if (text.length <= DIFF_MAX) return text
  const at = text.lastIndexOf('\n@@', DIFF_MAX)
  return at > 0 ? text.slice(0, at + 1) : text.slice(0, text.lastIndexOf('\n', DIFF_MAX) + 1)
}

export const fileStats = (file: StepFile): string => {
  const s = tr()
  if (!file.edits) return s.fileRead
  const counts = file.added !== undefined ? `+${file.added} −${file.removed ?? 0}` : `${file.edits} ${s.edits}`
  return file.isNew ? `${s.fileNew} · ${counts}` : counts
}

export const filesHint = (files: StepFile[], isOpen: boolean): string =>
  files.length
    ? `${isOpen ? '▾' : '▸'} ${files.length} ${filesWord(files.length)}${files.some(f => f.edits) ? ` · ${files.filter(f => f.edits).length} ${tr().changed}` : ''}`
    : ''
