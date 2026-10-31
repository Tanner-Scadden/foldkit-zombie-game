import { Array, Match } from 'effect'
import type { Canvas } from 'foldkit'
import {
  Mount,
  expect,
  given,
  role,
  scene,
  selector,
  text,
  within,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test, expect as vitestExpect } from 'vitest'

import { screenCameraOf } from './camera'
import { TURN_HINT_TEXT } from './homeView'
import { hudShapes } from './hud'
import { update } from './main'
import { Message } from './message'
import { BreakClock, type Model, Phase, initialModel } from './model'
import { DISTANT_SPAWN, inPortrait } from './model.fixture'
import { MeasureGameSurface } from './mount'
import { screenOf, thumbAreaTop } from './screen'
import { PHONE_LANDSCAPE, PHONE_PORTRAIT, ROOT, rectsOf } from './testing'
import { asVeteran } from './veteran'
import { wavePreviewShapes } from './wavePreview'

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

const boxesOf = (
  shapes: ReadonlyArray<Canvas.Shape>,
  offset: Readonly<{ x: number; y: number }>,
): ReadonlyArray<Box> =>
  Array.flatMap(shapes, (shape): ReadonlyArray<Box> =>
    Match.value(shape).pipe(
      Match.tag('Group', group =>
        boxesOf(group.shapes, {
          x: offset.x + (group.translate?.x ?? 0),
          y: offset.y + (group.translate?.y ?? 0),
        }),
      ),
      Match.tag('Rect', 'Image', ({ x, y, width, height }) => [
        { x: x + offset.x, y: y + offset.y, width, height },
      ]),
      Match.orElse(() => []),
    ),
  )

const onTouch = (phase: Phase): Model =>
  modifyFields(asVeteran(initialModel), {
    lastDevice: () => 'Touch',
    phase: () => phase,
  })

const fighting = onTouch(
  Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
)

const SLOT_FILL = 'rgba(8, 10, 12, 0.6)'

const gunSlotFills = (model: Model): ReadonlyArray<Box> =>
  Array.filter(
    rectsOf(hudShapes(model, screenOf(model), screenCameraOf(model)), {
      x: 0,
      y: 0,
    }),
    rect => rect.fill === SLOT_FILL && rect.width === 38,
  )

const root = selector('.game-root')
const measure = (surface: typeof PHONE_PORTRAIT) =>
  Mount.resolve(MeasureGameSurface, Message.MeasuredGameSurface(surface))

// NOTE: the surface's MeasureGameSurface Mount reports once per Scene, so a
// phone turning mid-scene is a new Scene on the Model the earlier
// measurements left, whose Mount then reports the new size.
const remeasured = (
  model: Model,
  surfaces: ReadonlyArray<typeof PHONE_PORTRAIT>,
): Model =>
  surfaces.reduce(
    (current, surface) =>
      update(current, Message.MeasuredGameSurface(surface)).model,
    model,
  )

describe('the portrait HUD and thumb area', () => {
  test('the guns sit in the thumb area under the world window', () => {
    const portrait = inPortrait(fighting)
    const screen = screenOf(portrait)
    const slots = gunSlotFills(portrait)
    vitestExpect(slots).toHaveLength(2)
    Array.forEach(slots, slot => {
      vitestExpect(slot.y).toBeGreaterThan(thumbAreaTop(screen))
      vitestExpect(slot.y + slot.height).toBeLessThanOrEqual(screen.height)
      vitestExpect(slot.x).toBeGreaterThanOrEqual(0)
      vitestExpect(slot.x + slot.width).toBeLessThanOrEqual(screen.width)
    })
  })

  test('the hearts, money, and wave label sit in the band above the world window', () => {
    const portrait = inPortrait(fighting)
    const screen = screenOf(portrait)
    const rects = boxesOf(
      hudShapes(portrait, screen, screenCameraOf(portrait)),
      {
        x: 0,
        y: 0,
      },
    )
    const topRects = Array.filter(rects, rect => rect.y < screen.world.y)
    const lowRects = Array.filter(
      rects,
      rect => rect.y >= screen.world.y + screen.world.height,
    )
    vitestExpect(
      Array.every(rects, rect => rect.x + rect.width <= screen.width),
    ).toBe(true)
    vitestExpect(Array.isReadonlyArrayNonEmpty(topRects)).toBe(true)
    vitestExpect(Array.isReadonlyArrayNonEmpty(lowRects)).toBe(true)
    vitestExpect(
      Array.filter(
        rects,
        rect =>
          rect.y >= screen.world.y &&
          rect.y + rect.height <= screen.world.y + screen.world.height,
      ),
    ).toHaveLength(0)
  })

  test('the gun cluster buttons follow the guns into the thumb area', () => {
    scene(
      ROOT,
      given(fighting),
      measure(PHONE_PORTRAIT),
      expect(root).toHaveAttr('data-layout', 'Portrait'),
      expect(selector('.gun-cluster')).toHaveAttr('data-layout', 'Portrait'),
      expect(selector('.gun-cluster')).toHaveStyle(
        'bottom',
        '1.2820512820512822%',
      ),
      expect(
        within(selector('.gun-cluster'), role('group', { name: 'Your guns' })),
      ).toExist(),
      expect(role('button', { name: 'Pause' })).toExist(),
    )
  })
})

describe('turning the phone', () => {
  test('switches the layout live mid-wave and keeps fighting', () => {
    scene(
      ROOT,
      given(fighting),
      measure(PHONE_LANDSCAPE),
      expect(root).toHaveAttr('data-layout', 'Landscape'),
      expect(root).toHaveStyle('--screen-w', '320'),
      expect(role('status')).toHaveText('Fighting wave 3 of 10.'),
    )
    scene(
      ROOT,
      given(remeasured(fighting, [PHONE_LANDSCAPE])),
      measure(PHONE_PORTRAIT),
      expect(root).toHaveAttr('data-layout', 'Portrait'),
      expect(root).toHaveStyle('--screen-w', '180'),
      expect(root).toHaveStyle('--screen-h', '390'),
      expect(role('status')).toHaveText('Fighting wave 3 of 10.'),
      expect(role('dialog', { name: 'Turn your phone sideways' })).toBeAbsent(),
      expect(role('group', { name: 'Your guns' })).toExist(),
      expect(root).toHaveStyle('--frame-top', '74'),
      expect(selector('.thumb-area')).toExist(),
    )
    scene(
      ROOT,
      given(remeasured(fighting, [PHONE_LANDSCAPE, PHONE_PORTRAIT])),
      measure(PHONE_LANDSCAPE),
      expect(root).toHaveAttr('data-layout', 'Landscape'),
      expect(root).toHaveStyle('--frame-top', '0'),
      expect(selector('.thumb-area')).toBeAbsent(),
      expect(role('status')).toHaveText('Fighting wave 3 of 10.'),
    )
  })

  test('a keyboard and mouse keep the landscape layout in a tall window', () => {
    scene(
      ROOT,
      given(modifyFields(fighting, { lastDevice: () => 'KeyboardMouse' })),
      measure(PHONE_PORTRAIT),
      expect(root).toHaveAttr('data-layout', 'Landscape'),
      expect(role('status')).toHaveText('Fighting wave 3 of 10.'),
    )
  })
})

describe('the portrait home menu', () => {
  test('keeps every slot: the player, the MORE deck, and PLAY with its mode and difficulty, and no bests badge before a best', () => {
    scene(
      ROOT,
      given(onTouch(Phase.Ready())),
      measure(PHONE_PORTRAIT),
      expect(root).toHaveAttr('data-layout', 'Portrait'),
      expect(role('button', { name: /^More:/ })).toExist(),
      expect(role('region', { name: /^Your bests/ })).toBeAbsent(),
      expect(role('group', { name: 'Play' })).toExist(),
      expect(role('button', { name: /^Play/ })).toExist(),
      expect(role('button', { name: /^Difficulty/ })).toExist(),
      expect(selector('.home-hero')).toExist(),
    )
  })
})

describe('the turn hint', () => {
  const turnHint = role('img', { name: TURN_HINT_TEXT })

  test('shows the tipping phone, with no words, on the portrait home menu and goes when the phone turns', () => {
    scene(
      ROOT,
      given(onTouch(Phase.Ready())),
      measure(PHONE_PORTRAIT),
      expect(turnHint).toExist(),
      expect(selector('.home-turn-hint')).toExist(),
      expect(text(TURN_HINT_TEXT)).toBeAbsent(),
    )
    scene(
      ROOT,
      given(remeasured(onTouch(Phase.Ready()), [PHONE_PORTRAIT])),
      measure(PHONE_LANDSCAPE),
      expect(root).toHaveAttr('data-layout', 'Landscape'),
      expect(turnHint).toBeAbsent(),
    )
    scene(
      ROOT,
      given(
        remeasured(onTouch(Phase.Ready()), [PHONE_PORTRAIT, PHONE_LANDSCAPE]),
      ),
      measure(PHONE_PORTRAIT),
      expect(turnHint).toExist(),
    )
  })

  test('is not on the landscape home menu', () => {
    scene(
      ROOT,
      given(onTouch(Phase.Ready())),
      measure(PHONE_LANDSCAPE),
      expect(role('group', { name: 'Play' })).toExist(),
      expect(turnHint).toBeAbsent(),
    )
  })

  test('is not shown mid-run in portrait', () => {
    scene(
      ROOT,
      given(fighting),
      measure(PHONE_PORTRAIT),
      expect(root).toHaveAttr('data-layout', 'Portrait'),
      expect(turnHint).toBeAbsent(),
    )
  })

  test('is not shown on a keyboard and mouse in a tall window', () => {
    scene(
      ROOT,
      given(
        modifyFields(onTouch(Phase.Ready()), {
          lastDevice: () => 'KeyboardMouse',
        }),
      ),
      measure(PHONE_PORTRAIT),
      expect(role('group', { name: 'Play' })).toExist(),
      expect(turnHint).toBeAbsent(),
    )
  })
})

describe('the portrait door preview', () => {
  test('pins the markers of doors out of view to the window edge', () => {
    const breakAtWestWall = inPortrait(
      modifyFields(
        onTouch(
          Phase.Preparation({
            wave: 3,
            remainingMs: 15000,
            durationMs: 20000,
            spawns: Array.flatMap(
              ['North', 'East', 'West', 'South'] as const,
              door => [{ ...DISTANT_SPAWN, atMs: 1000, door }],
            ),
            clock: BreakClock.Counting(),
          }),
        ),
        { player: player => ({ ...player, x: 40, y: 90 }) },
      ),
    )
    const screen = screenOf(breakAtWestWall)
    const rects = rectsOf(
      wavePreviewShapes(breakAtWestWall, screenCameraOf(breakAtWestWall)),
      { x: 0, y: 0 },
    )
    vitestExpect(rects.length).toBeGreaterThan(0)
    Array.forEach(rects, rect => {
      vitestExpect(rect.x).toBeGreaterThanOrEqual(screen.world.x)
      vitestExpect(rect.x + rect.width).toBeLessThanOrEqual(
        screen.world.x + screen.world.width,
      )
    })
  })

  test('points at no door during a wave', () => {
    const waveAtWestWall = inPortrait(
      modifyFields(
        onTouch(
          Phase.Wave({
            wave: 3,
            elapsedMs: 500,
            spawns: Array.flatMap(
              ['North', 'East', 'West', 'South'] as const,
              door => [{ ...DISTANT_SPAWN, atMs: 1000, door }],
            ),
          }),
        ),
        { player: player => ({ ...player, x: 40, y: 90 }) },
      ),
    )
    vitestExpect(
      wavePreviewShapes(waveAtWestWall, screenCameraOf(waveAtWestWall)),
    ).toEqual([])
  })
})
