// Shared inputs for the netcode tests. `tools/lint/duplicateHelpers.ts`
// fails a helper copied between test files: add it here instead.

import { MOVE_SCALE, NEUTRAL_INPUT, type PlayerInput } from '../src/index'

// NOTE: a player holding right, and nothing else.
export const right: PlayerInput = { ...NEUTRAL_INPUT, moveX: MOVE_SCALE }
