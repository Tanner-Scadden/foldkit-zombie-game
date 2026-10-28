import {
  launch,
  desktop,
  mobile,
  shot,
  wait,
  HARNESS,
  mouseBot,
  walkTo,
  model,
} from './lib'
const b = await launch()
const go = async (q: string, mob = false) => {
  const p = mob ? await mobile(b, true) : await desktop(b)
  await p.goto(HARNESS + q)
  await wait(400)
  return p
}

// mid-wave action
let p = await go('?wave=3&start=wave&god&gun=smg')
await mouseBot(p, 5000)
await p.mouse.down()
await wait(120)
await shot(p, 'd-10-midwave-a')
await wait(250)
await shot(p, 'd-11-midwave-b')
await p.mouse.up()
await mouseBot(p, 6000)
await shot(p, 'd-12-midwave-c')

// all kinds wave 5
p = await go('?wave=5&start=wave&god')
await wait(9000)
await shot(p, 'd-20-kinds-a')
await wait(4000)
await shot(p, 'd-21-kinds-b')
// hurt the lug
await mouseBot(p, 2500)
await shot(p, 'd-22-kinds-c')

// gasbag chain wave 4
p = await go('?wave=4&start=wave&god&gun=smg')
await wait(4500)
await shot(p, 'd-30-gasbags-incoming')
await mouseBot(p, 1600)
await shot(p, 'd-31-gasbag-chain')
await wait(120)
await shot(p, 'd-32-gasbag-chain2')
await wait(400)
await shot(p, 'd-33-gasbag-after')

// shop desktop
p = await go('?wave=2&money=300')
await walkTo(p, 270, 145)
await wait(600)
await shot(p, 'd-40-shop')
await p.keyboard.press('Escape')
await wait(300)
await shot(p, 'd-41-shop-closed')

// traps
p = await go('?wave=2&barricades=2&turrets=2')
await walkTo(p, 220, 26)
await wait(300)
await shot(p, 'd-50-ghost-door')
await p.keyboard.press('KeyT')
await wait(400)
await shot(p, 'd-51-placed-barricade')
await walkTo(p, 150, 100)
await wait(200)
await p.keyboard.press('KeyG')
await wait(200)
await shot(p, 'd-52-ghost-turret')
await p.keyboard.press('KeyT')
await wait(400)
await walkTo(p, 140, 60)
await p.mouse.move(100, 100)
await wait(200)
await shot(p, 'd-53-ghost-blocked')

// endings and pause
p = await go('?wave=8&phase=victory')
await shot(p, 'd-60-victory')
p = await go('?wave=5&phase=gameover')
await shot(p, 'd-61-gameover')
p = await go('?wave=3&start=wave')
await wait(4000)
await p.keyboard.press('Escape')
await wait(300)
await shot(p, 'd-62-paused')

// mobile shop
p = await go('?wave=2&money=300', true)
const mm = await model(p)
await walkTo(p, 270, 145)
await wait(600)
await shot(p, 'l-40-shop')
const pp = await b
  .newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })
  .then(c => c.newPage())
await pp.goto(HARNESS + '?wave=2&money=300')
await wait(400)
await walkTo(pp, 270, 145)
await wait(600)
await shot(pp, 'm-40-shop')
await b.close()
