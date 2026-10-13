import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'savvy-agents',
  props: { title: 'Agents', isFocused: false, bodyColumns: 70, placement: 'dock' },
} as const

const CWD = '/work/app'

// A small disk, the file tools acting on it, and a `diff` that reports what it
// was asked: the engine beneath the mod, in memory.
const engine = (on: On) => {
  mock.clock(on)
  const disk = new Map<string, string>([
    [`${CWD}/src/a.ts`, 'export const a = 1\n'],
    [`${CWD}/src/b.ts`, 'export const b = 1\n'],
  ])
  const runs: { argv: readonly string[]; stdin?: string }[] = []
  on('session.start', async () => ({ cwd: CWD }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('settings.read', async () => ({ value: {} }) as never)
  on('env.get', async (_$, e) => ({ value: (e as { name?: string }).name === 'HOME' ? '/home/me' : undefined }) as never)
  on('session.usage', async () => ({ value: { context: { percent: 10 }, rateLimits: [], cost: { usd: 1 } } }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('fs.stat', async (_$, e) => {
    const text = disk.get((e as { path: string }).path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } } as never
  })
  on('fs.read', async (_$, e) => ({ value: disk.get((e as { path: string }).path) ?? '' }) as never)
  on('fs.exists', async (_$, e) => ({ value: disk.has((e as { path: string }).path) }) as never)
  on('process.run', async (_$, e) => {
    const { argv, init } = e as unknown as { argv: readonly string[]; init?: { stdin?: string } }
    const stdin = init?.stdin
    runs.push({ argv, stdin })
    if (argv[0] === 'diff') {
      const path = argv[argv.length - 1] ?? ''
      const after = disk.get(path) ?? ''
      const out = `--- ${argv[3]}\n+++ ${argv[5]}\n@@ -1,1 +1,1 @@\n-${(stdin ?? '').trim()}\n+${after.trim()}\n`
      return { value: { exitCode: 1, stdout: out, stderr: '' } } as never
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('tool.call', { tool: 'Read' }, async () => ({ result: {}, text: 'ok' }) as never)
  on('tool.call', { tool: 'Edit' }, async (_$, e) => {
    const { file_path, old_string, new_string } = e as unknown as { file_path: string; old_string: string; new_string: string }
    disk.set(file_path, (disk.get(file_path) ?? '').replace(old_string, new_string))
    return { result: {}, text: 'ok' } as never
  })
  on('tool.call', { tool: 'Write' }, async (_$, e) => {
    const { file_path, content } = e as unknown as { file_path: string; content: string }
    disk.set(file_path, content)
    return { result: {}, text: 'ok' } as never
  })
  return { disk, runs }
}

const start = ($: Engine) => $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
const progress = (input: Record<string, unknown>) => ({ tool: 'mcp__savvy-progress__progress', ...input }) as never

test('a step lists the files it touched, opens their diff and shows them in Finder', async ($, on) => {
  const { runs } = engine(on)
  await start($)
  await $.tool.call(progress({ title: 'Files', tasks: [{ title: 'Change b', status: 'active' }, { title: 'Later', status: 'pending' }] }))
  await $.tool.call({ tool: 'Read', file_path: `${CWD}/src/a.ts` } as never)
  await $.tool.call({ tool: 'Edit', file_path: `${CWD}/src/b.ts`, old_string: 'b = 1', new_string: 'b = 2' } as never)
  await $.tool.call({ tool: 'Write', file_path: `${CWD}/src/c.ts`, content: 'export const c = 3\n' } as never)
  // Outside any active step: not tracked.
  await $.tool.call(progress({ tasks: [{ title: 'Change b', status: 'done' }, { title: 'Later', status: 'pending' }] }))
  await $.tool.call({ tool: 'Read', file_path: `${CWD}/src/z.ts` } as never)

  // Finishing the step diffed what it changed, from the text it had before.
  const diffs = runs.filter(r => r.argv[0] === 'diff')
  expect(diffs.map(r => r.stdin)).toEqual(['export const b = 1\n', ''])

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'savvy-progress', surface, ...PANE } as never)
    expect(await ui.find({ type: 'Text', text: 'src/b.ts' })).toBeUndefined()
    await ui.press({ key: 'open-change b' })
    expect(await ui.find({ type: 'Text', text: 'src/a.ts' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^\+1 −1$/ }))?.text).toBe('+1 −1')
    expect(await ui.find({ type: 'Text', text: /^new · / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'src/z.ts' })).toBeUndefined()
    // A file only read has no diff to show.
    expect(await ui.find({ key: `diff-change b|${CWD}/src/a.ts` })).toBeUndefined()

    await ui.press({ key: `diff-change b|${CWD}/src/b.ts` })
    const code = await ui.find({ type: 'Code' })
    expect(String(code?.props.source)).toContain('+export const b = 2')
    expect(code?.props.format).toBe('diff')

    await ui.press({ key: `finder-change b|${CWD}/src/b.ts` })
    expect(runs[runs.length - 1]?.argv).toEqual(['open', '-R', `${CWD}/src/b.ts`])

    await ui.press({ key: `diff-change b|${CWD}/src/b.ts` })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.press({ key: 'open-change b' })
    await ui.unmount()
  }
})

test('a running step diffs on demand, fresh each time', async ($, on) => {
  const { runs } = engine(on)
  await start($)
  await $.tool.call(progress({ title: 'Live', tasks: [{ title: 'Edit a', status: 'active' }] }))
  await $.tool.call({ tool: 'Edit', file_path: `${CWD}/src/a.ts`, old_string: 'a = 1', new_string: 'a = 2' } as never)
  const ui = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', ...PANE } as never)
  await ui.press({ key: 'open-edit a' })
  await ui.press({ key: `diff-edit a|${CWD}/src/a.ts` })
  expect(String((await ui.find({ type: 'Code' }))?.props.source)).toContain('+export const a = 2')
  expect(runs.filter(r => r.argv[0] === 'diff')).toHaveLength(1)
  await ui.unmount()
})
