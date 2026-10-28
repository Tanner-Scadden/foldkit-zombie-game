import { Array, Option, Record, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  GAME_TITLE,
  MS_PER_SECOND,
  RESTART_GRACE_MS,
  WAVE_BANNER_MS,
  WAVE_CLEARED_BANNER_MS,
} from './constants'
import {
  type BakedText,
  type Glyph,
  type TextTone,
  bakeText,
  glyphPixels,
  placeBaked,
  textShapes,
  toGlyph,
} from './font'
import { clamp } from './geometry'
import {
  type HintBand,
  type InputDevice,
  type Model,
  Phase,
  type RunStats,
  type ZombieKind,
} from './model'
import {
  HINT_TEXT,
  type HintId,
  type ShownHint,
  shownHints,
} from './onboarding'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  ZOMBIE_SPRITES,
  frameAt,
  group,
  spriteShapes,
} from './sprite'
import {
  accuracyPercent,
  defeatVerdict,
  runTimeLabel,
  totalKills,
  victoryVerdict,
} from './stats'
import { FINAL_WAVE, debutKinds, waveBonus } from './waves'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER } from './zombies'

// SHARED

const CENTER_X = ARENA_WIDTH / 2
const TITLE_SCALE = 2

const backdrop = (fill: string): Canvas.Shape =>
  Canvas.Rect({ x: 0, y: 0, width: ARENA_WIDTH, height: ARENA_HEIGHT, fill })

const DIM_BACKDROP = backdrop('rgba(8, 10, 12, 0.72)')
const TITLE_BACKDROP = backdrop('rgba(14, 8, 20, 0.6)')

const centered = (
  baked: BakedText,
  y: number,
  scale = 1,
  opacity?: number,
): Canvas.Shape =>
  placeBaked(baked, { x: CENTER_X, y, align: 'Center', scale, opacity })

export const waveLabel = (wave: number): string =>
  `WAVE ${wave} / ${FINAL_WAVE}`

const isBlinkOn = (ms: number): boolean => ms % 1000 < 700

// DEVICE PROMPTS

type DeviceText = Readonly<Record<InputDevice, BakedText>>

const deviceText = (
  texts: Readonly<Record<InputDevice, string>>,
  tone: TextTone,
): DeviceText => Record.map(texts, text => bakeText(text, tone))

const START_PROMPT = deviceText(
  { KeyboardMouse: 'CLICK OR PRESS ENTER', Touch: 'TAP TO START' },
  'Prompt',
)

const RESUME_PROMPT = deviceText(
  {
    KeyboardMouse: 'CLICK OR PRESS ENTER TO RESUME',
    Touch: 'TAP TO RESUME',
  },
  'Prompt',
)

const AGAIN_PROMPT = deviceText(
  {
    KeyboardMouse: 'CLICK OR PRESS ENTER TO PLAY AGAIN',
    Touch: 'TAP TO PLAY AGAIN',
  },
  'Prompt',
)

// BANDS

const BAND_TOP: Readonly<Record<HintBand, number>> = { Top: 21, Bottom: 100 }
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

const WAVE_TITLES: ReadonlyArray<BakedText> = Array.makeBy(
  FINAL_WAVE + 1,
  wave => bakeText(`WAVE ${wave}`, 'Defeat'),
)

const CLEARED_SUBTITLES: ReadonlyArray<BakedText> = Array.makeBy(
  FINAL_WAVE + 1,
  wave => bakeText(`+$${waveBonus(wave)} BONUS. THE $ STALL IS OPEN`, 'Prompt'),
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
  const titleLeft = Math.round(CENTER_X - (title.width * TITLE_SCALE) / 2)
  return [
    group({
      translate: {
        x: titleLeft - NEW_KIND_ICON_GAP,
        y: BAND_TOP[band] + 5,
      },
      scale: { x: scale, y: scale },
      shapes: ZOMBIE_SPRITES[kind].icon,
    }),
    ...bannerAt(band, title, Option.some(tagline)),
  ]
}

const debutBanner = (
  band: HintBand,
  wave: number,
  shownMs: number,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(Array.head(debutKinds(wave)), {
    onNone: () => [],
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
    : []

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
  { kind: 'Tank', y: 146, speed: 9, offset: 40, direction: -1 },
  { kind: 'Exploder', y: 150, speed: 18, offset: 200, direction: -1 },
  { kind: 'Shambler', y: 148, speed: 14, offset: 150, direction: -1 },
]

const PARADE_MARGIN = 24
const PARADE_SPAN = ARENA_WIDTH + PARADE_MARGIN * 2
const PARADE_SHADOW = 'rgba(0, 0, 0, 0.35)'

const marcherShapes =
  (screenMs: number) =>
  (marcher: Marcher): ReadonlyArray<Canvas.Shape> => {
    const travelled =
      marcher.offset + (marcher.speed * screenMs) / MS_PER_SECOND
    const along = (travelled % PARADE_SPAN) - PARADE_MARGIN
    const x = Math.round(marcher.direction === 1 ? along : ARENA_WIDTH - along)
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
        shapes: frameAt(ZOMBIE_SPRITES[marcher.kind].walk, stride).Normal[
          facing
        ],
      }),
    ]
  }

const paradeShapes = (screenMs: number): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(PARADE, marcherShapes(screenMs))

// READY

const TAGLINE = bakeText(
  'ONE HOUSE. EIGHT WAVES. WAY TOO MANY ZOMBIES.',
  'Hint',
)
const TAGLINE_Y = 72
const START_PROMPT_Y = 100

const readyShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  TITLE_BACKDROP,
  ...paradeShapes(model.screenMs),
  ...logoShapes(model.screenMs),
  centered(TAGLINE, TAGLINE_Y),
  ...(isBlinkOn(model.screenMs)
    ? [centered(START_PROMPT[model.lastDevice], START_PROMPT_Y, TITLE_SCALE)]
    : []),
]

// PAUSED

const PAUSED = bakeText('PAUSED', 'Title')

const pausedShapes = (
  model: Model,
  wave: number,
): ReadonlyArray<Canvas.Shape> => [
  DIM_BACKDROP,
  centered(PAUSED, 56, TITLE_SCALE),
  ...textShapes(waveLabel(wave), 'Plain', CENTER_X, 78, 'Center'),
  centered(RESUME_PROMPT[model.lastDevice], 96),
]

// RUN STATS

const GAME_OVER = bakeText('GAME OVER', 'Defeat')
const YOU_SURVIVED = bakeText('YOU SURVIVED!', 'Victory')

const PANEL_LEFT = 76
const PANEL_RIGHT = ARENA_WIDTH - PANEL_LEFT
const PANEL_TOP = 40
const PANEL_ROW_PX = 9
const PANEL_PAD = 6
const PANEL_FILL = 'rgba(24, 14, 22, 0.92)'
const PANEL_EDGE = '#5a3a4a'
const PROMPT_Y = 156

type StatRow = Readonly<{ label: BakedText; value: string; tone: TextTone }>

const STAT_LABELS = {
  waves: bakeText('WAVES CLEARED', 'Hint'),
  kills: bakeText('ZOMBIES MUNCHED BACK', 'Hint'),
  time: bakeText('RUN TIME', 'Hint'),
  accuracy: bakeText('ACCURACY', 'Hint'),
  money: bakeText('MONEY EARNED', 'Hint'),
  hearts: bakeText('HEARTS LOST', 'Hint'),
  traps: bakeText('TRAPS PLACED', 'Hint'),
  score: bakeText('SCORE', 'Hint'),
}

const statRows = (model: Model): ReadonlyArray<StatRow> => {
  const { stats } = model
  return [
    {
      label: STAT_LABELS.waves,
      value: `${stats.wavesCleared} / ${FINAL_WAVE}`,
      tone: 'Plain',
    },
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

const KILL_SLOT_PX = 40

const killShapes = (
  stats: RunStats,
  y: number,
): ReadonlyArray<Canvas.Shape> => {
  const left = Math.round(
    CENTER_X - (ZOMBIE_KIND_ORDER.length * KILL_SLOT_PX) / 2,
  )
  return Array.flatMap(ZOMBIE_KIND_ORDER, (kind, index) => {
    const x = left + index * KILL_SLOT_PX + 8
    return [
      group({ translate: { x, y: y + 3 }, shapes: ZOMBIE_SPRITES[kind].icon }),
      ...textShapes(`x${stats.kills[kind]}`, 'Kill', x + 7, y, 'Left'),
    ]
  })
}

const panelShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const rows = statRows(model)
  const killsY = PANEL_TOP + PANEL_PAD + rows.length * PANEL_ROW_PX + 3
  const bottom = killsY + PANEL_ROW_PX + PANEL_PAD - 2
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

const againScale = (model: Model): number =>
  AGAIN_PROMPT[model.lastDevice].width * TITLE_SCALE <= ARENA_WIDTH - 8
    ? TITLE_SCALE
    : 1

const VERDICT_Y = 29

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
  ...(model.screenMs >= RESTART_GRACE_MS && isBlinkOn(model.screenMs)
    ? [centered(AGAIN_PROMPT[model.lastDevice], PROMPT_Y, againScale(model))]
    : []),
]

// OVERLAY

export const overlayShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => readyShapes(model),
    Preparation: ({ wave, remainingMs, durationMs }) => [
      ...preparationBanner(model, wave, durationMs - remainingMs),
      ...hintShapes(model),
    ],
    Wave: ({ wave, elapsedMs }) => [
      ...waveBanner(model, wave, elapsedMs),
      ...hintShapes(model),
    ],
    Paused: ({ round }) => pausedShapes(model, round.wave),
    Victory: () => endShapes(model, YOU_SURVIVED, victoryVerdict(model.stats)),
    GameOver: ({ wave }) =>
      endShapes(model, GAME_OVER, defeatVerdict(wave, model.stats)),
  })
