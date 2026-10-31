import { Schema } from 'effect'
import { readFileSync, writeFileSync } from 'node:fs'

// NOTE: the tools read and write JSON through a Schema, as the game does
// (AGENTS.md "Code shape"): a report, a fixture, or a reply that changed
// shape fails at the read with the Schema's message, not later as
// `undefined`. Declare a Schema for the fields the tool reads: a Struct
// ignores the rest.

// NOTE: JSON text decoded with `schema`.
export const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
): ((text: string) => S['Type']) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(schema))

// NOTE: a value as JSON text through `schema`, indented by `space` when set.
export const encodeJson = <S extends Schema.ConstraintEncoder<unknown>>(
  schema: S,
  space?: number,
): ((value: S['Type']) => string) =>
  Schema.encodeSync(
    Schema.fromJsonString(schema, space === undefined ? {} : { space }),
  )

// NOTE: a JSON file decoded with `schema`.
export const readJsonFile = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  path: string,
): S['Type'] => decodeJson(schema)(readFileSync(path, 'utf8'))

// NOTE: writes `value` through `schema` as indented JSON with a final newline.
export const writeJsonFile = <S extends Schema.ConstraintEncoder<unknown>>(
  schema: S,
  path: string,
  value: S['Type'],
): void => {
  writeFileSync(path, `${encodeJson(schema, 2)(value)}\n`)
}
