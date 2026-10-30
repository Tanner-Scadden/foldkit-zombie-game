import { Schema } from 'effect'

import { World } from './world'

// The World as one JSON text and back, for tools that carry a World
// between engines (tools/determinism). The co-op room's wire is the binary
// codec in src/worldCodec.ts.

const worldCodec = Schema.toCodecJson(World)
const encodeWorld = Schema.encodeSync(worldCodec)
const decodeWorld = Schema.decodeSync(worldCodec)

export const worldToJson = (world: World): string =>
  JSON.stringify(encodeWorld(world))

export const worldFromJson = (text: string): World =>
  decodeWorld(JSON.parse(text))
