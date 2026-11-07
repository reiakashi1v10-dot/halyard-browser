// Colour helpers. The chrome is tinted by the active space's hue; Windows' caption
// buttons need plain hex values, so computed colours are converted through a canvas.

let ctx: CanvasRenderingContext2D | null = null

export function cssColorToHex(color: string): string {
  ctx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!ctx) return '#000000'
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function resolveTheme(theme: 'system' | 'dark' | 'light'): 'dark' | 'light' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}
