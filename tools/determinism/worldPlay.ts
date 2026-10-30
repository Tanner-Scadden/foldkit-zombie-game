// The World played on its own: the same few ticks in any engine, from a
// World as JSON. It imports only the step, its wire, and the deterministic
// Math, so a bundle of it holds exactly what a co-op room would run.

import { Schema } from 'effect'

import { soloInputs, stepWorld } from '../../src/stepWorld'
import type { World } from '../../src/world'
import { worldFromJson, worldToJson } from '../../src/worldWire'
import { Intent } from '../../src/worldSchema'
import { installDeterministicMath } from './detMath'

// NOTE: plain JSON both ways, so it crosses into any engine: the World and
// the intent as their Schemas' JSON.
export type PlayRequest = Readonly<{
  world: string
  intent: string
  ticks: number
}>

const IntentJson = Schema.toCodecJson(Intent)

export const intentToJson = (intent: Intent): string =>
  JSON.stringify(Schema.encodeSync(IntentJson)(intent))

const play = (world: World, intent: Intent, ticks: number): World =>
  ticks <= 0
    ? world
    : play(stepWorld(world, soloInputs(intent)).world, intent, ticks - 1)

// NOTE: the engines' own transcendental Math differs in its last bits
// (tools/determinism/README.md), so both sides play with detMath to agree
// bit for bit.
export const playWorld = (request: PlayRequest): string => {
  installDeterministicMath()
  return worldToJson(
    play(
      worldFromJson(request.world),
      Schema.decodeUnknownSync(IntentJson)(JSON.parse(request.intent)),
      request.ticks,
    ),
  )
}
