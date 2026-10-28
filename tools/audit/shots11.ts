import { launch, desktop, mobile, shot, wait } from './lib'

const BASE = process.env.BASE ?? 'http://localhost:4174/'
const TAG = process.env.TAG ?? 'after'
const name = (scene: string) => `s11-${TAG}-${scene}`

const browser = await launch()

const l = await mobile(browser, true)
await l.goto(BASE)
await wait(1500)
await l.tap('.mode-button')
await wait(1200)
await shot(l, name('l-01-wave1-start-touch'))
const gotIt = await l.$('.debut-card-button')
if (gotIt) {
  await wait(600)
  await gotIt.tap()
  await wait(1200)
}
await shot(l, name('l-02-wave1-hints-touch'))

const d = await desktop(browser)
await d.goto(BASE)
await wait(1200)
await d.keyboard.press('Enter')
await wait(1200)
await shot(d, name('d-01-wave1-start'))
if (await d.$('.debut-card-button')) {
  await d.keyboard.press('Enter')
  await wait(1200)
}
await shot(d, name('d-02-wave1-hints'))

await d.goto(BASE + '?wave=4&seen=Shambler,Runner&prep=20000')
await wait(1500)
await shot(d, name('d-03-wave4-gasbag'))
await d.goto(BASE + '?wave=5&seen=Shambler,Runner,Exploder&prep=20000')
await wait(1500)
await shot(d, name('d-04-wave5-biglug'))
await d.goto(BASE + '?wave=2&seen=Shambler&prep=20000&device=touch')
await wait(1500)
await shot(d, name('d-05-wave2-hotfoot-touch'))
await d.goto(BASE + '?wave=4&seen=all&prep=14000')
await wait(1200)
await shot(d, name('d-06-wave4-preview-marker'))

await browser.close()
