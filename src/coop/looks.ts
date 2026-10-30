import { Array, Option } from 'effect'

import type { Appearance } from '../worldSchema'

// NOTE: until each player's look rides in the lobby, a teammate wears one
// of these, by seat, and your own seat wears your own look, in the lobby
// and in the run alike.
export const SEAT_LOOKS: Array.NonEmptyReadonlyArray<Appearance> = [
  {
    body: 'Male',
    hairStyle: 'Crop',
    hairColor: 'Brown',
    skinTone: 'Light',
    shirtColor: 'Blue',
  },
  {
    body: 'Female',
    hairStyle: 'Ponytail',
    hairColor: 'Ginger',
    skinTone: 'Tan',
    shirtColor: 'Teal',
  },
  {
    body: 'Male',
    hairStyle: 'Curls',
    hairColor: 'Black',
    skinTone: 'Deep',
    shirtColor: 'Yellow',
  },
  {
    body: 'Female',
    hairStyle: 'Long',
    hairColor: 'Pink',
    skinTone: 'Fair',
    shirtColor: 'Purple',
  },
]

export const seatLook = (seat: number): Appearance =>
  Option.getOrElse(Array.get(SEAT_LOOKS, seat % SEAT_LOOKS.length), () =>
    Array.headNonEmpty(SEAT_LOOKS),
  )

export const seatLookOf = (
  ownLook: Appearance,
  ownSeat: number,
  seat: number,
): Appearance => (seat === ownSeat ? ownLook : seatLook(seat))
