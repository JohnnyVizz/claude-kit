// Pixel art for the terminal. A sprite is painted with the same `fill` calls that
// draw the desktop's SVG crabs, onto a grid of pixels, and packed as Raster cells
// two pixels to a cell: the upper one as an upper half block's ink, the lower one
// as its background (or a lower half block when only the lower one is set).

export type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

// How far a group of pixels moves down in this frame (negative: up).
export type Shift = (cls: string) => number

export type Pixels = { width: number; height: number; px: Int32Array }

export type Cells = { columns: number; rows: number; cells: string }

// A pixel nothing painted: the terminal's own background shows.
export const CLEAR = -1
// The terminal's default color, as a Raster cell names it.
export const DEFAULT_COLOR = 0x01000000

const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄
const SPACE = 0x20

// '#rgb', '#rrggbb' or 'rgba(r,g,b,a)' as 0xRRGGBB. A color mostly see-through
// (alpha under one half) is left out: a terminal cell has no alpha to blend with.
export const parseColor = (c: string): number => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (hex) {
    const h = hex[1] ?? ''
    const full = h.length === 3 ? [...h].map(d => d + d).join('') : h
    return parseInt(full, 16)
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c.trim())
  if (rgba) {
    const [, r = '0', g = '0', b = '0', a] = rgba
    if (a !== undefined && Number(a) < 0.5) return CLEAR
    return ((Number(r) & 255) << 16) | ((Number(g) & 255) << 8) | (Number(b) & 255)
  }
  return CLEAR
}

// Paints `draw` onto a width × height grid, each group shifted by `shift`;
// what falls outside the grid is dropped.
export const paint = (draw: (f: Fill) => void, width: number, height: number, shift: Shift = () => 0): Pixels => {
  const px = new Int32Array(width * height).fill(CLEAR)
  draw((x, y, w, h, c, cls = 'bd') => {
    const color = parseColor(c)
    if (color === CLEAR) return
    const dy = shift(cls)
    for (let j = y + dy; j < y + dy + h; j++) {
      if (j < 0 || j >= height) continue
      for (let i = x; i < x + w; i++) if (i >= 0 && i < width) px[j * width + i] = color
    }
  })
  return { width, height, px }
}

// Mixes every painted pixel toward `ground`, keeping `alpha` of its own color: what
// an opacity would show over that background.
export const fade = (p: Pixels, alpha: number, ground: number): Pixels => {
  const mix = (c: number, shift: number) => {
    const v = (c >> shift) & 255
    const g = (ground >> shift) & 255
    return Math.round(v * alpha + g * (1 - alpha)) << shift
  }
  const px = p.px.map(c => (c === CLEAR ? CLEAR : mix(c, 16) | mix(c, 8) | mix(c, 0)))
  return { ...p, px }
}

// Flips the grid left to right, for a crab that faces left.
export const mirror = (p: Pixels): Pixels => {
  const px = new Int32Array(p.px.length)
  for (let j = 0; j < p.height; j++)
    for (let i = 0; i < p.width; i++) px[j * p.width + i] = p.px[j * p.width + (p.width - 1 - i)] ?? CLEAR
  return { ...p, px }
}

// Half the size: each 2×2 block becomes the color most of its pixels have. A
// block with fewer than two painted pixels is left clear; a tie goes to the color
// rarer in the whole sprite, so an eye or a prop survives over the body around it.
// `shiftX` starts the blocks that many pixels left of the grid: a sprite whose
// two-pixel features start on odd columns keeps them whole with a shift of 1.
export const halve = (p: Pixels, shiftX = 0): Pixels => {
  const total = new Map<number, number>()
  for (const c of p.px) if (c !== CLEAR) total.set(c, (total.get(c) ?? 0) + 1)
  const width = Math.ceil((p.width + shiftX) / 2)
  const height = Math.ceil(p.height / 2)
  const px = new Int32Array(width * height).fill(CLEAR)
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const counts = new Map<number, number>()
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const x = i * 2 + dx - shiftX
        const y = j * 2 + dy
        if (x < 0 || x >= p.width || y >= p.height) continue
        const c = p.px[y * p.width + x] ?? CLEAR
        if (c !== CLEAR) counts.set(c, (counts.get(c) ?? 0) + 1)
      }
      let painted = 0
      for (const n of counts.values()) painted += n
      if (painted < 2) continue
      let best = CLEAR
      let bestN = 0
      for (const [c, n] of counts) {
        const isRarer = (total.get(c) ?? 0) < (total.get(best) ?? Infinity)
        if (n > bestN || (n === bestN && isRarer)) {
          best = c
          bestN = n
        }
      }
      px[j * width + i] = best
    }
  return { width, height, px }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Standard padded base64, written out: the hooks module has no Node and no DOM.
export const base64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63]
    out += B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64[n & 63] : '='
  }
  return out
}

// One Raster cell per column and per pair of pixel rows.
export const toCells = (p: Pixels): Cells => {
  const columns = p.width
  const rows = Math.ceil(p.height / 2)
  const words = new Uint32Array(columns * rows * 3)
  for (let r = 0; r < rows; r++)
    for (let x = 0; x < columns; x++) {
      const top = p.px[r * 2 * columns + x] ?? CLEAR
      const bottom = r * 2 + 1 < p.height ? (p.px[(r * 2 + 1) * columns + x] ?? CLEAR) : CLEAR
      const k = (r * columns + x) * 3
      if (top === CLEAR && bottom === CLEAR) words.set([SPACE, DEFAULT_COLOR, DEFAULT_COLOR], k)
      else if (bottom === CLEAR) words.set([UPPER, top, DEFAULT_COLOR], k)
      else if (top === CLEAR) words.set([LOWER, bottom, DEFAULT_COLOR], k)
      else words.set([UPPER, top, bottom], k)
    }
  // Little-endian u32s, as the Raster reads them, on any host byte order.
  const bytes = new Uint8Array(words.length * 4)
  words.forEach((w, i) => {
    bytes[i * 4] = w & 255
    bytes[i * 4 + 1] = (w >>> 8) & 255
    bytes[i * 4 + 2] = (w >>> 16) & 255
    bytes[i * 4 + 3] = (w >>> 24) & 255
  })
  return { columns, rows, cells: base64(bytes) }
}
