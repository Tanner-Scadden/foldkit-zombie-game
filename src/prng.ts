const MULBERRY_INCREMENT = 0x6d2b79f5
const UINT32_RANGE = 4294967296

export type RandomDraw = Readonly<{ value: number; nextState: number }>

export const nextRandom = (state: number): RandomDraw => {
  const advanced = (state + MULBERRY_INCREMENT) | 0
  const mixed = Math.imul(advanced ^ (advanced >>> 15), advanced | 1)
  const remixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)) ^ mixed
  return {
    value: ((remixed ^ (remixed >>> 14)) >>> 0) / UINT32_RANGE,
    nextState: advanced >>> 0,
  }
}
