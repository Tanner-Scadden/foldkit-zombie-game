import { Predicate } from 'effect'

// NOTE: a thrown value as text, for the engine's worker and the browser side
// both. Its own module, so the browser side never loads the engine.
export const describeError = (error: unknown): string =>
  Predicate.hasProperty(error, 'message') && Predicate.isString(error.message)
    ? error.message
    : String(error)
