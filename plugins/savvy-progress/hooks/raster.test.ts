import { expect, test } from 'claude-code/testing'

import { base64, CLEAR, DEFAULT_COLOR, fade, halve, mirror, paint, parseColor, toCells } from './raster'

// The cells back as [codePoint, foreground, background] triplets.
const decode = (b64: string): number[][] => {
  const bin = atob(b64)
  const out: number[][] = []
  for (let i = 0; i < bin.length; i += 12) {
    const word = (k: number) =>
      (bin.charCodeAt(i + k) | (bin.charCodeAt(i + k + 1) << 8) | (bin.charCodeAt(i + k + 2) << 16) | (bin.charCodeAt(i + k + 3) << 24)) >>> 0
    out.push([word(0), word(4), word(8)])
  }
  return out
}

test('colors: hex, short hex, rgba, and see-through left out', () => {
  expect(parseColor('#D97757')).toBe(0xd97757)
  expect(parseColor('#fff')).toBe(0xffffff)
  expect(parseColor('rgba(169,214,245,.7)')).toBe(0xa9d6f5)
  expect(parseColor('rgba(169,214,245,.32)')).toBe(CLEAR)
  expect(parseColor('nonsense')).toBe(CLEAR)
})

test('base64 matches the standard encoding, padding included', () => {
  for (const s of ['', 'a', 'ab', 'abc', 'abcd']) expect(base64(new TextEncoder().encode(s))).toBe(btoa(s))
})

test('a pair of pixels is one cell: upper half block, lower half block, both, or none', () => {
  const p = paint(f => {
    f(0, 0, 1, 1, '#ff0000') // column 0: top only
    f(1, 1, 1, 1, '#00ff00') // column 1: bottom only
    f(2, 0, 1, 1, '#0000ff') // column 2: both
    f(2, 1, 1, 1, '#ffffff')
  }, 4, 2)
  const r = toCells(p)
  expect(r).toMatchObject({ columns: 4, rows: 1 })
  expect(decode(r.cells)).toEqual([
    [0x2580, 0xff0000, DEFAULT_COLOR],
    [0x2584, 0x00ff00, DEFAULT_COLOR],
    [0x2580, 0x0000ff, 0xffffff],
    [0x20, DEFAULT_COLOR, DEFAULT_COLOR],
  ])
})

test('an odd height leaves the last row half clear', () => {
  const r = toCells(paint(f => f(0, 0, 1, 3, '#123456'), 1, 3))
  expect(r).toMatchObject({ columns: 1, rows: 2 })
  expect(decode(r.cells)[1]).toEqual([0x2580, 0x123456, DEFAULT_COLOR])
})

test('groups shift by frame and what leaves the grid is dropped', () => {
  const p = paint(
    f => {
      f(0, 0, 1, 1, '#111111', 'la')
      f(1, 1, 1, 1, '#222222')
    },
    2,
    2,
    cls => (cls === 'la' ? -1 : 0),
  )
  expect([...p.px]).toEqual([CLEAR, CLEAR, CLEAR, 0x222222])
})

test('mirror flips columns', () => {
  const p = paint(f => f(0, 0, 1, 1, '#abcdef'), 3, 1)
  expect([...mirror(p).px]).toEqual([CLEAR, CLEAR, 0xabcdef])
})

test('halve keeps the majority, and a tie goes to the rarer color', () => {
  const p = paint(f => {
    f(0, 0, 6, 2, '#aaaaaa') // body
    f(0, 0, 1, 2, '#000000') // a 1×2 eye: ties the body in its block
    f(5, 0, 1, 1, '#ff0000') // a lone pixel: the block stays body
  }, 6, 2)
  expect([...halve(p).px]).toEqual([0x000000, 0xaaaaaa, 0xaaaaaa])
  // Fewer than two painted pixels: clear.
  expect([...halve(paint(f => f(0, 0, 1, 1, '#ffffff'), 2, 2)).px]).toEqual([CLEAR])
})

test('halve with a shift keeps a two-pixel feature on an odd column whole', () => {
  const p = paint(f => f(1, 0, 2, 2, '#000000'), 4, 2)
  // Unshifted, the 2-pixel feature smears over two cells.
  expect([...halve(p).px]).toEqual([0x000000, 0x000000])
  expect([...halve(p, 1).px]).toEqual([CLEAR, 0x000000, CLEAR])
})

test('fade mixes painted pixels toward the ground and leaves clear ones', () => {
  const p = paint(f => f(0, 0, 1, 1, '#ffffff'), 2, 1)
  expect([...fade(p, 0.5, 0x000000).px]).toEqual([0x808080, CLEAR])
})
