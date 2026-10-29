import { Array, Option, Record, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { playerSprites } from './appearance'
import {
  FEEDBACK_LINE,
  GAME_TITLE,
  MS_PER_SECOND,
  PLAYER_FOOT_OFFSET,
  PLAYER_WALK_FRAME_MS,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  WAVE_BANNER_MS,
  WAVE_CLEARED_BANNER_MS,
} from './constants'
import { DIFFICULTIES, bestsFor } from './difficulty'
import {
  type BakedText,
  GLYPH_HEIGHT,
  type Glyph,
  type TextTone,
  bakeText,
  glyphPixels,
  placeBaked,
  textShapes,
  textWidth,
  toGlyph,
} from './font'
import { clamp } from './geometry'
import {
  Alarm,
  type Appearance,
  DebutCard,
  type Difficulty,
  type HintBand,
  type InputDevice,
  type Model,
  Phase,
  RunMode,
  type RunStats,
  type ZombieKind,
} from './model'
import {
  DEBUT_CARD_MS,
  HINT_TEXT,
  type HintId,
  type ShownHint,
  isDebutCardUp,
  msIntoPhase,
  shownHints,
} from './onboarding'
import { type Screen, landscapeFrameOffset } from './screen'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  ZOMBIE_SPRITES,
  frameAt,
  group,
  gunSprite,
  showcaseWalk,
  spriteShapes,
} from './sprite'
import {
  accuracyPercent,
  defeatVerdict,
  runTimeLabel,
  totalKills,
  victoryVerdict,
} from './stats'
import {
  FINAL_WAVE,
  debutKinds,
  endlessDepth,
  hpScaleFor,
  roundWave,
  waveBonus,
} from './waves'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER } from './zombies'

// SHARED

const CENTER_X = VIEW_WIDTH / 2
const TITLE_SCALE = 2

// NOTE: a backdrop reaches well past the landscape screen, so in portrait,
// where these screens are drawn over the world window, it still dims the
// HUD band and the thumb area. The canvas clips what is past its edges.
const backdrop = (fill: string): Canvas.Shape =>
  Canvas.Rect({
    x: -VIEW_WIDTH,
    y: -VIEW_HEIGHT * 2,
    width: VIEW_WIDTH * 3,
    height: VIEW_HEIGHT * 5,
    fill,
  })

const DIM_BACKDROP = backdrop('rgba(8, 10, 12, 0.72)')
const TITLE_BACKDROP = backdrop('rgba(14, 8, 20, 0.6)')

const centered = (
  baked: BakedText,
  y: number,
  scale = 1,
  opacity?: number,
): Canvas.Shape =>
  placeBaked(baked, { x: CENTER_X, y, align: 'Center', scale, opacity })

export const waveLabel = (mode: RunMode, wave: number): string =>
  RunMode.match(mode, {
    Campaign: () => `WAVE ${wave} / ${FINAL_WAVE}`,
    Endless: () => `WAVE ${wave}`,
  })

const isBlinkOn = (ms: number): boolean => ms % 1000 < 700

// DEVICE PROMPTS

type DeviceText = Readonly<Record<InputDevice, BakedText>>

const deviceText = (
  texts: Readonly<Record<InputDevice, string>>,
  tone: TextTone,
): DeviceText => Record.map(texts, text => bakeText(text, tone))

const RESUME_PROMPT = deviceText(
  {
    KeyboardMouse: 'CLICK OR PRESS ESC TO RESUME',
    Touch: 'TAP TO RESUME',
  },
  'Prompt',
)

// BANDS

const BAND_TOP: Readonly<Record<HintBand, number>> = { Top: 21, Bottom: 84 }
const SUBTITLE_OFFSET = 15
const HINT_OFFSET = 24
const HINT_ROW_PX = 9
const HINT_FADE_MS = 500
const HINT_DELAY_MS = 250
const HINT_BACK_COLOR = 'rgba(8, 10, 12, 0.55)'
const HINT_PAD_X = 3

const HINT_SPRITES: Readonly<Record<HintId, DeviceText>> = Record.map(
  HINT_TEXT,
  texts => deviceText(texts, 'Plain'),
)

const hintOpacity = (ageMs: number): number =>
  clamp((ageMs - HINT_DELAY_MS) / HINT_FADE_MS, 0, 1)

const hintRowShapes =
  (model: Model) =>
  ({ id, ageMs }: ShownHint, index: number): ReadonlyArray<Canvas.Shape> => {
    const opacity = hintOpacity(ageMs)
    if (opacity <= 0) {
      return []
    }

    const baked = HINT_SPRITES[id][model.lastDevice]
    const y = BAND_TOP[model.hintBand] + HINT_OFFSET + index * HINT_ROW_PX
    return [
      group({
        opacity,
        shapes: [
          Canvas.Rect({
            x: Math.round(CENTER_X - baked.width / 2) - HINT_PAD_X,
            y: y - 2,
            width: baked.width + HINT_PAD_X * 2,
            height: HINT_ROW_PX,
            fill: HINT_BACK_COLOR,
          }),
          centered(baked, y),
        ],
      }),
    ]
  }

export const hintShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(shownHints(model), hintRowShapes(model))

// BANNERS

const GET_READY = bakeText('GET READY', 'Title')
const WAVE_CLEARED = bakeText('WAVE CLEARED', 'Victory')
const HERE_THEY_COME = bakeText('HERE THEY COME', 'Prompt')
const DINNER_BELL = bakeText('DINNER BELL!', 'Fresh')

const BAKED_WAVES = FINAL_WAVE * 4

const WAVE_TITLES: ReadonlyArray<BakedText> = Array.makeBy(
  BAKED_WAVES + 1,
  wave => bakeText(`WAVE ${wave}`, 'Defeat'),
)

const CLEARED_SUBTITLES: ReadonlyArray<BakedText> = Array.makeBy(
  BAKED_WAVES + 1,
  wave => bakeText(`+$${waveBonus(wave)} BONUS. THE SHOP IS OPEN`, 'Prompt'),
)

const BEEFIER = bakeText('THEY GOT BEEFIER', 'Fresh')

const healthBoostText = (wave: number): string =>
  `ZOMBIES HAVE +${Math.round((hpScaleFor(wave) - 1) * 100)}% HEALTH`

const HEALTH_BOOSTS: ReadonlyArray<BakedText> = Array.makeBy(
  BAKED_WAVES + 1,
  wave => bakeText(healthBoostText(wave), 'Prompt'),
)

type KindBanner = Readonly<{ title: BakedText; tagline: BakedText }>

const KIND_BANNERS: Readonly<Record<ZombieKind, KindBanner>> = Record.map(
  ZOMBIE_KINDS,
  stats => ({
    title: bakeText(`NEW: ${String.toUpperCase(stats.name)}`, 'Fresh'),
    tagline: bakeText(stats.tagline, 'Prompt'),
  }),
)

const NEW_KIND_BANNER_MS = 3600
const NEW_KIND_ICON_SCALE = 2
const NEW_KIND_ICON_GAP = 10
const NEW_KIND_HOP_MS = 260
const NEW_KIND_ICON_PX = 7
const NEW_KIND_SHIFT = Math.round(
  (NEW_KIND_ICON_GAP + (NEW_KIND_ICON_SCALE * NEW_KIND_ICON_PX) / 2) / 2,
)

const bannerAt = (
  band: HintBand,
  title: BakedText,
  maybeSubtitle: Option.Option<BakedText>,
): ReadonlyArray<Canvas.Shape> => [
  centered(title, BAND_TOP[band], TITLE_SCALE),
  ...Option.match(maybeSubtitle, {
    onNone: () => [],
    onSome: subtitle => [centered(subtitle, BAND_TOP[band] + SUBTITLE_OFFSET)],
  }),
]

const newKindBanner = (
  band: HintBand,
  kind: ZombieKind,
  shownMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const { title, tagline } = KIND_BANNERS[kind]
  const hop =
    shownMs < NEW_KIND_HOP_MS
      ? 1 + 0.5 * Math.sin((Math.PI * shownMs) / NEW_KIND_HOP_MS)
      : 1
  const scale = NEW_KIND_ICON_SCALE * hop
  const titleX = CENTER_X + NEW_KIND_SHIFT
  const titleLeft = Math.round(titleX - (title.width * TITLE_SCALE) / 2)
  return [
    group({
      translate: {
        x: titleLeft - NEW_KIND_ICON_GAP,
        y: BAND_TOP[band] + 5,
      },
      scale: { x: scale, y: scale },
      shapes: ZOMBIE_SPRITES[kind].icon,
    }),
    placeBaked(title, {
      x: titleX,
      y: BAND_TOP[band],
      align: 'Center',
      scale: TITLE_SCALE,
    }),
    centered(tagline, BAND_TOP[band] + SUBTITLE_OFFSET),
  ]
}

const beefierBanner = (
  band: HintBand,
  wave: number,
  shownMs: number,
): ReadonlyArray<Canvas.Shape> =>
  endlessDepth(wave) > 0 && shownMs < NEW_KIND_BANNER_MS
    ? bannerAt(
        band,
        BEEFIER,
        Option.some(
          Option.getOrElse(Array.get(HEALTH_BOOSTS, wave), () =>
            bakeText(healthBoostText(wave), 'Prompt'),
          ),
        ),
      )
    : []

const debutBanner = (
  band: HintBand,
  wave: number,
  shownMs: number,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(Array.head(debutKinds(wave)), {
    onNone: () => beefierBanner(band, wave, shownMs),
    onSome: kind =>
      shownMs < NEW_KIND_BANNER_MS ? newKindBanner(band, kind, shownMs) : [],
  })

const bakedFor = (
  list: ReadonlyArray<BakedText>,
  index: number,
  fallback: () => BakedText,
): BakedText => Option.getOrElse(Array.get(list, index), fallback)

const preparationBanner = (
  model: Model,
  wave: number,
  msIntoPreparation: number,
): ReadonlyArray<Canvas.Shape> => {
  if (wave === 1) {
    return bannerAt(model.hintBand, GET_READY, Option.none())
  } else if (msIntoPreparation < WAVE_CLEARED_BANNER_MS) {
    return bannerAt(
      model.hintBand,
      WAVE_CLEARED,
      Option.some(
        bakedFor(CLEARED_SUBTITLES, wave - 1, () =>
          bakeText(`+$${waveBonus(wave - 1)} BONUS`, 'Prompt'),
        ),
      ),
    )
  } else {
    return debutBanner(
      model.hintBand,
      wave,
      msIntoPreparation - WAVE_CLEARED_BANNER_MS,
    )
  }
}

const alarmBanner = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Alarm.match(model.pacing.alarm, {
    Quiet: () => [],
    Ringing: () => bannerAt(model.hintBand, DINNER_BELL, Option.none()),
  })

const waveBanner = (
  model: Model,
  wave: number,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> =>
  elapsedMs < WAVE_BANNER_MS
    ? bannerAt(
        model.hintBand,
        bakedFor(WAVE_TITLES, wave, () => bakeText(`WAVE ${wave}`, 'Defeat')),
        Option.some(HERE_THEY_COME),
      )
    : alarmBanner(model)

// DEBUT CARD

const CARD_TOP = 40
const CARD_BOTTOM = 136
const CARD_FILL = 'rgba(24, 14, 22, 0.94)'
const CARD_EDGE = '#ff8a3d'
const CARD_BACKDROP = backdrop('rgba(8, 10, 12, 0.4)')
const CARD_HEADING_Y = CARD_TOP + 6
const CARD_FEET_Y = 94
const CARD_SPRITE_HEIGHT = 40
const CARD_STRIDE_MS = 170
const CARD_HOP_MS = 320
const CARD_HOP_PX = 8
const CARD_SHADOW = 'rgba(0, 0, 0, 0.45)'
const CARD_NAME_Y = 100
const CARD_PITCH_Y = 117
const CARD_TIMER_Y = 128
const CARD_TIMER_WIDTH = 96
const CARD_TIMER_BACK = 'rgba(255, 138, 61, 0.25)'
const CARD_SLIDE_IN_MS = 160
const CARD_SLIDE_OUT_MS = 200

const NEW_ZOMBIE = bakeText('NEW ZOMBIE!', 'Fresh')

type CardText = Readonly<{ name: BakedText; pitch: BakedText }>

const CARD_TEXTS: Readonly<Record<ZombieKind, CardText>> = Record.map(
  ZOMBIE_KINDS,
  stats => ({
    name: bakeText(String.toUpperCase(stats.name), 'Title'),
    pitch: bakeText(stats.pitch, 'Plain'),
  }),
)

const cardSpriteScale = (kind: ZombieKind): number =>
  Math.max(2, Math.floor(CARD_SPRITE_HEIGHT / ZOMBIE_SPRITES[kind].height))

const cardHop = (ageMs: number): number =>
  ageMs < CARD_HOP_MS
    ? Math.round(CARD_HOP_PX * Math.sin((Math.PI * ageMs) / CARD_HOP_MS))
    : 0

const easeOut = (progress: number): number => 1 - (1 - progress) ** 3

const cardSlideX = (ageMs: number): number => {
  const leftMs = DEBUT_CARD_MS - ageMs
  if (ageMs < CARD_SLIDE_IN_MS) {
    return Math.round(-VIEW_WIDTH * (1 - easeOut(ageMs / CARD_SLIDE_IN_MS)))
  } else if (leftMs < CARD_SLIDE_OUT_MS) {
    return Math.round(VIEW_WIDTH * easeOut(1 - leftMs / CARD_SLIDE_OUT_MS) ** 2)
  } else {
    return 0
  }
}

const cardTimerShapes = (ageMs: number): ReadonlyArray<Canvas.Shape> => {
  const left = CENTER_X - CARD_TIMER_WIDTH / 2
  const remaining = Math.round(
    CARD_TIMER_WIDTH * clamp(1 - ageMs / DEBUT_CARD_MS, 0, 1),
  )
  return [
    Canvas.Rect({
      x: left,
      y: CARD_TIMER_Y,
      width: CARD_TIMER_WIDTH,
      height: 2,
      fill: CARD_TIMER_BACK,
    }),
    Canvas.Rect({
      x: left,
      y: CARD_TIMER_Y,
      width: remaining,
      height: 2,
      fill: CARD_EDGE,
    }),
  ]
}

const debutCardShapes = (
  kind: ZombieKind,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const { name, pitch } = CARD_TEXTS[kind]
  const scale = cardSpriteScale(kind)
  const stride = Math.floor(ageMs / CARD_STRIDE_MS)
  return [
    CARD_BACKDROP,
    group({
      translate: { x: cardSlideX(ageMs), y: 0 },
      shapes: [
        Canvas.Rect({
          x: 0,
          y: CARD_TOP - 1,
          width: VIEW_WIDTH,
          height: CARD_BOTTOM - CARD_TOP + 2,
          fill: CARD_EDGE,
        }),
        Canvas.Rect({
          x: 0,
          y: CARD_TOP,
          width: VIEW_WIDTH,
          height: CARD_BOTTOM - CARD_TOP,
          fill: CARD_FILL,
        }),
        centered(NEW_ZOMBIE, CARD_HEADING_Y, 1, isBlinkOn(ageMs) ? 1 : 0.6),
        Canvas.Rect({
          x: CENTER_X - 4 * scale,
          y: CARD_FEET_Y - scale,
          width: 8 * scale,
          height: 2 * scale,
          fill: CARD_SHADOW,
        }),
        group({
          translate: { x: CENTER_X, y: CARD_FEET_Y - cardHop(ageMs) },
          scale: { x: scale, y: scale },
          shapes: showcaseWalk(kind, stride, 'Right'),
        }),
        centered(name, CARD_NAME_Y, TITLE_SCALE),
        centered(pitch, CARD_PITCH_Y),
        ...cardTimerShapes(ageMs),
      ],
    }),
  ]
}

const debutCardOverlay = (model: Model): ReadonlyArray<Canvas.Shape> =>
  DebutCard.match(model.debutCard, {
    Hidden: () => [],
    Showing: ({ kind, ageMs }) => debutCardShapes(kind, ageMs),
  })

// LOGO

const LOGO_PIXEL = 4
const LOGO_GAP = 1

type LogoLook = Readonly<{ palette: Palette }>

const LOGO_OUTLINE = 'O'
const LOGO_FILL = 'F'
const LOGO_LIGHT = 'L'
const LOGO_DARK = 'D'
const LOGO_DRIP = 'R'

const MUNCH_LOOK: LogoLook = {
  palette: {
    [LOGO_OUTLINE]: '#140c10',
    [LOGO_FILL]: '#8fdc5a',
    [LOGO_LIGHT]: '#d8f7b0',
    [LOGO_DARK]: '#3f7f2a',
    [LOGO_DRIP]: '#c4232b',
  },
}

const MANOR_LOOK: LogoLook = {
  palette: {
    [LOGO_OUTLINE]: '#140c10',
    [LOGO_FILL]: '#c39be8',
    [LOGO_LIGHT]: '#f0e2ff',
    [LOGO_DARK]: '#6d4a9a',
    [LOGO_DRIP]: '#c4232b',
  },
}

type Grid = ReadonlyArray<ReadonlyArray<boolean>>

const cellAt = (grid: Grid, x: number, y: number): boolean =>
  pipe(
    Array.get(grid, y),
    Option.flatMap(row => Array.get(row, x)),
    Option.getOrElse(() => false),
  )

const gridOf = (pixels: ReadonlyArray<string>): Grid =>
  Array.map(pixels, row =>
    Array.map(String.split(row, ''), symbol => symbol === '#'),
  )

const gridWidth = (grid: Grid): number =>
  Math.max(0, ...Array.map(grid, row => row.length))

const scale2xCell = (grid: Grid, bigX: number, bigY: number): boolean => {
  const x = Math.floor(bigX / 2)
  const y = Math.floor(bigY / 2)
  const center = cellAt(grid, x, y)
  const up = cellAt(grid, x, y - 1)
  const down = cellAt(grid, x, y + 1)
  const left = cellAt(grid, x - 1, y)
  const right = cellAt(grid, x + 1, y)
  const isTop = bigY % 2 === 0
  const isLeft = bigX % 2 === 0
  if (isTop && isLeft) {
    return left === up && up !== right && left !== down ? left : center
  } else if (isTop) {
    return up === right && up !== left && right !== down ? right : center
  } else if (isLeft) {
    return left === down && left !== up && down !== right ? left : center
  } else {
    return down === right && left !== down && up !== right ? right : center
  }
}

const scale2x = (grid: Grid): Grid =>
  Array.makeBy(grid.length * 2, bigY =>
    Array.makeBy(gridWidth(grid) * 2, bigX => scale2xCell(grid, bigX, bigY)),
  )

const dripLength = (seed: number, column: number): number => {
  const roll = (seed * 7 + column * 13) % 11
  return roll < 3 ? 3 + roll * 2 : 0
}

const LOGO_BORDER = 1
const DRIP_ROOM = 9

const logoLetterPixels = (
  glyph: Glyph,
  seed: number,
): ReadonlyArray<string> => {
  const source = gridOf(glyphPixels(glyph))
  const body = scale2x(scale2x(source))
  const bodyWidth = gridWidth(body)
  const bodyHeight = body.length
  const width = bodyWidth + LOGO_BORDER * 2
  const height = bodyHeight + LOGO_BORDER * 2 + DRIP_ROOM
  const isBody = (x: number, y: number): boolean =>
    cellAt(body, x - LOGO_BORDER, y - LOGO_BORDER)
  const isDrip = (x: number, y: number): boolean => {
    const bodyX = x - LOGO_BORDER
    const column = Math.floor(bodyX / LOGO_PIXEL)
    const inset = bodyX - column * LOGO_PIXEL
    const below = y - LOGO_BORDER - bodyHeight
    return (
      bodyX >= 0 &&
      (inset === 1 || inset === 2) &&
      below >= 0 &&
      cellAt(source, column, source.length - 1) &&
      below < dripLength(seed, column)
    )
  }
  const isSolid = (x: number, y: number): boolean =>
    isBody(x, y) || isDrip(x, y)
  const symbolAt = (x: number, y: number): string => {
    if (isBody(x, y)) {
      if (!isBody(x, y - 1)) {
        return LOGO_LIGHT
      } else if (!isBody(x, y + 1) || !isBody(x + 1, y)) {
        return LOGO_DARK
      } else {
        return LOGO_FILL
      }
    } else if (isDrip(x, y)) {
      return LOGO_DRIP
    } else if (
      Array.some([-1, 0, 1], dy =>
        Array.some([-1, 0, 1], dx => isSolid(x + dx, y + dy)),
      )
    ) {
      return LOGO_OUTLINE
    } else {
      return '.'
    }
  }
  return Array.makeBy(height, y =>
    pipe(
      Array.makeBy(width, x => symbolAt(x, y)),
      Array.join(''),
    ),
  )
}

type LogoLetter = Readonly<{ sprite: Sprite; width: number }>

const logoLine = (
  word: string,
  look: LogoLook,
  seed: number,
): ReadonlyArray<LogoLetter> =>
  pipe(
    String.split(word, ''),
    Array.map(toGlyph),
    Array.getSomes,
    Array.map((glyph, index) => {
      const pixels = logoLetterPixels(glyph, seed + index)
      return {
        sprite: spriteShapes(pixels, look.palette, TOP_LEFT),
        width: Math.max(...Array.map(pixels, row => row.length)),
      }
    }),
  )

const TITLE_WORDS: ReadonlyArray<string> = String.split(
  String.toUpperCase(GAME_TITLE),
  ' ',
)

const LOGO_LINES: ReadonlyArray<ReadonlyArray<LogoLetter>> = Array.map(
  TITLE_WORDS,
  (word, index) =>
    logoLine(word, index % 2 === 0 ? MUNCH_LOOK : MANOR_LOOK, index * 5),
)

const LOGO_TOP = 10
const LOGO_LINE_PX = 25
const LOGO_BOB_MS = 260
const LOGO_BOB_PX = 1.6

const lineWidth = (letters: ReadonlyArray<LogoLetter>): number =>
  Array.reduce(letters, 0, (sum, { width }) => sum + width + LOGO_GAP) -
  LOGO_GAP

type LetterRun = Readonly<{ x: number; shapes: ReadonlyArray<Canvas.Shape> }>

const logoLineShapes =
  (screenMs: number) =>
  (
    letters: ReadonlyArray<LogoLetter>,
    lineIndex: number,
  ): ReadonlyArray<Canvas.Shape> => {
    const left = Math.round(CENTER_X - lineWidth(letters) / 2)
    const top = LOGO_TOP + lineIndex * LOGO_LINE_PX
    return Array.reduce(
      letters,
      { x: left, shapes: [] },
      (run: LetterRun, letter, index): LetterRun => {
        const phase = screenMs / LOGO_BOB_MS + (index + lineIndex * 2) * 0.9
        const bob = Math.round(Math.sin(phase) * LOGO_BOB_PX)
        return {
          x: run.x + letter.width + LOGO_GAP,
          shapes: Array.append(
            run.shapes,
            group({
              translate: { x: run.x, y: top + bob },
              shapes: letter.sprite,
            }),
          ),
        }
      },
    ).shapes
  }

const logoShapes = (screenMs: number): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(LOGO_LINES, logoLineShapes(screenMs))

// ALPHA CHIP

const ALPHA = bakeText('ALPHA', 'Plain')
const ALPHA_PAD_X = 3
const ALPHA_PAD_Y = 2
const ALPHA_GAP = 4
const ALPHA_DROP = 9
const ALPHA_FILL = '#c4232b'
const ALPHA_EDGE = '#140c10'

const alphaChipShapes = (): ReadonlyArray<Canvas.Shape> => {
  const lastLine = Option.getOrElse(Array.last(LOGO_LINES), () => [])
  const width = ALPHA.width + ALPHA_PAD_X * 2
  const height = GLYPH_HEIGHT + ALPHA_PAD_Y * 2
  const left = Math.round(CENTER_X + lineWidth(lastLine) / 2 + ALPHA_GAP)
  const top = LOGO_TOP + (LOGO_LINES.length - 1) * LOGO_LINE_PX + ALPHA_DROP
  return [
    Canvas.Rect({
      x: left - 1,
      y: top - 1,
      width: width + 2,
      height: height + 2,
      fill: ALPHA_EDGE,
    }),
    Canvas.Rect({ x: left, y: top, width, height, fill: ALPHA_FILL }),
    placeBaked(ALPHA, {
      x: left + ALPHA_PAD_X,
      y: top + ALPHA_PAD_Y,
      align: 'Left',
    }),
  ]
}

const ALPHA_CHIP: ReadonlyArray<Canvas.Shape> = alphaChipShapes()

// PARADE

type Marcher = Readonly<{
  kind: ZombieKind
  y: number
  speed: number
  offset: number
  direction: 1 | -1
}>

const PARADE: ReadonlyArray<Marcher> = [
  { kind: 'Shambler', y: 166, speed: 16, offset: 0, direction: 1 },
  { kind: 'Shambler', y: 168, speed: 16, offset: 22, direction: 1 },
  { kind: 'Runner', y: 167, speed: 30, offset: 90, direction: 1 },
  { kind: 'Tank', y: 157, speed: 9, offset: 40, direction: -1 },
  { kind: 'Exploder', y: 160, speed: 18, offset: 200, direction: -1 },
  { kind: 'Shambler', y: 158, speed: 14, offset: 150, direction: -1 },
]

const PARADE_MARGIN = 24
const PARADE_SPAN = VIEW_WIDTH + PARADE_MARGIN * 2
const PARADE_SHADOW = 'rgba(0, 0, 0, 0.35)'

const marcherShapes =
  (screenMs: number) =>
  (marcher: Marcher): ReadonlyArray<Canvas.Shape> => {
    const travelled =
      marcher.offset + (marcher.speed * screenMs) / MS_PER_SECOND
    const along = (travelled % PARADE_SPAN) - PARADE_MARGIN
    const x = Math.round(marcher.direction === 1 ? along : VIEW_WIDTH - along)
    const stats = ZOMBIE_KINDS[marcher.kind]
    const stride = Math.floor(travelled / stats.stridePx)
    const facing = marcher.direction === 1 ? 'Right' : 'Left'
    return [
      Canvas.Rect({
        x: x - 4,
        y: marcher.y,
        width: 8,
        height: 2,
        fill: PARADE_SHADOW,
      }),
      group({
        translate: { x, y: marcher.y + 1 },
        shapes: showcaseWalk(marcher.kind, stride, facing),
      }),
    ]
  }

const paradeShapes = (screenMs: number): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(PARADE, marcherShapes(screenMs))

// READY

const TAGLINE = bakeText('SURVIVE 8 WAVES. TRY NOT TO GET EATEN.', 'Hint')
const TAGLINE_Y = 70

// NOTE: the player walks on the spot at center stage, twice the room's size,
// facing the Groaners that come in from the left with the pistol up. The home
// menu puts a button over them that opens the character picker.
export const HERO_X = 160
export const HERO_FEET_Y = 150
const HERO_SCALE = 2
const HERO_GUN_PX = 2

const runnerShapes = (
  appearance: Appearance,
  screenMs: number,
): ReadonlyArray<Canvas.Shape> => [
  Canvas.Rect({
    x: HERO_X - 3 * HERO_SCALE,
    y: HERO_FEET_Y - HERO_SCALE,
    width: 7 * HERO_SCALE,
    height: 2 * HERO_SCALE,
    fill: PARADE_SHADOW,
  }),
  group({
    translate: { x: HERO_X, y: HERO_FEET_Y },
    scale: { x: HERO_SCALE, y: HERO_SCALE },
    shapes: [
      ...frameAt(
        playerSprites(appearance).walk,
        Math.floor(screenMs / PLAYER_WALK_FRAME_MS),
      ).Normal.Left,
      group({
        translate: { x: -HERO_GUN_PX, y: -PLAYER_FOOT_OFFSET },
        shapes: gunSprite('Pistol', 0, Math.PI),
      }),
    ],
  }),
]

const readyShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  TITLE_BACKDROP,
  ...paradeShapes(model.screenMs),
  ...runnerShapes(model.appearance, model.screenMs),
  ...logoShapes(model.screenMs),
  ...ALPHA_CHIP,
  centered(TAGLINE, TAGLINE_Y),
]

// PAUSED

const PAUSED = bakeText('PAUSED', 'Title')
const PAUSED_Y = 9
const PAUSED_WAVE_Y = 28
const RESUME_Y = 164

const pausedShapes = (
  model: Model,
  wave: number,
  resumeY: number,
): ReadonlyArray<Canvas.Shape> => [
  DIM_BACKDROP,
  centered(PAUSED, PAUSED_Y, TITLE_SCALE),
  ...textShapes(
    waveLabel(model.mode, wave),
    'Plain',
    CENTER_X,
    PAUSED_WAVE_Y,
    'Center',
  ),
  centered(RESUME_PROMPT[model.lastDevice], resumeY),
]

// RUN STATS

const GAME_OVER = bakeText('GAME OVER', 'Defeat')
const YOU_SURVIVED = bakeText('YOU SURVIVED!', 'Victory')

const PANEL_LEFT = 76
const PANEL_RIGHT = VIEW_WIDTH - PANEL_LEFT
const PANEL_TOP = 37
const PANEL_ROW_PX = 8
const PANEL_PAD = 5
const PANEL_FILL = 'rgba(24, 14, 22, 0.92)'
const PANEL_EDGE = '#5a3a4a'

type StatRow = Readonly<{ label: BakedText; value: string; tone: TextTone }>

const DIFFICULTY_TONES: Readonly<Record<Difficulty, TextTone>> = {
  Easy: 'Plain',
  Normal: 'Plain',
  Hard: 'Alert',
  Nightmare: 'Defeat',
}

const STAT_LABELS = {
  difficulty: bakeText('DIFFICULTY', 'Hint'),
  waves: bakeText('WAVES CLEARED', 'Hint'),
  reached: bakeText('WAVE REACHED', 'Hint'),
  best: bakeText('BEST THIS SESSION', 'Hint'),
  kills: bakeText('ZOMBIES SPLATTED', 'Hint'),
  time: bakeText('RUN TIME', 'Hint'),
  accuracy: bakeText('ACCURACY', 'Hint'),
  money: bakeText('MONEY EARNED', 'Hint'),
  hearts: bakeText('HEARTS LOST', 'Hint'),
  traps: bakeText('TRAPS PLACED', 'Hint'),
  score: bakeText('SCORE', 'Hint'),
}

const waveRows = (model: Model): ReadonlyArray<StatRow> =>
  RunMode.match(model.mode, {
    Campaign: (): ReadonlyArray<StatRow> => [
      {
        label: STAT_LABELS.waves,
        value: `${model.stats.wavesCleared} / ${FINAL_WAVE}`,
        tone: 'Plain',
      },
    ],
    Endless: (): ReadonlyArray<StatRow> => [
      {
        label: STAT_LABELS.reached,
        value: `${roundWave(model.phase)}`,
        tone: 'Plain',
      },
      {
        label: STAT_LABELS.best,
        value: Option.match(bestsFor(model).maybeBestEndlessWave, {
          onNone: () => '--',
          onSome: best => `WAVE ${best}`,
        }),
        tone: 'Victory',
      },
    ],
  })

const statRows = (model: Model): ReadonlyArray<StatRow> => {
  const { stats } = model
  return [
    {
      label: STAT_LABELS.difficulty,
      value: String.toUpperCase(DIFFICULTIES[model.difficulty.chosen].name),
      tone: DIFFICULTY_TONES[model.difficulty.chosen],
    },
    ...waveRows(model),
    {
      label: STAT_LABELS.kills,
      value: `${totalKills(stats)}`,
      tone: 'Plain',
    },
    { label: STAT_LABELS.time, value: runTimeLabel(stats), tone: 'Plain' },
    {
      label: STAT_LABELS.accuracy,
      value: `${accuracyPercent(stats)}%`,
      tone: 'Plain',
    },
    {
      label: STAT_LABELS.money,
      value: `$${model.wallet.earned}`,
      tone: 'Coin',
    },
    {
      label: STAT_LABELS.hearts,
      value: `${stats.heartsLost}`,
      tone: stats.heartsLost > 0 ? 'Alert' : 'Plain',
    },
    {
      label: STAT_LABELS.traps,
      value: `${stats.trapsPlaced}`,
      tone: 'Plain',
    },
    { label: STAT_LABELS.score, value: `${model.score}`, tone: 'Victory' },
  ]
}

const statRowShapes = (
  { label, value, tone }: StatRow,
  index: number,
): ReadonlyArray<Canvas.Shape> => {
  const y = PANEL_TOP + PANEL_PAD + index * PANEL_ROW_PX
  return [
    placeBaked(label, { x: PANEL_LEFT + PANEL_PAD, y, align: 'Left' }),
    ...textShapes(value, tone, PANEL_RIGHT - PANEL_PAD, y, 'Right'),
  ]
}

const KILL_SLOT_PX = 28
const KILL_ICON_PX = 7
const KILL_ICON_GAP = 2

const killShapes = (
  stats: RunStats,
  y: number,
): ReadonlyArray<Canvas.Shape> => {
  const left = Math.round(
    CENTER_X - (ZOMBIE_KIND_ORDER.length * KILL_SLOT_PX) / 2,
  )
  return Array.flatMap(ZOMBIE_KIND_ORDER, (kind, index) => {
    const count = `x${stats.kills[kind]}`
    const slotCenter = left + index * KILL_SLOT_PX + KILL_SLOT_PX / 2
    const x = Math.round(
      slotCenter - (KILL_ICON_PX + KILL_ICON_GAP + textWidth(count)) / 2,
    )
    return [
      group({
        translate: { x: x + KILL_ICON_PX / 2, y: y + 3 },
        shapes: ZOMBIE_SPRITES[kind].icon,
      }),
      ...textShapes(count, 'Kill', x + KILL_ICON_PX + KILL_ICON_GAP, y, 'Left'),
    ]
  })
}

const panelBottom = (model: Model): number =>
  PANEL_TOP + PANEL_PAD * 2 + (statRows(model).length + 1) * PANEL_ROW_PX + 1

const panelShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const rows = statRows(model)
  const killsY = PANEL_TOP + PANEL_PAD + rows.length * PANEL_ROW_PX + 3
  const bottom = panelBottom(model)
  return [
    Canvas.Rect({
      x: PANEL_LEFT - 1,
      y: PANEL_TOP - 1,
      width: PANEL_RIGHT - PANEL_LEFT + 2,
      height: bottom - PANEL_TOP + 2,
      fill: PANEL_EDGE,
    }),
    Canvas.Rect({
      x: PANEL_LEFT,
      y: PANEL_TOP,
      width: PANEL_RIGHT - PANEL_LEFT,
      height: bottom - PANEL_TOP,
      fill: PANEL_FILL,
    }),
    ...Array.flatMap(rows, statRowShapes),
    Canvas.Rect({
      x: PANEL_LEFT + PANEL_PAD,
      y: killsY - 3,
      width: PANEL_RIGHT - PANEL_LEFT - PANEL_PAD * 2,
      height: 1,
      fill: PANEL_EDGE,
    }),
    ...killShapes(model.stats, killsY),
  ]
}

const VERDICT_Y = 27
const FEEDBACK = bakeText(String.toUpperCase(FEEDBACK_LINE), 'Hint')
const FEEDBACK_GAP = 5
const UNLOCK_BLINK_MS = 400
const NIGHTMARE_UNLOCKED = bakeText(
  'NIGHTMARE UNLOCKED! PICK IT IN SETTINGS',
  'Victory',
)
const NIGHTMARE_UNLOCKED_DIM = bakeText(
  'NIGHTMARE UNLOCKED! PICK IT IN SETTINGS',
  'Alert',
)

const endShapes = (
  model: Model,
  title: BakedText,
  verdict: string,
): ReadonlyArray<Canvas.Shape> => [
  DIM_BACKDROP,
  centered(title, 10, TITLE_SCALE),
  ...textShapes(
    String.toUpperCase(verdict),
    'Prompt',
    CENTER_X,
    VERDICT_Y,
    'Center',
  ),
  ...panelShapes(model),
  model.difficulty.nightmare === 'JustUnlocked' &&
  Math.floor(model.screenMs / UNLOCK_BLINK_MS) % 2 === 0
    ? centered(NIGHTMARE_UNLOCKED, panelBottom(model) + FEEDBACK_GAP)
    : model.difficulty.nightmare === 'JustUnlocked'
      ? centered(NIGHTMARE_UNLOCKED_DIM, panelBottom(model) + FEEDBACK_GAP)
      : centered(FEEDBACK, panelBottom(model) + FEEDBACK_GAP),
]

// OVERLAY

const PORTRAIT_RESUME_LIFT = 34

// NOTE: in portrait the pause panel fills the world window, so the resume
// prompt drops to the thumb area, just above the gun slots.
const resumeYFor = (screen: Screen): number =>
  screen.layout === 'Landscape'
    ? RESUME_Y
    : screen.height - landscapeFrameOffset(screen).y - PORTRAIT_RESUME_LIFT

export const overlayShapes = (
  model: Model,
  screen: Screen,
): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => readyShapes(model),
    Preparation: ({ wave }) => [
      ...preparationBanner(model, wave, msIntoPhase(model.phase)),
      ...hintShapes(model),
    ],
    Wave: ({ wave, elapsedMs }) =>
      isDebutCardUp(model)
        ? debutCardOverlay(model)
        : [...waveBanner(model, wave, elapsedMs), ...hintShapes(model)],
    Paused: ({ round }) => pausedShapes(model, round.wave, resumeYFor(screen)),
    Victory: () => endShapes(model, YOU_SURVIVED, victoryVerdict(model.stats)),
    GameOver: ({ wave }) =>
      endShapes(model, GAME_OVER, defeatVerdict(wave, model.stats)),
  })
