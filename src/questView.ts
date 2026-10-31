import { Array, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from './composition'
import {
  QUEST_STEPS,
  type QuestStep,
  isQuestDone,
  questStepOf,
} from './firstBreakQuest'
import { QUEST_BUY_ICON, QUEST_PLACE_ICON, QUEST_SHOP_ICON } from './icons'
import { Message } from './message'
import type { Model } from './model'

// NOTE: the guided first break's tracker, in the corner under the hearts:
// its three steps as icons, the current one lit with its one word, the done
// ones ticked, and a skip button. Done, every step ticks, a little confetti
// pops, and it fades.

type StepLook = Readonly<{ icon: string; word: string; spoken: string }>

const STEP_LOOKS: Readonly<Record<QuestStep, StepLook>> = {
  Shop: { icon: QUEST_SHOP_ICON, word: 'GO', spoken: "Walk to Rattles' stall" },
  Buy: { icon: QUEST_BUY_ICON, word: 'BUY', spoken: 'Buy a Plank Pile' },
  Place: {
    icon: QUEST_PLACE_ICON,
    word: 'PLACE',
    spoken: 'Put it in a doorway',
  },
}

type StepState = 'Done' | 'Now' | 'Later'

const stateOf = (
  step: QuestStep,
  maybeCurrent: Option.Option<QuestStep>,
  isAllDone: boolean,
): StepState =>
  Option.match(maybeCurrent, {
    onNone: () => (isAllDone ? 'Done' : 'Later'),
    onSome: current => {
      const index = QUEST_STEPS.indexOf(step)
      const currentIndex = QUEST_STEPS.indexOf(current)
      if (index < currentIndex) {
        return 'Done'
      } else if (index === currentIndex) {
        return 'Now'
      } else {
        return 'Later'
      }
    },
  })

const stepView = (
  step: QuestStep,
  state: StepState,
  h: ApplicationViewBuilder,
): Html => {
  const look = STEP_LOOKS[step]
  return h.keyed('li')(
    step,
    [
      h.Class('quest-step'),
      h.DataAttribute('state', state),
      h.AriaLabel(
        `${look.spoken}${state === 'Done' ? ', done' : state === 'Now' ? ', now' : ''}`,
      ),
      ...(state === 'Now' ? [h.AriaCurrent('step')] : []),
    ],
    [
      h.span([
        h.Class('quest-step-icon'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: look.icon }),
      ]),
      state === 'Now'
        ? h.span([h.Class('quest-step-word'), h.AriaHidden(true)], [look.word])
        : h.empty,
      state === 'Done'
        ? h.span([h.Class('quest-step-tick'), h.AriaHidden(true)], ['✓'])
        : h.empty,
    ],
  )
}

const CONFETTI = Array.makeBy(10, index => index)

export const questTrackerView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html => {
  const maybeCurrent = questStepOf(model)
  const isAllDone = isQuestDone(model)
  if (Option.isNone(maybeCurrent) && !isAllDone) {
    return h.empty
  }
  return h.div(
    [h.Class('quest-frame')],
    [
      h.section(
        [
          h.Class('quest-tracker'),
          h.DataAttribute('done', isAllDone ? 'true' : 'false'),
          h.AriaLabel('First break'),
        ],
        [
          h.ol(
            [h.Class('quest-steps')],
            Array.map(QUEST_STEPS, step =>
              stepView(step, stateOf(step, maybeCurrent, isAllDone), h),
            ),
          ),
          isAllDone
            ? h.span(
                [h.Class('quest-confetti'), h.AriaHidden(true)],
                Array.map(CONFETTI, index =>
                  h.span([
                    h.Class('quest-confetti-bit'),
                    h.Style({ '--bit': `${index}` }),
                  ]),
                ),
              )
            : h.button(
                [
                  h.Type('button'),
                  h.Class('quest-skip'),
                  h.AriaLabel('Skip the first break tour'),
                  h.OnClick(Message.ClickedSkipQuestButton(), {
                    focusSelector: '.game-surface',
                  }),
                ],
                ['×'],
              ),
        ],
      ),
    ],
  )
}
