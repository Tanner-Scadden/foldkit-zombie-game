// Draws the app icons in public/ from the favicon's pixel art: 192 and 512
// for the web app manifest, a 512 maskable icon with the head inside the
// safe circle, and the 180 Apple touch icon.
//   bun icons.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { launch } from './lib'

const PUBLIC = resolve(import.meta.dir, '../../public')
const BACKGROUND = '#140c14'
const FAVICON = readFileSync(`${PUBLIC}/favicon.svg`, 'utf8')

type Icon = Readonly<{ file: string; size: number; headShare: number }>

const ICONS: ReadonlyArray<Icon> = [
  { file: 'icon-192.png', size: 192, headShare: 0.75 },
  { file: 'icon-512.png', size: 512, headShare: 0.75 },
  { file: 'icon-maskable-512.png', size: 512, headShare: 0.5 },
  { file: 'apple-touch-icon.png', size: 180, headShare: 0.75 },
]

const pageFor = ({ size, headShare }: Icon): string => {
  const head = Math.round((size * headShare) / 16) * 16
  return `<!doctype html><html><body style="margin:0;background:${BACKGROUND}">
<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${BACKGROUND}">
<img style="width:${head}px;height:${head}px;image-rendering:pixelated" src="data:image/svg+xml,${encodeURIComponent(FAVICON)}">
</div></body></html>`
}

const browser = await launch()
for (const icon of ICONS) {
  const context = await browser.newContext({
    viewport: { width: icon.size, height: icon.size },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  await page.setContent(pageFor(icon))
  await page.screenshot({
    path: `${PUBLIC}/${icon.file}`,
    clip: { x: 0, y: 0, width: icon.size, height: icon.size },
  })
  await context.close()
  console.log(`wrote public/${icon.file}`)
}
await browser.close()
