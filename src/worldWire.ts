import { Schema } from 'effect'

import { World } from './world'

// The World as one JSON text and back, for tools that carry a World
// between engines (tools/determinism). The co-op room's wire is the binary
// codec in src/worldCodec.ts.

const worldCodec = Schema.toCodecJson(World)
const WorldJson = Schema.fromJsonString(worldCodec)

export const worldToJson: (world: World) => string =
  Schema.encodeSync(WorldJson)

export const worldFromJson: (text: string) => World =
  Schema.decodeSync(WorldJson)
