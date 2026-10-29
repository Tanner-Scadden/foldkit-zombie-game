// The Math calls the game makes, on 20,000 inputs from an integer generator
// so every engine sees the same numbers. The ranges match the game's: room
// coordinates, small vectors, angles, and exponential decay over one frame.
// mathProbe.ts compares the results between engines; worker.ts serves them
// from workerd.

import { detAtan2, detCos, detExp, detHypot, detSin } from './detMath'

const COUNT = 20_000

const inputs = (): Array<readonly [number, number]> => {
  let state = 12345
  const next = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    return state / 4294967296
  }
  return Array.from({ length: COUNT }, () => [next(), next()] as const)
}

export const FUNCTIONS: Record<string, (a: number, b: number) => number> = {
  sqrt: a => Math.sqrt(a * 400),
  hypot: (a, b) => Math.hypot(a * 320 - 160, b * 180 - 90),
  'sqrt(x*x+y*y)': (a, b) => {
    const x = a * 320 - 160
    const y = b * 180 - 90
    return Math.sqrt(x * x + y * y)
  },
  sin: a => Math.sin(a * 2 * Math.PI - Math.PI),
  cos: a => Math.cos(a * 2 * Math.PI - Math.PI),
  atan2: (a, b) => Math.atan2(a * 2 - 1, b * 2 - 1),
  exp: a => Math.exp(-a * 0.2),
  pow: (a, b) => Math.pow(a * 4, b * 3),
  detHypot: (a, b) => detHypot(a * 320 - 160, b * 180 - 90),
  detSin: a => detSin(a * 2 * Math.PI - Math.PI),
  detCos: a => detCos(a * 2 * Math.PI - Math.PI),
  detAtan2: (a, b) => detAtan2(a * 2 - 1, b * 2 - 1),
  detExp: a => detExp(-a * 0.2),
}

export type MathResults = Record<string, Array<number>>

export const mathResults = (): MathResults => {
  const pairs = inputs()
  return Object.fromEntries(
    Object.entries(FUNCTIONS).map(([name, fn]) => [
      name,
      pairs.map(([a, b]) => fn(a, b)),
    ]),
  )
}
