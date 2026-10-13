import type { Phase, StepStatus } from '../types'

export const PHASES: readonly Phase[] = ['plan', 'design', 'delegate', 'review', 'close']
export const TIERS: readonly string[] = ['fable', 'heavy', 'careful', 'medium', 'light']
// The tools' schemas are advice to the model, not a check: what a call may ask
// the band and the panel to draw is bounded here.
export const MAX_TASKS = 200
export const MAX_AFTER = 20
export const MAX_TITLE = 120
export const MAX_SUMMARY = 300
export const ACCENT = '#8f8cf4'
export const DONE = '#5fbf8f'

export const STEP_STATUSES: readonly StepStatus[] = ['pending', 'active', 'done']
