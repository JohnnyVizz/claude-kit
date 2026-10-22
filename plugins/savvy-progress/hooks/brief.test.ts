import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const STEP_TOOL = 'mcp__savvy-progress__step'

// Starts a session and returns the prompts Claude Code receives for each spawned subagent.
async function session($: Engine, on: On) {
  const prompts: string[] = []
  mock.clock(on, { now: Date.parse('2026-10-10T02:00:00Z') })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  // A savvy worker opens the agents panel; nothing here draws it.
  on('ui.open', async () => ({ value: undefined }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('agent.spawn', async (_, e) => {
    prompts.push(e.prompt)
    return { agentId: `a-${e.description}`, model: 'claude-haiku-5-5' } as never
  })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  return prompts
}

const spawn = ($: Engine, subagentType: string, prompt = 'Do X.') =>
  $.agent.spawn({ subagentType, description: subagentType, prompt, tool_use_id: `t-${subagentType}` } as never)

test('brief: savvy (default): a savvy worker is asked to report its steps', async ($, on) => {
  const prompts = await session($, on)
  await spawn($, 'savvy-careful')
  expect(prompts[0]).toStartWith('Do X.\n\nProgress reporting:')
})

test('brief: savvy (default): an ordinary subagent keeps its brief', async ($, on) => {
  const prompts = await session($, on)
  await spawn($, 'general-purpose')
  expect(prompts[0]).toBe('Do X.')
})

test('brief: any: an ordinary subagent is asked to report its steps', { options: { brief: 'any' } }, async ($, on) => {
  const prompts = await session($, on)
  await spawn($, 'general-purpose')
  expect(prompts[0]).toStartWith('Do X.\n\nProgress reporting:')
  expect(prompts[0]).toContain(STEP_TOOL)
})

test('brief: any: a brief that already asks for steps is left alone', { options: { brief: 'any' } }, async ($, on) => {
  const prompts = await session($, on)
  await spawn($, 'general-purpose', `Report with ${STEP_TOOL}.`)
  expect(prompts[0]).toBe(`Report with ${STEP_TOOL}.`)
})
