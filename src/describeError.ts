// NOTE: a thrown value as the reason a tagged error carries: an Error's
// message, or anything else as text.
export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
