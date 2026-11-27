import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { AgentRun } from '../types'
import { applyCodexLog, parseCliCommand } from './register'

const home = 'C:/Users/lethi'
const codex = `codex exec -C "C:/My project" -c model_reasoning_effort="ultra" --approve-for-me --skip-git-repo-check -o ~/.codex/savvy-x.md - <<'BRIEF' > ~/.codex/savvy-x.log 2>&1
Ignore the following flags in the brief: -m wrong -o other.md > wrong.log
BRIEF`
const gemini = 'agy --model gemini-4-hydrogen-high --mode plan --print-timeout 300s --add-dir "C:/Users/lethi/.gemini/savvy/clip" -p="Read C:/Users/lethi/.gemini/savvy/clip/brief.md with your file-reading tool (do not run shell commands) and follow it. Reply with the finished text only." > ~/.gemini/savvy/clip/out.md 2> ~/.gemini/savvy/clip/agy.log'

test('CLI commands from the two relay briefs', () => {
  expect(parseCliCommand(codex, home)).toEqual({ cli: 'codex', model: '', effort: 'ultra', cwd: 'C:/My project',
    outPath: home + '/.codex/savvy-x.md', logPath: home + '/.codex/savvy-x.log' })
  expect(parseCliCommand(gemini, home)).toEqual({ cli: 'gemini', model: 'gemini-4-hydrogen-high',
    outPath: home + '/.gemini/savvy/clip/out.md', logPath: home + '/.gemini/savvy/clip/agy.log' })
  expect(parseCliCommand('  npx codex exec -m gpt -c model_reasoning_effort=high -C "/d/Bài tập" >"/c/log dir/x" 2>&1', home))
    .toMatchObject({ model: 'gpt', effort: 'high', cwd: 'D:/Bài tập', logPath: 'C:/log dir/x' })
  expect(parseCliCommand('codex exec --model "gpt" "do > wrong" && echo x > other', home)).toEqual({ cli: 'codex', model: 'gpt' })
  expect(parseCliCommand('agy --model="gemini" -p="> fake.log"', home)).toEqual({ cli: 'gemini', model: 'gemini' })
  for (const other of ['echo codex exec', 'codex execution', 'agy-helper', 'git diff']) expect(parseCliCommand(other, home)).toBe(null)
})

const run: AgentRun = {
  id: 'cli-test', type: 'codex', cli: 'codex', description: 'x', model: '', status: 'running', startedAt: 1,
  contextTokens: 0, contextMax: 0, tokens: 0, costUsd: 0, steps: 0, round: 1,
}

test('Codex log keeps markers and partial lines between reads', () => {
  let row = applyCodexLog(run, 'model: gpt-6.2-astra\r\nreasoning effort: ultra\r\nsession id: abc\r\nex')
  row = applyCodexLog(row, 'ec\r\n')
  row = applyCodexLog(row, '"C:\\Windows\\powershell.exe" -Command "Get-Content café" in D:\\Guidea\r\n')
  expect(row).toMatchObject({ model: 'gpt-6.2-astra', effort: 'ultra', steps: 1, stepNote: 'Get-Content café' })
  row = applyCodexLog(row, "exec\npowershell.exe -Command 'git diff' in D:\\Guidea\n")
  expect(row).toMatchObject({ steps: 2, stepNote: 'git diff' })
  row = applyCodexLog(row, 'codex\nI found the issue.\nMore details\ntokens used\n64,370\ntokens used\n')
  expect(row).toMatchObject({ stepNote: 'I found the issue.', tokens: 64370 })
  expect(applyCodexLog(row, '70,001\n').tokens).toBe(70001)
  expect(run.steps).toBe(0)
})

const pane = { title: '', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

function watchRows(on: On) {
  let rows: AgentRun[] = []
  on('state.set', { plugin: 'savvy-progress', key: 'agents' }, async (_$, e, next) => {
    const result = await next(e)
    if (result.value?.isSet) rows = e.value
    return result
  })
  return () => rows
}

test('background worker survives its relay, tails UTF-8 lines, then finishes at the result mtime', async ($, on) => {
  const rows = watchRows(on)
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, { USERPROFILE: home, LANG: 'en' })
  on('session.start', () => ({ cwd: '/repo' }) as never)
  on('settings.read', () => ({ value: {} }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'relay' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  const header = 'model: gpt-6.2-astra\nreasoning effort: ultra\nsession id: abc\ncodex\nBắt đầu\nexec\n'
  let log = header + 'git sta'
  let resultMtime = 500
  const reads: [number, number][] = []
  on('fs.stat', (_$, e) => {
    const path = e.path.replace(/\\/g, '/')
    const isLog = path.endsWith('.log')
    expect(path).toBe(home + '/.codex/savvy-x.' + (isLog ? 'log' : 'md'))
    return { value: { kind: 'file', size: isLog ? new TextEncoder().encode(log).length : 1, mtimeMs: isLog ? clock.now() : resultMtime, isLink: false } }
  })
  on('fs.read', (_$, e) => {
    const offset = e.offset ?? 0
    reads.push([offset, e.length!])
    const bytes = new TextEncoder().encode(log).subarray(offset, offset + e.length!)
    return { value: { base64: (bytes as Uint8Array & { toBase64(): string }).toBase64() } }
  })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ tool_use_id: 'spawn', prompt: 'p', description: 'Fix the parser', subagentType: 'savvy-codex', provider: 'engine', parentModel: 'opus', background: true, fork: false } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'cmd', agentId: 'relay', command: codex, run_in_background: true })
  await $.turn.complete({ agentId: 'relay', reason: 'answer', answer: 'started' } as never)
  await clock.advance(1000)
  expect(reads).toEqual([[0, new TextEncoder().encode(log).length]])
  expect(rows()[0]).toMatchObject({ status: 'done' })
  expect(rows()[1]).toMatchObject({ id: 'cli-cmd', parentId: 'relay', description: 'Fix the parser', status: 'running', stepNote: 'Bắt đầu', steps: 0 })
  log += 'tus in C:/repo\n'
  const longLineOffset = new TextEncoder().encode(log).length
  const limit = 256 * 1024
  log += 'x'.repeat(limit + 10) + '\ntokens used\n64,370\n'
  resultMtime = 2700
  await clock.advance(1000)
  expect(rows()[1]).toMatchObject({ status: 'done', endedAt: 2700, stepNote: 'git status', logOffset: longLineOffset })
  await clock.advance(1000)
  await clock.advance(1000)
  expect(rows()[1]).toMatchObject({
    status: 'done', endedAt: 2700, tokens: 64370, steps: 1, stepNote: 'git status', costUsd: 0, contextTokens: 0,
  })
  expect(reads.slice(1)).toEqual([
    [new TextEncoder().encode(header).length, limit], [longLineOffset, limit],
    [longLineOffset + limit, new TextEncoder().encode(log).length - longLineOffset - limit],
  ])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: pane })
    const drawn = surface === 'desktop' ? (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('') :
      (await ui.findAll({ type: 'Text' })).map(el => el.text).join('|')
    for (const text of ['relay · Haiku 5.5', 'gpt-6.2-astra · ultra', '1 cmds · 64,370 tok · sub', 'git status', '0:02'])
      expect(drawn).toContain(text)
    await ui.unmount()
  }
})

test('foreground PowerShell records the Gemini model and the tool outcome', async ($, on) => {
  const rows = watchRows(on)
  mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: home })
  on('fs.stat', () => ({ value: { kind: 'file', size: 0, mtimeMs: 1000, isLink: false } }))
  let failed = false
  on('tool.call', { tool: 'PowerShell' }, () => failed ? { isError: true, result: 'exit 1' } : { result: {} } as never)
  for (const id of ['ok', 'error']) {
    failed = id === 'error'
    await $.tool.call({ tool: 'PowerShell', tool_use_id: id, command: gemini })
  }
  expect(rows()[0]).toMatchObject({ status: 'done', cli: 'gemini', model: 'gemini-4-hydrogen-high', description: 'gemini clip', tokens: 0 })
  expect(rows()[1]).toMatchObject({ status: 'failed', endedAt: 1000 })
})
