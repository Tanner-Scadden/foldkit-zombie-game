// The sprites in HTML pass: How to play, the pause screen, the Munchopedia,
// and the home corner with the update gift and the install tile, on a
// desktop, a landscape phone, and an upright phone, as
// `s38-<TAG>-<viewport>-<scene>.png`. The harness is a production build, so
// every sprite is a region of the prebuilt atlas. It exits with 1 on an
// <img> or a CSS background that shows a whole atlas sheet (an <img> cannot
// crop, so it must take `standaloneSource`), a control card frame wider
// than a sprite, a gift under 48 px, or a gift tag that runs into the
// corner's other buttons or off the screen.
//   TAG=after bun run heavy -- bun tools/audit/shots38.ts
import type { Page } from 'playwright-core'

import {
  DESKTOP_1280,
  PHONE_844,
  SHOTS_DIR,
  UPRIGHT_390,
  type Viewport,
  deviceQuery,
  finish,
  gotoScene,
  harnessUrl,
  isPickedScene,
  launch,
  openPage,
  pickViewports,
  settleAnimations,
  tagOr,
  useHarness,
} from './lib'

const TAG = tagOr('after')

const VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'd1280' },
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_390, name: 'p390' },
])

const press = async (page: Page, viewport: Viewport, name: RegExp) => {
  const button = page.getByRole('button', { name }).first()
  await (viewport.isPhone ? button.tap() : button.click())
}

const fromHand = (card: RegExp) => async (page: Page, viewport: Viewport) => {
  await press(page, viewport, /^More:/)
  await page.locator('dialog[open]').first().waitFor({ state: 'visible' })
  await press(page, viewport, card)
  await page
    .locator('dialog[open] .panel')
    .first()
    .waitFor({ state: 'visible' })
}

type Scene = Readonly<{
  name: string
  query: string
  act?: (page: Page, viewport: Viewport) => Promise<void>
}>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'howto', query: '', act: fromHand(/^How to play:/) },
  { name: 'pause', query: 'wave=3&start=wave&phase=paused' },
  {
    name: 'munchopedia',
    query: 'seen=all&kills=Shambler:12,Runner:3',
    act: fromHand(/^Munchopedia:/),
  },
  { name: 'gift', query: 'newer=next' },
  { name: 'gift-install', query: 'newer=next&install' },
]

// NOTE: a hint icon frame is at most a few dozen pixels; the atlas sheet is
// 1024 wide.
const MAX_SPRITE_PX = 128

const problems: Array<string> = []

const checkSprites = async (page: Page, where: string) => {
  const found = await page.evaluate((maxPx: number) => {
    // NOTE: the files the canvases draw sprites from: any URL the page
    // loaded that is not a data URL and names a sprite sheet.
    const isSheet = (url: string) =>
      !url.startsWith('data:') && /sprite/i.test(url)
    const urlsIn = (value: string) =>
      [...value.matchAll(/url\("?([^")]+)"?\)/g)].map(match => match[1] ?? '')
    const images = [...document.querySelectorAll('img')]
    const sheetImages = images
      .filter(image => isSheet(image.currentSrc || image.src))
      .map(image => `<img class="${image.className}"> ${image.src}`)
    const sheetBackgrounds = [...document.querySelectorAll('*')].flatMap(
      element =>
        urlsIn(getComputedStyle(element).backgroundImage)
          .filter(isSheet)
          .map(url => `${element.className} background ${url}`),
    )
    const wideFrames = [...document.querySelectorAll('.help-card-frame')]
      .filter(
        frame =>
          frame instanceof HTMLImageElement &&
          (frame.naturalWidth === 0 || frame.naturalWidth > maxPx),
      )
      .map(frame => `frame ${(frame as HTMLImageElement).naturalWidth} px wide`)
    return {
      bad: [...sheetImages, ...sheetBackgrounds, ...wideFrames],
      images: images.length,
    }
  }, MAX_SPRITE_PX)
  for (const line of found.bad) {
    problems.push(`${where}: ${line}`)
  }
  return found.images
}

type Box = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const checkGift = async (page: Page, viewport: Viewport, where: string) => {
  const found = await page.evaluate(() => {
    const boxOf = (element: Element | null) => {
      if (element === null) {
        return null
      }
      const { left, top, right, bottom } = element.getBoundingClientRect()
      return { left, top, right, bottom }
    }
    const gift = document.querySelector('.home-gift')
    return {
      label: gift?.getAttribute('aria-label') ?? null,
      gift: boxOf(gift),
      tag: boxOf(document.querySelector('.gift-tag')),
      others: [
        ...document.querySelectorAll(
          '.home-corner-button:not(.home-gift), .home-install',
        ),
      ].map(element => ({
        name: element.getAttribute('aria-label') ?? element.className,
        box: boxOf(element),
      })),
    }
  })
  const { gift, tag } = found
  if (gift === null || tag === null) {
    problems.push(`${where}: no gift or no tag`)
    return
  }
  if (found.label !== 'Update ready: tap to get it') {
    problems.push(`${where}: the gift is labeled ${found.label}`)
  }
  const width = gift.right - gift.left
  const height = gift.bottom - gift.top
  if (width < 48 || height < 48) {
    problems.push(`${where}: the gift is ${width}x${height}`)
  }
  const overlaps = (first: Box, second: Box) =>
    first.left < second.right &&
    second.left < first.right &&
    first.top < second.bottom &&
    second.top < first.bottom
  for (const other of found.others) {
    if (other.box !== null && overlaps(tag, other.box)) {
      problems.push(`${where}: the gift tag runs into ${other.name}`)
    }
    if (other.box !== null && overlaps(gift, other.box)) {
      problems.push(`${where}: the gift runs into ${other.name}`)
    }
  }
  if (
    tag.left < 0 ||
    tag.top < 0 ||
    tag.right > viewport.width ||
    tag.bottom > viewport.height
  ) {
    problems.push(`${where}: the gift tag runs off the screen`)
  }
}

await useHarness()
const browser = await launch()
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const where = `${viewport.name} ${scene.name}`
    const page = await openPage(browser, viewport)
    await gotoScene(page, harnessUrl(scene.query, deviceQuery(viewport)))
    await scene.act?.(page, viewport)
    await settleAnimations(page)
    const images = await checkSprites(page, where)
    if (scene.name.startsWith('gift')) {
      await checkGift(page, viewport, where)
    }
    // NOTE: a card's frames take turns through a looping animation, which a
    // shot with animations off holds at a hidden frame, so these run.
    await page.screenshot({
      path: `${SHOTS_DIR}/s38-${TAG}-${viewport.name}-${scene.name}.png`,
    })
    console.log(`${where}: ${images} images`)
    await page.context().close()
  }
}
await browser.close()

finish(problems, 'Every sprite in HTML is its own image, and the gift fits.')
