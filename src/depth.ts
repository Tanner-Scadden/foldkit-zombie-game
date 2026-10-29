import { Array, Order, pipe } from 'effect'
import type { Canvas } from 'foldkit'

// DRAWABLE

export type DepthRank = 'Prop' | 'Trap' | 'Pickup' | 'Zombie' | 'Player'

const RANK_ORDER: Readonly<Record<DepthRank, number>> = {
  Prop: 0,
  Trap: 1,
  Pickup: 2,
  Zombie: 3,
  Player: 4,
}

export type Drawable = Readonly<{
  footY: number
  rank: DepthRank
  shapes: ReadonlyArray<Canvas.Shape>
}>

// NOTE: whatever stands nearer the bottom of the screen is nearer the viewer,
// so it draws later. Two drawables at the same foot draw by rank, and two of
// the same rank keep the order they came in, since the sort is stable.
export const byDepth: Order.Order<Drawable> = Order.combine(
  Order.mapInput(Order.Number, ({ footY }: Drawable) => footY),
  Order.mapInput(Order.Number, ({ rank }: Drawable) => RANK_ORDER[rank]),
)

export const depthSortedShapes = (
  drawables: ReadonlyArray<Drawable>,
): ReadonlyArray<Canvas.Shape> =>
  pipe(
    drawables,
    Array.sort(byDepth),
    Array.flatMap(({ shapes }) => shapes),
  )
