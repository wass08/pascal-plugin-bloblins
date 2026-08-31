import { CanvasTexture, SpriteMaterial, SRGBColorSpace } from 'three'
import type { Emote } from '../store'

/**
 * Canvas-drawn sprite art: emote bubbles, pat hearts, refill sparkles. Each
 * picture is painted ONCE into a small canvas and cached as a module-level
 * material — sprites are camera-facing by construction, so the whole emote
 * layer costs one draw call per visible bubble and zero shaders (the host
 * renders through WebGPU, where SpriteMaterial maps to SpriteNodeMaterial).
 */
type Draw = (ctx: CanvasRenderingContext2D, size: number) => void

const EMOTE_GLYPH: Record<Emote, string> = {
  hearts: '❤️',
  food: '🍗',
  zzz: '💤',
  grumble: '💢',
  music: '🎵',
  sparkle: '✨',
}

const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif'

const materials = new Map<string, SpriteMaterial>()

function texture(draw: Draw, size: number): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  draw(ctx, size)
  const map = new CanvasTexture(canvas)
  map.colorSpace = SRGBColorSpace
  return map
}

function material(key: string, draw: Draw, size: number): SpriteMaterial {
  const cached = materials.get(key)
  if (cached) return cached
  const mat = new SpriteMaterial({ depthWrite: false, toneMapped: false, transparent: true })
  const map = texture(draw, size)
  if (map) mat.map = map
  materials.set(key, mat)
  return mat
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawBubble(glyph: string): Draw {
  return (ctx, size) => {
    const pad = size * 0.07
    const width = size - pad * 2
    const height = size * 0.7
    ctx.clearRect(0, 0, size, size)
    ctx.fillStyle = 'rgba(253, 251, 247, 0.96)'
    ctx.strokeStyle = 'rgba(52, 44, 38, 0.22)'
    ctx.lineWidth = size * 0.035
    roundRectPath(ctx, pad, pad, width, height, size * 0.24)
    ctx.fill()
    ctx.stroke()
    // Tail, painted over the bubble outline so the seam disappears.
    ctx.beginPath()
    ctx.moveTo(size * 0.4, pad + height - ctx.lineWidth)
    ctx.lineTo(size * 0.47, size - pad * 0.6)
    ctx.lineTo(size * 0.58, pad + height - ctx.lineWidth)
    ctx.closePath()
    ctx.fill()
    ctx.font = `${Math.round(size * 0.42)}px ${EMOJI_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(glyph, size / 2, pad + height * 0.5)
  }
}

const drawHeart: Draw = (ctx, size) => {
  const c = size / 2
  const r = size * 0.34
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = '#ff5f86'
  ctx.beginPath()
  ctx.moveTo(c, c + r * 0.88)
  ctx.bezierCurveTo(c - r * 1.4, c - r * 0.2, c - r * 0.72, c - r * 1.24, c, c - r * 0.42)
  ctx.bezierCurveTo(c + r * 0.72, c - r * 1.24, c + r * 1.4, c - r * 0.2, c, c + r * 0.88)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.beginPath()
  ctx.ellipse(c - r * 0.4, c - r * 0.42, r * 0.16, r * 0.11, -0.5, 0, Math.PI * 2)
  ctx.fill()
}

const drawSparkle: Draw = (ctx, size) => {
  const c = size / 2
  const r = size * 0.44
  ctx.clearRect(0, 0, size, size)
  const glow = ctx.createRadialGradient(c, c, 0, c, c, r)
  glow.addColorStop(0, 'rgba(255, 255, 255, 1)')
  glow.addColorStop(0.55, 'rgba(255, 232, 168, 0.9)')
  glow.addColorStop(1, 'rgba(255, 214, 120, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.moveTo(c, c - r)
  ctx.quadraticCurveTo(c + r * 0.13, c - r * 0.13, c + r, c)
  ctx.quadraticCurveTo(c + r * 0.13, c + r * 0.13, c, c + r)
  ctx.quadraticCurveTo(c - r * 0.13, c + r * 0.13, c - r, c)
  ctx.quadraticCurveTo(c - r * 0.13, c - r * 0.13, c, c - r)
  ctx.closePath()
  ctx.fill()
}

/** Speech bubble for an emote, shared by every pet showing that emote. */
export function emoteMaterial(emote: Emote): SpriteMaterial {
  return material(`emote:${emote}`, drawBubble(EMOTE_GLYPH[emote]), 128)
}

/** The little hearts that puff up out of a patted pet. */
export function heartMaterial(): SpriteMaterial {
  return material('heart', drawHeart, 64)
}

/** Refill twinkle over a freshly filled bowl. */
export function sparkleMaterial(): SpriteMaterial {
  return material('sparkle', drawSparkle, 64)
}
