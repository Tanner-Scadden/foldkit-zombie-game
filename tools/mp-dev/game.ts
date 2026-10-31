import { DEFAULT_ROOM_SETTINGS, roomWorldFor } from '../../src/roomWorld'

// NOTE: the game's own World, as the GameRoom runs it, for the dev page and
// the end to end check.
export const GAME = roomWorldFor(DEFAULT_ROOM_SETTINGS)
