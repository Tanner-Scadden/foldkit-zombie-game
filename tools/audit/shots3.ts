import { launch, mobile, shot, wait, HARNESS, touch, model } from './lib'
const b = await launch()
for (const land of [true, false]) {
  const tag = land ? 'l' : 'm'
  const p = await mobile(b, land)
  const cdp = await p.context().newCDPSession(p)
  await p.goto(HARNESS + '?wave=3&start=wave&god&gun=smg')
  await wait(2500)
  const W = land ? 844 : 390,
    H = land ? 390 : 844
  const L = { id: 1, x: W * 0.15, y: H * 0.7 },
    R = { id: 2, x: W * 0.85, y: H * 0.7 }
  await touch(cdp, 'touchStart', [L])
  await wait(50)
  await touch(cdp, 'touchStart', [L, R])
  await wait(50)
  const before = await model(p)
  for (let i = 1; i <= 20; i++) {
    await touch(cdp, 'touchMove', [
      { ...L, x: L.x + 2 * i, y: L.y - 2 * i },
      { ...R, x: R.x - 2 * i },
    ])
    await wait(40)
  }
  await wait(600)
  const m = await model(p)
  await shot(p, `${tag}-70-two-thumbs`)
  console.log(
    tag,
    'moveStick',
    m.input.moveStick._tag,
    'aimStick',
    m.input.aimStick._tag,
    'intent',
    JSON.stringify(m.intent),
    'moved',
    (m.player.x - before.player.x).toFixed(1),
    (m.player.y - before.player.y).toFixed(1),
    'bullets',
    m.bullets.length,
  )
  await touch(cdp, 'touchEnd', [])
  await wait(200)
  const after = await model(p)
  console.log(
    tag,
    'after release',
    after.input.moveStick._tag,
    after.input.aimStick._tag,
    after.intent.trigger,
  )
  // traps controls
  const q = await mobile(b, land)
  await q.goto(HARNESS + '?wave=2&barricades=2&turrets=1&money=100')
  await wait(4500)
  await shot(q, `${tag}-50-trap-controls`)
}
await b.close()
