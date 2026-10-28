import {
  launch,
  desktop,
  mobile,
  shot,
  wait,
  GAME,
  HARNESS,
  mouseBot,
} from './lib'
const b = await launch()
let d = await desktop(b)
await d.goto(GAME)
await wait(400)
await d.keyboard.press('Enter')
await wait(1200)
await shot(d, 'd-02-prep1-after')
d = await desktop(b)
await d.goto(HARNESS + '?wave=3&start=wave&god&gun=smg')
await wait(400)
await mouseBot(d, 9000)
await shot(d, 'd-12-midwave-after')
d = await desktop(b)
await d.goto(HARNESS + '?wave=4&start=wave&god&gun=smg')
await wait(4500)
await mouseBot(d, 1600)
await shot(d, 'd-31-gasbag-after')
const l = await mobile(b, true)
await l.goto(HARNESS + '?wave=2&barricades=2&turrets=1&money=100')
await wait(4500)
await shot(l, 'l-50-trap-controls-after')
const m = await mobile(b)
await m.goto(GAME)
await wait(400)
await m.touchscreen.tap(200, 400)
await wait(1200)
await shot(m, 'm-02-prep1-after')
await b.close()
