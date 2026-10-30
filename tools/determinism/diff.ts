// Comparing runs: the first checkpoint two runs disagree on, the first path
// where two gameplay states differ, and JSON that keeps every number exact.
// No game imports, so the orchestrator can load it without the game.

export type Checkpoint = readonly [frame: number, hash: number]

// The first checkpoint two runs disagree on, by frame.
export const firstDivergentCheckpoint = (
  a: ReadonlyArray<Checkpoint>,
  b: ReadonlyArray<Checkpoint>,
): Readonly<{ index: number; frame: number }> | undefined => {
  const index = Array.from(
    { length: Math.max(a.length, b.length) },
    (_, at) => at,
  ).find(at => {
    const left = a[at]
    const right = b[at]
    return (
      left === undefined ||
      right === undefined ||
      left[0] !== right[0] ||
      left[1] !== right[1]
    )
  })
  if (index === undefined) {
    return undefined
  }
  return { index, frame: a[index]?.[0] ?? b[index]?.[0] ?? -1 }
}

// DIFF

export type Difference = Readonly<{ path: string; a: unknown; b: unknown }>

const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null

const sameNumber = (a: number, b: number): boolean =>
  Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))

const entriesOf = (value: object): ReadonlyArray<readonly [string, unknown]> =>
  Object.entries(value).filter(([, inner]) => inner !== undefined)

// The first path, depth first in canonical key order, where two states
// differ. Numbers compare by bits (0 and -0 differ).
export const firstDifference = (
  a: unknown,
  b: unknown,
  path = '',
): Difference | undefined => {
  if (typeof a === 'number' && typeof b === 'number') {
    return sameNumber(a, b) ? undefined : { path, a, b }
  }
  if (!isObject(a) || !isObject(b)) {
    return Object.is(a, b) ? undefined : { path, a, b }
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return { path, a, b }
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { path: `${path}.length`, a: a.length, b: b.length }
    }
    return a.reduce<Difference | undefined>(
      (found, item, index) =>
        found ?? firstDifference(item, b[index], `${path}[${index}]`),
      undefined,
    )
  }
  const tagA = '_tag' in a ? a['_tag'] : undefined
  const tagB = '_tag' in b ? b['_tag'] : undefined
  if (tagA !== tagB) {
    return { path: `${path}._tag`, a: tagA, b: tagB }
  }
  const left = new Map(entriesOf(a))
  const right = new Map(entriesOf(b))
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort()
  return keys.reduce<Difference | undefined>(
    (found, key) =>
      found ?? firstDifference(left.get(key), right.get(key), `${path}.${key}`),
    undefined,
  )
}

// JSON that keeps every float64 exactly: -0, NaN, and the infinities become
// tagged strings, which `revive` turns back.
export const exactJson = (value: unknown): string =>
  JSON.stringify(value, (_, inner: unknown) =>
    typeof inner === 'number' &&
    (!Number.isFinite(inner) || Object.is(inner, -0))
      ? `#num:${Object.is(inner, -0) ? '-0' : String(inner)}`
      : inner,
  )

export const revive = (text: string): unknown =>
  JSON.parse(text, (_, inner: unknown) =>
    typeof inner === 'string' && inner.startsWith('#num:')
      ? Number(inner.slice(5))
      : inner,
  )
