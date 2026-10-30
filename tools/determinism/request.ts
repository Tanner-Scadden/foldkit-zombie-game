// What the orchestrator asks an engine for and what it answers, as URL style
// parameters and JSON. No game imports, so the orchestrator can load it
// without the game.

export type ScriptMode = 'Campaign' | 'Endless'

// How long each frame is. Fixed60 is the room's step. Mixed cycles through
// 60, 120, 30, and 40 Hz frames, the way a browser's display drives the game
// today, so the same check keeps working once the fixed step lands (it
// should then give the same ticks for any pattern).
export type StepPattern = 'Fixed60' | 'Mixed'

export type EngineRequest = Readonly<{
  frames: number
  seed: number
  mode: ScriptMode
  pattern: StepPattern
  every: number
  detMath: boolean
  dump: number | undefined
}>

export const DEFAULT_REQUEST: EngineRequest = {
  frames: 18_000,
  seed: 1,
  mode: 'Campaign',
  pattern: 'Fixed60',
  every: 1,
  detMath: false,
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
    ...(request.dump === undefined ? {} : { dump: String(request.dump) }),
  }).toString()

export type EngineRun = Readonly<{
  engine: string
  frames: number
  endPhase: string
  endWave: number
  checkpoints: ReadonlyArray<readonly [number, number]>
  unclassified: ReadonlyArray<string>
}>

export type EngineDump = Readonly<{
  engine: string
  frame: number
  fieldHashes: ReadonlyArray<readonly [string, number]>
  // exactJson of the gameplay state.
  state: string
}>
