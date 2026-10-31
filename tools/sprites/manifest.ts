import { Schema } from 'effect'

// NOTE: the atlas manifest ./build.ts writes and ./vitePlugin.ts reads, as
// a Schema of src/spriteAtlas.ts's SpriteAtlas, so the JSON goes through it.
const AtlasEntry = Schema.Tuple([
  Schema.Number,
  Schema.Number,
  Schema.Number,
  Schema.Number,
  Schema.Number,
])

export const AtlasEntries = Schema.Record(
  Schema.String,
  Schema.NullOr(AtlasEntry),
)

export const SpriteAtlasManifest = Schema.Struct({
  sources: Schema.Array(Schema.String),
  entries: AtlasEntries,
})

// NOTE: what `build.ts --keys` prints: every sprite key.
export const SpriteKeys = Schema.Array(Schema.String)
