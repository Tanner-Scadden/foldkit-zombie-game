import { Option, String } from 'effect'
import { Canvas } from 'foldkit'

import { BOSS_RULES, type BossBar, maybeStandingBoss } from './boss'
import { VIEW_WIDTH } from './constants'
import { HEALTH_BAR_BACK_COLOR } from './drawing'
import { bakeText, placeBaked } from './font'
import { clamp } from './geometry'
import { Boss, BossMove, type HintBand, type Model } from './model'
import { BOSS_ICON, group } from './sprite'
import { ZOMBIE_KINDS } from './zombies'

// STOMP RING

const RING_FILL_FAINT = 0.12
const RING_FILL_STRONG = 0.34
const RING_EDGE_COLOR = '#ff4a4f'
const RING_SWEEP_COLOR = '#ffe066'

const ringFill = (progress: number): string =>
  `rgba(255, 58, 63, ${Math.round((RING_FILL_FAINT + (RING_FILL_STRONG - RING_FILL_FAINT) * progress) * 100) / 100})`

export const bossGroundShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Boss.match(model.boss, {
    Absent: () => [],
    Waiting: () => [],
    Arriving: () => [],
    Fighting: ({ move }) =>
      BossMove.match(move, {
        Stalking: () => [],
        Recovering: () => [],
        WindingUp: ({ attack, remainingMs, durationMs }) =>
          attack === 'Stomp'
            ? Option.match(maybeStandingBoss(model), {
                onNone: () => [],
                onSome: boss => {
                  const progress = clamp(
                    1 - remainingMs / Math.max(1, durationMs),
                    0,
                    1,
                  )
                  const x = Math.round(boss.x)
                  const y = Math.round(boss.y)
                  return [
                    Canvas.Circle({
                      x,
                      y,
                      radius: BOSS_RULES.stompRadius,
                      fill: ringFill(progress),
                    }),
                    Canvas.Circle({
                      x,
                      y,
                      radius: BOSS_RULES.stompRadius,
                      stroke: RING_EDGE_COLOR,
                      lineWidth: 1,
                    }),
                    Canvas.Circle({
                      x,
                      y,
                      radius: Math.max(
                        1,
                        Math.round(BOSS_RULES.stompRadius * progress),
                      ),
                      stroke: RING_SWEEP_COLOR,
                      lineWidth: 2,
                    }),
                  ]
                },
              })
            : [],
      }),
  })

// HEALTH BAR

const BAR_NAME = bakeText(String.toUpperCase(ZOMBIE_KINDS.Boss.name), 'Defeat')
const BAR_WIDTH = 80
const BAR_HEIGHT = 4
const BAR_GAP = 4
const BAR_FILL = '#ff3b3f'
const BAR_SHINE = '#ff8a8f'
const BAR_EDGE = '#f4f1de'

export const bossBarShapes = (
  bar: BossBar,
  y: number,
): ReadonlyArray<Canvas.Shape> => {
  const total = BAR_NAME.width + BAR_GAP + BAR_WIDTH
  const left = Math.round(VIEW_WIDTH / 2 - total / 2)
  const barLeft = left + BAR_NAME.width + BAR_GAP
  const filled = Math.max(
    bar.hp > 0 ? 1 : 0,
    Math.round((BAR_WIDTH * bar.hp) / Math.max(1, bar.maxHp)),
  )
  return [
    placeBaked(BAR_NAME, { x: left, y, align: 'Left' }),
    Canvas.Rect({
      x: barLeft - 1,
      y: y - 1,
      width: BAR_WIDTH + 2,
      height: BAR_HEIGHT + 2,
      fill: BAR_EDGE,
    }),
    Canvas.Rect({
      x: barLeft,
      y,
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
      fill: HEALTH_BAR_BACK_COLOR,
    }),
    Canvas.Rect({
      x: barLeft,
      y,
      width: filled,
      height: BAR_HEIGHT,
      fill: BAR_FILL,
    }),
    Canvas.Rect({
      x: barLeft,
      y,
      width: filled,
      height: 1,
      fill: BAR_SHINE,
    }),
  ]
}

// ENTRANCE BAND

const BAND_TOPS: Readonly<Record<HintBand, number>> = { Top: 21, Bottom: 100 }
const BAND_HEIGHT = 30
const BAND_LIFT = 3
const BAND_FILL = 'rgba(24, 6, 10, 0.82)'
const BAND_EDGE = '#ff4a4f'
const TITLE_SCALE = 2
const ICON_SCALE = 3
const ICON_GAP = 8
const ICON_WIDTH = 7
const TAGLINE_OFFSET = 17
const BAND_FADE_MS = 300
const TITLE = bakeText(String.toUpperCase(ZOMBIE_KINDS.Boss.name), 'Defeat')
const TAGLINE = bakeText(ZOMBIE_KINDS.Boss.tagline, 'Prompt')

const bandOpacity = (remainingMs: number, durationMs: number): number => {
  const shownMs = durationMs - remainingMs
  return (
    Math.round(
      clamp(Math.min(shownMs, remainingMs) / BAND_FADE_MS, 0, 1) * 10,
    ) / 10
  )
}

export const bossBandShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Boss.isAnyOf(['Arriving'])(model.boss)
    ? entranceBand(
        BAND_TOPS[model.hintBand],
        bandOpacity(model.boss.remainingMs, model.boss.durationMs),
        model.elapsedMs,
      )
    : []

const ICON_HOP_MS = 300

const entranceBand = (
  top: number,
  opacity: number,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const titleWidth = TITLE.width * TITLE_SCALE
  const iconWidth = ICON_WIDTH * ICON_SCALE
  const groupWidth = iconWidth + ICON_GAP + titleWidth
  const left = Math.round(VIEW_WIDTH / 2 - groupWidth / 2)
  const hop = Math.floor(elapsedMs / ICON_HOP_MS) % 2 === 0 ? 0 : -1
  return [
    group({
      opacity,
      shapes: [
        Canvas.Rect({
          x: 0,
          y: top - BAND_LIFT,
          width: VIEW_WIDTH,
          height: BAND_HEIGHT,
          fill: BAND_FILL,
        }),
        Canvas.Rect({
          x: 0,
          y: top - BAND_LIFT - 1,
          width: VIEW_WIDTH,
          height: 1,
          fill: BAND_EDGE,
        }),
        Canvas.Rect({
          x: 0,
          y: top - BAND_LIFT + BAND_HEIGHT,
          width: VIEW_WIDTH,
          height: 1,
          fill: BAND_EDGE,
        }),
        group({
          translate: {
            x: left + Math.round(iconWidth / 2),
            y: top + 6 + hop,
          },
          scale: { x: ICON_SCALE, y: ICON_SCALE },
          shapes: BOSS_ICON,
        }),
        placeBaked(TITLE, {
          x: left + iconWidth + ICON_GAP,
          y: top,
          align: 'Left',
          scale: TITLE_SCALE,
        }),
        placeBaked(TAGLINE, {
          x: left + iconWidth + ICON_GAP + Math.round(titleWidth / 2),
          y: top + TAGLINE_OFFSET,
          align: 'Center',
        }),
      ],
    }),
  ]
}
