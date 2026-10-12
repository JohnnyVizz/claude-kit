export type Stats = {
  turn: number
  speed: number | null
  turnCost: number | null
  total: number
  context: number
  costAtStart: number
}

export type Cache = {
  expiresAt: number | null
  secondsLeft: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-band': { stats: Stats; cache: Cache; isHidden: boolean; isBusy: boolean; warned: number }
  }
}
