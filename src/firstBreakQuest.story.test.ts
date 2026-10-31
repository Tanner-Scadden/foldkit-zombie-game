import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS, PREPARATION_MS } from './constants'
import { type QuestStep, maybeQuestDoor, questStepOf } from './firstBreakQuest'
import { update } from './main'
import { Message } from './message'
import {
  BreakClock,
  Invulnerability,
  Lesson,
  type Model,
  Party,
  Phase,
  type PlannedSpawn,
  ShopState,
  Tour,
  TrapHint,
  initialModel,
} from './model'
import { isStartWaveBeckoning } from './onboarding'
import { soloSeat } from './party'
import { forgetTutorial } from './save'
import { isFirstPlankFree, priceFor } from './shop'
import { press } from './testing'
import { TRAPS } from './traps'
import { asTutorialDone, asVeteran } from './veteran'

// NOTE: the guided first break (src/firstBreakQuest.ts): walk to Rattles,
// buy a Plank Pile (free this once), place it, then START WAVE.

const FRAME_MS = FIXED_STEP_MS

const HELD_SPAWN: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
}

const BELOW_NORTH_DOOR = { x: 220, y: 27 }

// NOTE: a new save's first break: it has played wave 1, so it has moved
// and fired, and has a little money, short of a Plank Pile.
const firstBreak = (base: Model = asVeteran(initialModel)): Model =>
  modifyFields(base, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () =>
      Phase.Preparation({
        wave: 2,
        remainingMs: PREPARATION_MS,
        durationMs: PREPARATION_MS,
        spawns: [HELD_SPAWN],
        clock: BreakClock.Waiting({ elapsedMs: 0 }),
      }),
    wallet: wallet => ({ ...wallet, balance: 12, shown: 12, earned: 12 }),
    player: player =>
      modifyFields(player, {
        x: () => BELOW_NORTH_DOOR.x,
        y: () => BELOW_NORTH_DOOR.y,
        facing: () => ({ x: 1, y: 0 }),
        invulnerability: () =>
          Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
      }),
  })

const frame = (current: Model): Model =>
  update(current, Message.TickedFrame({ deltaTime: FRAME_MS })).model

const stepOf = (current: Model): Option.Option<QuestStep> =>
  questStepOf(current)

const browsing = (current: Model): Model =>
  modifyFields(current, {
    shop: () => ShopState.Browsing({ focusedItem: 'Barricade' }),
    shopCategory: () => 'Traps',
  })

const buyPlanks = (current: Model): Model =>
  update(current, Message.ClickedBuyButton({ item: 'Barricade' })).model

const away = (current: Model): Model =>
  modifyFields(current, { shop: () => ShopState.Dismissed() })

describe('the guided first break', () => {
  test('walks a new player from the stall to buying to placing, then START WAVE', () => {
    const started = frame(firstBreak())
    expect(started.firstBreakQuest).toEqual(Tour.Running())
    expect(stepOf(started)).toEqual(Option.some('Shop'))

    const shopping = browsing(started)
    expect(stepOf(shopping)).toEqual(Option.some('Buy'))

    const bought = buyPlanks(shopping)
    expect(bought.trapStock.Barricade).toBe(1)
    expect(stepOf(away(bought))).toEqual(Option.some('Place'))
    expect(Option.isSome(maybeQuestDoor(away(bought)))).toBe(true)

    story(
      update,
      given(away(bought)),
      press('KeyT'),
      model(current => {
        expect(current.trapHint).toEqual(TrapHint.Seen())
      }),
      message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      model(current => {
        expect(Tour.isAnyOf(['Done'])(current.firstBreakQuest)).toBe(true)
        expect(stepOf(current)).toEqual(Option.none())
        expect(isStartWaveBeckoning(current)).toBe(true)
      }),
      Command.resolveAll(),
    )
  })

  test('with no money for it, the first Plank Pile is free', () => {
    const started = frame(firstBreak())
    expect(started.wallet.balance).toBeLessThan(TRAPS.Barricade.price)
    expect(priceFor(started, 'Barricade')).toBe(0)
    const bought = buyPlanks(browsing(started))
    expect(bought.trapStock.Barricade).toBe(1)
    expect(bought.wallet.balance).toBe(started.wallet.balance)
    expect(priceFor(bought, 'Barricade')).toBe(TRAPS.Barricade.price)
  })

  test('the skip button ends it at any step', () => {
    const started = frame(firstBreak())
    const skipped = update(started, Message.ClickedSkipQuestButton()).model
    expect(skipped.firstBreakQuest).toEqual(Tour.Over())
    expect(stepOf(frame(skipped))).toEqual(Option.none())
  })

  test('starting the wave ends it', () => {
    const started = frame(firstBreak())
    const waved = update(started, Message.ClickedStartWaveButton()).model
    expect(Phase.isAnyOf(['Wave'])(waved.phase)).toBe(true)
    expect(frame(waved).firstBreakQuest).toEqual(Tour.Over())
  })

  test('runs once per save: a player who has shopped or bought a trap never sees it', () => {
    const shopped = firstBreak(
      modifyFields(asVeteran(initialModel), {
        lessons: lessons =>
          modifyFields(lessons, { shop: () => Lesson.Learned({ atMs: 0 }) }),
      }),
    )
    expect(frame(shopped).firstBreakQuest).toEqual(Tour.Waiting())
    const trapper = firstBreak(
      modifyFields(asVeteran(initialModel), {
        trapHint: () => TrapHint.Seen(),
      }),
    )
    expect(frame(trapper).firstBreakQuest).toEqual(Tour.Waiting())
    const done = firstBreak(asTutorialDone(asVeteran(initialModel)))
    expect(stepOf(frame(done))).toEqual(Option.none())
    expect(isFirstPlankFree(done, 'Barricade')).toBe(false)
  })

  test('a tutorial reset plays it again', () => {
    const done = firstBreak(asTutorialDone(asVeteran(initialModel)))
    const reset = firstBreak(forgetTutorial(done))
    expect(frame(reset).firstBreakQuest).toEqual(Tour.Running())
  })

  test('in co-op it never runs and planks cost full price', () => {
    const crew = modifyFields(firstBreak(), {
      party: () => Party.Crew({ lead: soloSeat, mates: [] }),
    })
    expect(stepOf(frame(crew))).toEqual(Option.none())
    expect(isFirstPlankFree(crew, 'Barricade')).toBe(false)
  })
})
