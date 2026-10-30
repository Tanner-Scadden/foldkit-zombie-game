import { Array, Option, pipe } from 'effect'
import type { Canvas } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Dialog, RadioGroup } from '@foldkit/ui'

import {
  BODIES,
  HAIR_COLORS,
  HAIR_STYLES,
  PLAYER_WIDTH,
  SHIRT_COLORS,
  SHIRT_SHADES,
  SKIN_SHADES,
  SKIN_TONES,
  appearanceKey,
  playerPixels,
  playerSprites,
  randomAppearance,
} from './appearance'
import * as Character from './character'
import { RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import {
  type Appearance,
  type LookPart,
  type Model,
  Phase,
  defaultAppearance,
  initialModel,
} from './model'
import { playerShapes } from './playerView'
import { imageColors } from './testPng'
import { asVeteran } from './veteran'

const onTitle: Model = asVeteran(initialModel)

const PART_MESSAGES: Readonly<
  Record<LookPart, (message: RadioGroup.Message) => Character.Message>
> = {
  Body: message => Character.Message.GotBodyMessage({ message }),
  HairStyle: message => Character.Message.GotHairStyleMessage({ message }),
  HairColor: message => Character.Message.GotHairColorMessage({ message }),
  SkinTone: message => Character.Message.GotSkinToneMessage({ message }),
  ShirtColor: message => Character.Message.GotShirtColorMessage({ message }),
}

const choose = (part: LookPart, index: number, value: string) =>
  message(
    Message.GotCharacterMessage({
      message: PART_MESSAGES[part](
        RadioGroup.Message.SelectedOption({ index, value }),
      ),
    }),
  )

const resolveFocusOption = () =>
  Command.resolve(
    RadioGroup.FocusOption,
    RadioGroup.Message.CompletedFocusOption(),
  )

const rollDice = () =>
  message(
    Message.GotCharacterMessage({
      message: Character.Message.ClickedDiceButton(),
    }),
  )

const PICKED: Appearance = {
  body: 'Female',
  hairStyle: 'Curls',
  hairColor: 'Black',
  skinTone: 'Deep',
  shirtColor: 'Teal',
}

const withLook = (base: Model, appearance: Appearance): Model =>
  modifyFields(base, { appearance: () => appearance })

const fills = (shapes: ReadonlyArray<Canvas.Shape>): ReadonlyArray<string> =>
  Array.flatMap(shapes, shape => {
    if (shape._tag === 'Group') {
      return fills(shape.shapes)
    } else if (shape._tag === 'Rect') {
      return Option.toArray(Option.fromNullishOr(shape.fill))
    } else if (shape._tag === 'Image') {
      return imageColors(shape.src)
    } else {
      return []
    }
  })

const everyLook: ReadonlyArray<Appearance> = Array.flatMap(BODIES, body =>
  Array.flatMap(HAIR_STYLES, hairStyle =>
    Array.flatMap(HAIR_COLORS, hairColor =>
      Array.flatMap(SKIN_TONES, skinTone =>
        Array.map(SHIRT_COLORS, shirtColor => ({
          body,
          hairStyle,
          hairColor,
          skinTone,
          shirtColor,
        })),
      ),
    ),
  ),
)

describe('Character', () => {
  test('starts as the classic look', () => {
    expect(initialModel.appearance).toEqual({
      body: 'Male',
      hairStyle: 'Crop',
      hairColor: 'Brown',
      skinTone: 'Light',
      shirtColor: 'Blue',
    })
  })

  test('picking each part stores it in the appearance', () => {
    story(
      update,
      given(onTitle),
      choose('Body', 0, 'Female'),
      resolveFocusOption(),
      choose('HairStyle', 3, 'Curls'),
      resolveFocusOption(),
      choose('HairColor', 0, 'Black'),
      resolveFocusOption(),
      choose('SkinTone', 5, 'Deep'),
      resolveFocusOption(),
      choose('ShirtColor', 3, 'Teal'),
      resolveFocusOption(),
      model(({ appearance }) => {
        expect(appearance).toEqual(PICKED)
      }),
    )
  })

  test('C opens the Profile on Look on the title and the end screens, never mid-run', () => {
    const pressC = (given_: Model) =>
      story(
        update,
        given(given_),
        message(Message.PressedKey({ code: 'KeyC' })),
        Command.resolve(
          Dialog.ShowDialog,
          Dialog.Message.SucceededShowDialog(),
        ),
        model(({ profile }) => {
          expect(profile.dialog.isOpen).toBe(true)
          expect(profile.tab).toBe('Look')
        }),
      )
    pressC(onTitle)
    pressC(
      modifyFields(onTitle, {
        phase: () => Phase.GameOver({ wave: 3 }),
        screenMs: () => RESTART_GRACE_MS,
      }),
    )

    story(
      update,
      given(
        modifyFields(onTitle, {
          phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
        }),
      ),
      message(Message.PressedKey({ code: 'KeyC' })),
      model(({ profile }) => {
        expect(profile.dialog.isOpen).toBe(false)
      }),
    )
    story(
      update,
      given(
        modifyFields(onTitle, {
          phase: () => Phase.GameOver({ wave: 3 }),
          screenMs: () => 0,
        }),
      ),
      message(Message.ClickedCharacterButton()),
      model(({ profile }) => {
        expect(profile.dialog.isOpen).toBe(false)
      }),
    )
  })

  test('the dice rolls the same look from the same seed and moves the seed on', () => {
    const rollFrom = (seed: number): Model => {
      const holder: { current: Model } = { current: onTitle }
      story(
        update,
        given(modifyFields(onTitle, { cosmeticRngState: () => seed })),
        rollDice(),
        model(rolled => {
          holder.current = rolled
        }),
      )
      return holder.current
    }
    const first = rollFrom(1234)
    const again = rollFrom(1234)
    expect(again.appearance).toEqual(first.appearance)
    expect(again.cosmeticRngState).toBe(first.cosmeticRngState)
    expect(first.cosmeticRngState).not.toBe(1234)
    expect(first.appearance).not.toEqual(defaultAppearance)

    const looks = pipe(
      Array.range(1, 40),
      Array.map(seed => appearanceKey(rollFrom(seed).appearance)),
      Array.dedupe,
    )
    expect(looks.length).toBeGreaterThan(20)
  })

  test('the dice never hands back the look you already have', () => {
    Array.forEach(Array.range(0, 300), seed => {
      const [, firstRoll] = randomAppearance(seed, defaultAppearance)
      const [, reroll] = randomAppearance(seed, firstRoll)
      expect(appearanceKey(reroll)).not.toBe(appearanceKey(firstRoll))
    })
  })

  test('the look lasts through new runs, endless, keep going, and restarts', () => {
    story(
      update,
      given(withLook(onTitle, PICKED)),
      message(Message.ClickedCampaignButton()),
      model(({ phase, appearance }) => {
        expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
        expect(appearance).toEqual(PICKED)
      }),
    )
    story(
      update,
      given(
        modifyFields(withLook(onTitle, PICKED), {
          phase: () => Phase.GameOver({ wave: 4 }),
          screenMs: () => RESTART_GRACE_MS,
        }),
      ),
      message(Message.ClickedEndlessButton()),
      model(({ phase, appearance }) => {
        expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
        expect(appearance).toEqual(PICKED)
      }),
    )
    story(
      update,
      given(
        modifyFields(withLook(onTitle, PICKED), {
          phase: () => Phase.Victory(),
          screenMs: () => RESTART_GRACE_MS,
        }),
      ),
      message(Message.ClickedKeepGoingButton()),
      model(({ appearance }) => {
        expect(appearance).toEqual(PICKED)
      }),
      message(Message.PressedKey({ code: 'Escape' })),
      message(Message.PressedKey({ code: 'Escape' })),
      model(({ appearance }) => {
        expect(appearance).toEqual(PICKED)
      }),
    )
  })

  test('the player sprite wears the chosen skin and shirt', () => {
    const classic = fills(playerShapes(onTitle))
    const picked = fills(playerShapes(withLook(onTitle, PICKED)))
    expect(classic).toContain(SKIN_SHADES.Light.skin)
    expect(classic).toContain(SHIRT_SHADES.Blue.base)
    expect(picked).toContain(SKIN_SHADES.Deep.skin)
    expect(picked).toContain(SHIRT_SHADES.Teal.base)
    expect(picked).not.toContain(SKIN_SHADES.Light.skin)
    expect(picked).not.toContain(SHIRT_SHADES.Blue.base)
  })

  test('the two bodies and every hair style draw differently', () => {
    const pixelsOf = (appearance: Appearance) =>
      JSON.stringify(playerPixels(appearance))
    expect(pixelsOf({ ...defaultAppearance, body: 'Female' })).not.toBe(
      pixelsOf({ ...defaultAppearance, body: 'Male' }),
    )
    const styles = pipe(
      HAIR_STYLES,
      Array.map(hairStyle => pixelsOf({ ...defaultAppearance, hairStyle })),
      Array.dedupe,
    )
    expect(styles.length).toBe(HAIR_STYLES.length)
  })

  test('every look keeps the size and walk cycle of the classic one', () => {
    const shape = (appearance: Appearance) =>
      pipe(playerPixels(appearance), ({ walk, idle }) =>
        Array.map([...walk, ...idle], rows => ({
          height: rows.length,
          widths: pipe(
            rows,
            Array.map(row => row.length),
            Array.dedupe,
          ),
        })),
      )
    const classic = shape(defaultAppearance)
    Array.forEach(everyLook, appearance => {
      expect(shape(appearance)).toEqual(classic)
    })
    Array.forEach(classic, ({ widths }) => {
      expect(widths).toEqual([PLAYER_WIDTH])
    })
  })

  test('sprites are built once per look and reused', () => {
    const first = playerSprites(PICKED)
    expect(playerSprites({ ...PICKED })).toBe(first)
    expect(playerSprites(defaultAppearance)).not.toBe(first)
    expect(
      Option.isSome(
        Array.findFirst(
          fills(first.idle[0].Flash.Right),
          fill => fill !== '#ffffff',
        ),
      ),
    ).toBe(false)
  })
})
