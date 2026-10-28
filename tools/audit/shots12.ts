import { launch, desktop, mobile, shot, wait } from './lib'

const BASE = process.env.BASE ?? 'http://localhost:4174/'
const TAG = process.env.TAG ?? 'after'
const name = (scene: string) => `s12-${TAG}-${scene}`

const browser = await launch()
const d = await desktop(browser)

await d.goto(
  BASE + '?wave=4&start=wave&god&seen=all&pickups=all&pickupY=110&freeze=30',
)
await wait(1500)
await shot(d, name('d-01-pickups-on-floor'))

await d.goto(
  BASE +
    '?wave=6&start=wave&god&gun=smg&fill&crowd=10&boosts=RapidFire,Damage,Pierce&boostMs=7000&callout=RapidFire&calloutAge=300&aim=280,40&freeze=36',
)
await wait(1500)
await shot(d, name('d-02-boosts-hud-callout'))

await d.goto(
  BASE + '?wave=7&start=wave&god&crowd=14&callout=Burp&calloutAge=60&freeze=10',
)
await wait(1500)
await shot(d, name('d-03-big-burp'))

await d.goto(
  BASE +
    '?wave=5&start=wave&god&gun=shotgun&boosts=Speed,RapidFire&boostMs=1700&pickups=Heart,Pierce&pickupAge=8300&freeze=24',
)
await wait(1500)
await shot(d, name('d-04-expiring-blink'))

await d.goto(
  BASE + '?wave=2&start=wave&seen=all&pickups=Damage&pickupY=110&freeze=60',
)
await wait(1500)
await shot(d, name('d-05-first-pickup-hint'))

const l = await mobile(browser, true)
await l.goto(
  BASE +
    '?wave=6&start=wave&god&gun=smg&device=touch&crowd=8&boosts=Damage,Speed&pickups=RapidFire,Burp&callout=Damage&calloutAge=300&aim=260,50&freeze=30',
)
await wait(1800)
await shot(l, name('l-06-touch-boosts'))

await l.goto(
  BASE +
    '?wave=2&start=wave&seen=all&device=touch&pickups=Speed&pickupY=110&freeze=60',
)
await wait(1800)
await shot(l, name('l-07-touch-pickup-hint'))

await browser.close()
