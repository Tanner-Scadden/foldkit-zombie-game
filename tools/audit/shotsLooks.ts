// The look sheet: every option of every part on the classic look (both
// bodies in a tee, a dress, and overalls with the Rainbow print, a beard,
// and glasses), every outfit in every print, then walk frames, facings, and
// the hit flash for four mixed looks, as `slooks-<TAG>-<viewport>.png`, the
// whole sheet, on a desktop, a landscape phone, and an upright phone.
//   TAG=after bun run heavy -- bun tools/audit/shotsLooks.ts
import {
  SHOTS_DIR,
  SHOT_VIEWPORTS,
  TAG,
  gotoScene,
  harnessUrl,
  launch,
  openPage,
  useHarness,
} from './lib'

await useHarness()
const browser = await launch()
for (const viewport of SHOT_VIEWPORTS) {
  const page = await openPage(browser, viewport)
  await gotoScene(page, harnessUrl('looksheet', 'freeze=10'))
  // NOTE: the page never scrolls, so the shot grows the screen to the
  // sheet's height instead, keeping its width.
  const height = await page.evaluate(
    () =>
      document.querySelector('.look-sheet')?.getBoundingClientRect().bottom ??
      0,
  )
  await page.setViewportSize({
    width: viewport.width,
    height: Math.max(viewport.height, Math.ceil(height) + 16),
  })
  const path = `${SHOTS_DIR}/slooks-${TAG}-${viewport.name}.png`
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  console.log(path)
  await page.context().close()
}
await browser.close()
