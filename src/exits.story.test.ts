import { Array, Option } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  type LevelSpec,
  PARLOUR,
  closedExits,
  isDoorTile,
  isWalkableTile,
  levelFor,
  levelOf,
  openExit,
  openExitIn,
  startingLevel,
  tileIndex,
} from './arena'
import { MAX_FRAME_DELTA_MS } from './constants'
import { update } from './main'
import { type Model, Phase, initialModel } from './model'
import {
  UNREACHED_DISTANCE,
  flowFieldToward,
  refreshFlowField,
} from './pathing'
import { roomShapes } from './room'
import { freshRun } from './runReset'
import { ticks } from './testing'

// NOTE: a made-up map with one boarded exit, since the parlour has none yet.
// The kitchen below the boards has its own door, shut until the exit opens.
const HALL: LevelSpec = {
  id: 'TestHall',
  tiles: [
    '###NN###',
    '#......#',
    '#......#',
    'W......#',
    'W......#',
    '###KK###',
    '#......#',
    '#......#',
    '###SS###',
  ],
  exits: [{ id: 'Kitchen', symbol: 'K', doors: ['South'] }],
}

const BOARDS = { column: 3, row: 5 }
const HALLWAY = { x: 35, y: 25 }
const BOARD_GAP_COLOR = '#140e0b'

const drawsBoards = (shapes: ReadonlyArray<unknown>): boolean =>
  JSON.stringify(shapes).includes(BOARD_GAP_COLOR)

const distanceTo = (
  distances: ReadonlyArray<number>,
  column: number,
  row: number,
): number =>
  Option.getOrElse(
    Array.get(distances, tileIndex(levelFor(HALL), column, row)),
    () => UNREACHED_DISTANCE,
  )

describe('a level with a closed exit', () => {
  const hall = levelFor(HALL)

  test('keeps the boards solid and the door behind them out of the spawn doors', () => {
    expect(isWalkableTile(hall, BOARDS.column, BOARDS.row)).toBe(false)
    expect(isWalkableTile(hall, 3, 8)).toBe(false)
    expect(isDoorTile(hall, 3, 8)).toBe(false)
    expect(hall.doorIds).toEqual(['North', 'West'])
    expect(Array.map(closedExits(hall), ({ id }) => id)).toEqual(['Kitchen'])
  })

  test('leaves the room behind it out of the flow field', () => {
    const field = flowFieldToward(hall, HALLWAY, 'Narrow', [])
    expect(distanceTo(field.distances, 3, 6)).toBe(UNREACHED_DISTANCE)
  })
})

describe('opening an exit', () => {
  const hall = levelFor(HALL)
  const opened = openExit(hall, 'Kitchen')

  test('turns the boards into floor and adds the doors behind them', () => {
    expect(isWalkableTile(opened, BOARDS.column, BOARDS.row)).toBe(true)
    expect(isWalkableTile(opened, 3, 8)).toBe(true)
    expect(isDoorTile(opened, 3, 8)).toBe(true)
    expect(opened.doorIds).toEqual(['North', 'West', 'South'])
    expect(opened.thresholds.South.tiles).toEqual([
      { column: 3, row: 8 },
      { column: 4, row: 8 },
    ])
    expect(closedExits(opened)).toEqual([])
    expect(opened.openExits).toEqual(['Kitchen'])
    expect(opened.key).not.toBe(hall.key)
  })

  test('lets the flow field reach the room behind the boards', () => {
    const field = flowFieldToward(opened, HALLWAY, 'Narrow', [])
    expect(distanceTo(field.distances, 3, 6)).toBeLessThan(UNREACHED_DISTANCE)
  })

  test('builds each set of open exits once, and opening twice changes nothing', () => {
    expect(levelFor(HALL, ['Kitchen'])).toBe(opened)
    expect(levelFor(HALL, ['Kitchen', 'Kitchen'])).toBe(opened)
    expect(openExit(opened, 'Kitchen')).toBe(opened)
    expect(openExit(hall, 'Attic')).toBe(hall)
    expect(levelFor(HALL)).toBe(hall)
  })

  test('rebuilds the flow field even when the player has not moved', () => {
    const before = flowFieldToward(hall, HALLWAY, 'Narrow', [])
    expect(refreshFlowField(hall, before, HALLWAY, 'Narrow', [])).toBe(before)
    const after = refreshFlowField(opened, before, HALLWAY, 'Narrow', [])
    expect(after).not.toBe(before)
    expect(after.levelKey).toBe(opened.key)
    expect(after.originIndex).toBe(before.originIndex)
    expect(distanceTo(after.distances, 3, 6)).toBeLessThan(UNREACHED_DISTANCE)
  })

  test('redraws the room without the boards', () => {
    expect(roomShapes(hall)).toBe(roomShapes(hall))
    expect(roomShapes(opened)).not.toBe(roomShapes(hall))
    expect(drawsBoards(roomShapes(hall))).toBe(true)
    expect(drawsBoards(roomShapes(opened))).toBe(false)
    expect(drawsBoards(roomShapes(PARLOUR))).toBe(false)
  })
})

describe('the parlour', () => {
  test('is where every run starts, with no exit to buy yet', () => {
    expect(initialModel.level).toEqual(startingLevel)
    expect(levelOf(initialModel)).toBe(PARLOUR)
    expect(PARLOUR.exits).toEqual([])
    expect(openExitIn(startingLevel, 'Kitchen')).toBe(startingLevel)
    expect(freshRun(initialModel).level).toEqual(startingLevel)
  })

  test('keeps its level and its flow field through a wave', () => {
    const fighting: Model = modifyFields(initialModel, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () => Phase.Wave({ wave: 1, elapsedMs: 0, spawns: [] }),
    })
    story(
      update,
      given(fighting),
      ...ticks(30, MAX_FRAME_DELTA_MS),
      model(current => {
        expect(levelOf(current)).toBe(PARLOUR)
        expect(current.flowField.levelKey).toBe(PARLOUR.key)
        expect(current.wideFlowField.levelKey).toBe(PARLOUR.key)
      }),
    )
  })
})
