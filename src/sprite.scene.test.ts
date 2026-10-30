import { Array, Option, Record, pipe } from 'effect'
import { Canvas } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { given, scene } from 'foldkit/scene'
import { afterEach, describe, expect, test } from 'vitest'

import { playerSprites } from './appearance'
import { COIN_SPRITE, GLYPH_SPRITES } from './font'
import type { Message } from './message'
import { defaultAppearance } from './model'
import {
  BARRICADE_SPRITES,
  PICKUP_SPRITES,
  type Palette,
  ZOMBIE_SPRITES,
  bakeShapes,
  placeAt,
  spriteDataUrl,
  spriteShapes,
} from './sprite'
import { standInKeyOf, useSpriteAtlas, useSpriteMode } from './spriteAtlas'
import { decodePng, hexOf } from './testPng'

// PIXEL MAPS

const PALETTE: Palette = { R: '#e8333a', W: '#ff8a8f', K: '#2a1418' }

const PIXELS: ReadonlyArray<string> = [
  '.KKK.',
  'KRWRK',
  'KRRRK',
  '.KRK.',
  '..K..',
  '.....',
]

const colorAt = (x: number, y: number): Option.Option<string> =>
  pipe(
    Array.get(PIXELS, y),
    Option.flatMap(row => Option.fromNullishOr(row[x])),
    Option.flatMap(symbol => Option.fromNullishOr(PALETTE[symbol])),
  )

const imagesIn = (
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Image> =>
  Array.flatMap(shapes, shape => {
    if (shape._tag === 'Image') {
      return [shape]
    } else if (shape._tag === 'Group') {
      return imagesIn(shape.shapes)
    } else {
      return []
    }
  })

const onlyImage = (shapes: ReadonlyArray<Canvas.Shape>): Canvas.Image => {
  expect(shapes.length).toBe(1)
  return Option.getOrThrow(Array.head(imagesIn(shapes)))
}

describe('sprite images', () => {
  test('a pixel map becomes the same PNG every time', () => {
    const first = spriteDataUrl(PIXELS, PALETTE)
    const second = spriteDataUrl([...PIXELS], { ...PALETTE })
    expect(Option.isSome(first)).toBe(true)
    expect(first).toEqual(second)
    expect(Option.getOrThrow(first).startsWith('data:image/png;base64,')).toBe(
      true,
    )
  })

  test('the PNG is the size of the pixel map and holds its exact colors', () => {
    const decoded = Option.getOrThrow(
      Option.flatMap(spriteDataUrl(PIXELS, PALETTE), decodePng),
    )
    expect(decoded.width).toBe(5)
    expect(decoded.height).toBe(PIXELS.length)
    Array.forEach(decoded.pixels, (pixel, index) => {
      const x = index % decoded.width
      const y = Math.floor(index / decoded.width)
      Option.match(colorAt(x, y), {
        onNone: () => expect(pixel.a).toBe(0),
        onSome: color => {
          expect(pixel.a).toBe(255)
          expect(hexOf(pixel)).toBe(color)
        },
      })
    })
  })

  test('a sprite is one pixelated image placed by its anchor', () => {
    const image = onlyImage(spriteShapes(PIXELS, PALETTE, { x: 2, y: 6 }))
    expect(image).toMatchObject({
      x: -2,
      y: -6,
      width: 5,
      height: PIXELS.length,
      rendering: 'Pixelated',
    })
  })

  test('an empty pixel map draws nothing', () => {
    expect(spriteShapes(['...', '...'], PALETTE)).toEqual([])
  })

  test('every zombie frame, facing, tone, frenzy look, and wear stage is one image', () => {
    const sprites = Array.flatMap(Record.values(ZOMBIE_SPRITES), kind =>
      Array.flatMap(kind.stages, stage =>
        Array.flatMap(
          [
            ...stage.walk,
            ...stage.lit,
            ...stage.rage,
            stage.gape,
            stage.litGape,
            stage.rageGape,
          ],
          set =>
            Array.flatMap(Record.values(set), facings =>
              Record.values(facings),
            ),
        ),
      ),
    )
    expect(sprites.length).toBeGreaterThan(100)
    Array.forEach(sprites, sprite => {
      expect(onlyImage(sprite).rendering).toBe('Pixelated')
    })
  })

  test('the player, glyphs, pickups, barricades, and coin are images', () => {
    const player = playerSprites(defaultAppearance)
    const sprites = [
      ...Array.flatMap([...player.walk, ...player.idle], set =>
        Array.flatMap(Record.values(set), facings => Record.values(facings)),
      ),
      ...Array.flatMap(Record.values(GLYPH_SPRITES), Record.values),
      ...Record.values(PICKUP_SPRITES),
      ...Array.flatMap(Record.values(BARRICADE_SPRITES), stages =>
        Array.flatMap(Record.values(stages), Record.values),
      ),
      COIN_SPRITE,
    ]
    Array.forEach(sprites, sprite => {
      onlyImage(sprite)
    })
  })

  test('baking rectangles paints them in order into one image', () => {
    const baked = onlyImage(
      bakeShapes([
        Canvas.Rect({ x: 2, y: 3, width: 3, height: 2, fill: '#000000' }),
        Canvas.Rect({ x: 3, y: 3, width: 1, height: 1, fill: '#ffffff' }),
      ]),
    )
    expect(baked).toMatchObject({ x: 2, y: 3, width: 3, height: 2 })
    const decoded = Option.getOrThrow(decodePng(baked.src))
    expect(Array.map(decoded.pixels, hexOf)).toEqual([
      '#000000',
      '#ffffff',
      '#000000',
      '#000000',
      '#000000',
      '#000000',
    ])
  })

  test('shapes that are not whole pixel rectangles stay as they are', () => {
    const circle = [Canvas.Circle({ x: 3, y: 3, radius: 2, fill: '#000' })]
    expect(bakeShapes(circle)).toBe(circle)
  })

  test('placing a one image sprite moves the image instead of grouping it', () => {
    const sprite = spriteShapes(PIXELS, PALETTE, { x: 0, y: 0 })
    expect(placeAt(10, 20, sprite)).toMatchObject({
      _tag: 'Image',
      x: 10,
      y: 20,
    })
  })
})

// PREBUILT SPRITES

const keyOf = (shapes: ReadonlyArray<Canvas.Shape>): string =>
  Option.getOrThrow(standInKeyOf(onlyImage(shapes).src))

const ATLAS_FILE = 'sprites.png'

describe('prebuilt sprites', () => {
  afterEach(() => {
    useSpriteAtlas({ sources: [], entries: {} })
    useSpriteMode('StandIn')
  })

  test('a stand-in holds the same pixels as the encoded PNG', () => {
    const standIn = onlyImage(spriteShapes(PIXELS, PALETTE))
    expect(standInKeyOf(standIn.src)).toEqual(Option.some(keyOf([standIn])))
    expect(decodePng(standIn.src)).toEqual(
      Option.flatMap(spriteDataUrl(PIXELS, PALETTE), decodePng),
    )
  })

  test('the same pixel map and colors always get the same key', () => {
    expect(keyOf(spriteShapes([...PIXELS], { ...PALETTE }))).toBe(
      keyOf(spriteShapes(PIXELS, PALETTE)),
    )
    expect(keyOf(spriteShapes(PIXELS, { ...PALETTE, R: '#000000' }))).not.toBe(
      keyOf(spriteShapes(PIXELS, PALETTE)),
    )
  })

  test('a sprite in the atlas is a cropped region of its file, placed by its anchor', () => {
    const key = keyOf(spriteShapes(PIXELS, PALETTE))
    useSpriteAtlas({
      sources: [ATLAS_FILE],
      entries: { [key]: [0, 7, 9, 5, 6] },
    })
    expect(onlyImage(spriteShapes(PIXELS, PALETTE, { x: 2, y: 6 }))).toEqual(
      Canvas.Image({
        src: ATLAS_FILE,
        x: -2,
        y: -6,
        width: 5,
        height: 6,
        crop: { x: 7, y: 9, width: 5, height: 6 },
        rendering: 'Pixelated',
      }),
    )
  })

  test('a sprite the atlas marks empty draws nothing', () => {
    const key = keyOf(spriteShapes(PIXELS, PALETTE))
    useSpriteAtlas({ sources: [ATLAS_FILE], entries: { [key]: null } })
    expect(spriteShapes(PIXELS, PALETTE)).toEqual([])
  })

  test('baked rectangles in the atlas are found by their content, wherever they stand', () => {
    const rects = (x: number) => [
      Canvas.Rect({ x, y: 3, width: 3, height: 2, fill: '#000000' }),
      Canvas.Rect({ x: x + 1, y: 3, width: 1, height: 1, fill: '#ffffff' }),
    ]
    const key = keyOf(bakeShapes(rects(2)))
    expect(keyOf(bakeShapes(rects(40)))).toBe(key)
    useSpriteAtlas({
      sources: [ATLAS_FILE],
      entries: { [key]: [0, 1, 1, 3, 2] },
    })
    expect(onlyImage(bakeShapes(rects(40)))).toMatchObject({
      src: ATLAS_FILE,
      x: 40,
      y: 3,
      crop: { x: 1, y: 1, width: 3, height: 2 },
    })
  })

  test('a sprite the atlas lacks is encoded as a PNG outside the tests', () => {
    useSpriteMode('Encode')
    expect(onlyImage(spriteShapes(PIXELS, PALETTE)).src).toBe(
      Option.getOrThrow(spriteDataUrl(PIXELS, PALETTE)),
    )
  })
})

// PAINTER

type DrawCall = ReadonlyArray<unknown>

const recordingContext = (
  draws: Array<DrawCall>,
  smoothing: Array<boolean>,
) => {
  const ignore = () => undefined
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    set imageSmoothingEnabled(isOn: boolean) {
      smoothing.push(isOn)
    },
    save: ignore,
    restore: ignore,
    clearRect: ignore,
    fillRect: ignore,
    translate: ignore,
    scale: ignore,
    rotate: ignore,
    drawImage: (...args: DrawCall) => {
      draws.push(args)
    },
  }
}

const paintWithFoldkit = (
  shapes: ReadonlyArray<Canvas.Shape>,
): Readonly<{ draws: ReadonlyArray<DrawCall>; smoothing: Array<boolean> }> => {
  const rendered: Array<Html> = []
  const canvasView = (_model: number, h: HtmlBuilder<Message>): Html => {
    const node = Canvas.view({ width: 40, height: 40, shapes }, h)
    rendered.push(node)
    return node
  }
  scene({ update: (model: number) => ({ model }), view: canvasView }, given(0))
  const draws: Array<DrawCall> = []
  const smoothing: Array<boolean> = []
  const element = document.createElement('canvas')
  Object.defineProperty(element, 'getContext', {
    value: () => recordingContext(draws, smoothing),
  })
  Option.map(Array.last(rendered), node => {
    if (node !== null) {
      node.data?.hook?.insert?.({ ...node, elm: element })
    }
  })
  return { draws, smoothing }
}

describe('the patched Foldkit painter', () => {
  const src = Option.getOrThrow(spriteDataUrl(PIXELS, PALETTE))

  test('Canvas.Image exists in the installed Foldkit', () => {
    expect(Canvas.Image({ src, x: 0, y: 0, width: 5, height: 6 })).toEqual({
      _tag: 'Image',
      src,
      x: 0,
      y: 0,
      width: 5,
      height: 6,
    })
  })

  test('draws an image with one drawImage into its box, unsmoothed', () => {
    const { draws, smoothing } = paintWithFoldkit([
      Canvas.Image({
        src,
        x: 4,
        y: 7,
        width: 5,
        height: 6,
        rendering: 'Pixelated',
      }),
    ])
    expect(draws.length).toBe(1)
    expect(Array.get(draws[0] ?? [], 0).pipe(Option.getOrNull)).toBeInstanceOf(
      HTMLImageElement,
    )
    expect(Array.drop(draws[0] ?? [], 1)).toEqual([4, 7, 5, 6])
    expect(smoothing).toEqual([false])
  })

  test('draws a cropped region of the source', () => {
    const { draws } = paintWithFoldkit([
      Canvas.Image({
        src,
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        crop: { x: 1, y: 1, width: 2, height: 2 },
      }),
    ])
    expect(Array.drop(draws[0] ?? [], 1)).toEqual([1, 1, 2, 2, 0, 0, 2, 2])
  })
})
