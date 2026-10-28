// Shop screenshots for the categories and the price ramp. TAG names the set,
// such as `before` or `after`, and BASE points at a harness server.
//   TAG=after bun shots10.ts
import { HARNESS, desktop, launch, mobile, shot, wait } from './lib'

const TAG = process.env.TAG ?? 'after'
const BASE = process.env.BASE ?? HARNESS
const AT_STALL = 'px=270&py=142'

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'first-visit', query: `wave=2&money=37&${AT_STALL}` },
  { name: 'mid-run', query: `wave=5&money=180&gun=smg&tier=1&${AT_STALL}` },
]

const browser = await launch()

const capture = async (
  device: 'desktop' | 'phone',
  name: string,
  query: string,
) => {
  const page =
    device === 'desktop' ? await desktop(browser) : await mobile(browser, true)
  await page.goto(`${BASE}?${query}`)
  await wait(900)
  await shot(page, `s10-${TAG}-${device}-${name}`)
  const tabs = page.getByRole('tab')
  const count = await tabs.count()
  for (let index = 1; index < count; index++) {
    await tabs.nth(index).click()
    await wait(250)
    const label = (await tabs.nth(index).innerText()).split('\n')[0]
    await shot(
      page,
      `s10-${TAG}-${device}-${name}-${label.trim().toLowerCase()}`,
    )
  }
  await page.close()
}

for (const { name, query } of SCENES) {
  await capture('desktop', name, query)
  await capture('phone', name, query)
}
await browser.close()
