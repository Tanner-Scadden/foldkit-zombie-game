import { Array, Schema, Struct } from 'effect'

import { World } from './world'

// The World on the wire, for the co-op room's `snapshot` and `diff`
// (packages/netcode, `World.ts`): a snapshot is every field, and a diff is
// the fields that changed, each as its Schema's JSON. Fields are compared
// as the client reads them back, so a client that applies every diff holds
// exactly what a snapshot gives. Compact binary entity lists are Phase 2's
// (MULTIPLAYER.md, "The binary codec"); this keeps the room honest first.
//
// The writer and reader are the netcode package's `Writer` and `Reader`,
// named here by the two calls they need, so the step's imports stay free of
// the package.

export type TextWriter = Readonly<{
  varint: (value: number) => void
  text: (value: string) => void
}>

export type TextReader = Readonly<{
  varint: () => number
  text: (maxLength: number) => string
}>

type WorldKey = keyof typeof World.fields

const WORLD_KEYS: ReadonlyArray<WorldKey> = Struct.keys(World.fields)

// NOTE: a whole World is tens of KB of JSON; a field is far less.
const MAX_FIELD_TEXT = 1 << 20
const MAX_WORLD_TEXT = 1 << 22

const worldCodec = Schema.toCodecJson(World)
const encodeWorld = Schema.encodeSync(worldCodec)
const decodeWorld = Schema.decodeSync(worldCodec)

const fieldCodec = (key: WorldKey) => Schema.toCodecJson(World.fields[key])

const FIELD_CODECS = new Map(
  Array.map(WORLD_KEYS, key => [key, fieldCodec(key)] as const),
)

const encodeField = (key: WorldKey, world: World): string => {
  const codec = FIELD_CODECS.get(key) ?? fieldCodec(key)
  return JSON.stringify(Schema.encodeUnknownSync(codec)(world[key]))
}

const decodeField = (key: WorldKey, text: string): unknown => {
  const codec = FIELD_CODECS.get(key) ?? fieldCodec(key)
  return Schema.decodeUnknownSync(codec)(JSON.parse(text))
}

// NOTE: the World as one JSON text and back, for a snapshot and for tools
// that carry a World between engines.
export const worldToJson = (world: World): string =>
  JSON.stringify(encodeWorld(world))

export const worldFromJson = (text: string): World =>
  decodeWorld(JSON.parse(text))

export const snapshotWorld = (writer: TextWriter, world: World): void =>
  writer.text(worldToJson(world))

export const readWorldSnapshot = (reader: TextReader): World =>
  worldFromJson(reader.text(MAX_WORLD_TEXT))

type Change = readonly [index: number, text: string]

const changeOf =
  (prev: World, next: World) =>
  (key: WorldKey, index: number): ReadonlyArray<Change> => {
    if (prev[key] === next[key]) {
      return []
    }
    const text = encodeField(key, next)
    return text === encodeField(key, prev) ? [] : [[index, text]]
  }

export const diffWorld = (
  writer: TextWriter,
  prev: World,
  next: World,
): void => {
  const changes = Array.flatMap(WORLD_KEYS, changeOf(prev, next))
  writer.varint(changes.length)
  Array.forEach(changes, ([index, text]) => {
    writer.varint(index)
    writer.text(text)
  })
}

const readChange = (reader: TextReader): readonly [WorldKey, unknown] => {
  const key = WORLD_KEYS[reader.varint()]
  if (key === undefined) {
    throw new Error('A World diff named a field the World does not have')
  }
  return [key, decodeField(key, reader.text(MAX_FIELD_TEXT))]
}

const readChanges = (
  reader: TextReader,
  count: number,
  read: ReadonlyArray<readonly [WorldKey, unknown]> = [],
): ReadonlyArray<readonly [WorldKey, unknown]> =>
  count <= 0
    ? read
    : readChanges(reader, count - 1, [...read, readChange(reader)])

export const applyWorldDiff = (reader: TextReader, prev: World): World =>
  Array.reduce(
    readChanges(reader, reader.varint()),
    prev,
    (world, [key, value]): World => ({ ...world, [key]: value }),
  )
