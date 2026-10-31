// What the orchestrator asks an engine for and what it answers, as URL style
// parameters and JSON. No game imports, so the orchestrator can load it
// without the game.

import { Schema } from 'effect'

const ScriptMode = Schema.Literals(['Campaign', 'Endless'])
export type ScriptMode = typeof ScriptMode.Type

// How long each frame is. Fixed60 is the room's step. Mixed cycles through
// 60, 120, 30, and 40 Hz frames, the way a browser's display drives the game
// today, so the same check keeps working once the fixed step lands (it
// should then give the same ticks for any pattern).
const StepPattern = Schema.Literals(['Fixed60', 'Mixed'])
export type StepPattern = typeof StepPattern.Type

export const EngineRequest = Schema.Struct({
  frames: Schema.Number,
  seed: Schema.Number,
  mode: ScriptMode,
  pattern: StepPattern,
  every: Schema.Number,
  detMath: Schema.Boolean,
  // NOTE: clear hit-stop after every frame, so no freeze or slow motion
  // ever runs. Hit-stop counts whole ticks since the fixed step, where it
  // cut a frame's world time before, so this compares everything else.
  noHitStop: Schema.Boolean,
  dump: Schema.UndefinedOr(Schema.Number),
})
export type EngineRequest = typeof EngineRequest.Type

export const DEFAULT_REQUEST: EngineRequest = {
  frames: 18_000,
  seed: 1,
  mode: 'Campaign',
  pattern: 'Fixed60',
  every: 1,
  detMath: false,
  noHitStop: false,
  dump: undefined,
}

const numberOr = (text: string | null | undefined, fallback: number) =>
  text === null || text === undefined || text === '' ? fallback : Number(text)

// A request from URL style parameters, the one format every engine can read.
export const requestOf = (params: URLSearchParams): EngineRequest => ({
  frames: numberOr(params.get('frames'), DEFAULT_REQUEST.frames),
  seed: numberOr(params.get('seed'), DEFAULT_REQUEST.seed),
  mode: params.get('mode') === 'Endless' ? 'Endless' : 'Campaign',
  pattern: params.get('pattern') === 'Mixed' ? 'Mixed' : 'Fixed60',
  every: numberOr(params.get('every'), DEFAULT_REQUEST.every),
  detMath: params.get('detMath') === '1',
  noHitStop: params.get('noHitStop') === '1',
  dump: params.has('dump') ? Number(params.get('dump')) : undefined,
})

export const paramsOf = (request: EngineRequest): string =>
  new URLSearchParams({
    frames: String(request.frames),
    seed: String(request.seed),
    mode: request.mode,
    pattern: request.pattern,
    every: String(request.every),
    detMath: request.detMath ? '1' : '0',
    noHitStop: request.noHitStop ? '1' : '0',
    ...(request.dump === undefined ? {} : { dump: String(request.dump) }),
  }).toString()

export const EngineRun = Schema.Struct({
  engine: Schema.String,
  frames: Schema.Number,
  endPhase: Schema.String,
  endWave: Schema.Number,
  checkpoints: Schema.Array(Schema.Tuple([Schema.Number, Schema.Number])),
  unclassified: Schema.Array(Schema.String),
})
export type EngineRun = typeof EngineRun.Type

export const EngineDump = Schema.Struct({
  engine: Schema.String,
  frame: Schema.Number,
  fieldHashes: Schema.Array(Schema.Tuple([Schema.String, Schema.Number])),
  // exactJson of the gameplay state.
  state: Schema.String,
})
export type EngineDump = typeof EngineDump.Type

// NOTE: a dump asked for a frame the run never reached.
const EngineMissing = Schema.Struct({
  engine: Schema.String,
  frame: Schema.Number,
  missing: Schema.Literal(true),
})

// NOTE: what an engine answers when the run throws: the stack, or the
// thrown value as it was.
const EngineError = Schema.Struct({ error: Schema.Unknown })

// NOTE: every engine answers through these, so all print the same text,
// and the orchestrators read the answers back through them.
export const encodeEngineRun = Schema.encodeSync(
  Schema.fromJsonString(EngineRun),
)
export const encodeEngineDump = Schema.encodeSync(
  Schema.fromJsonString(Schema.Union([EngineDump, EngineMissing])),
)
export const encodeEngineError = Schema.encodeSync(
  Schema.fromJsonString(EngineError),
)
export const decodeEngineRun = Schema.decodeUnknownOption(
  Schema.fromJsonString(EngineRun),
)
export const decodeEngineDump = Schema.decodeUnknownOption(
  Schema.fromJsonString(EngineDump),
)
export const decodeEngineError = Schema.decodeUnknownOption(
  Schema.fromJsonString(EngineError),
)
