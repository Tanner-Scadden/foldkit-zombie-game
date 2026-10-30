import { modifyFields } from 'foldkit/struct'

import { OPEN_BREAK_WAVE } from './constants'
import type { World } from './world'
import { BreakClock, Lesson, Phase } from './worldSchema'

// The lessons the step itself reads and writes: the practice gate that
// holds the first break, and the breaks a player has seen. The rest of the
// teaching, with its hints and their places on screen, is the client's
// (src/onboarding.ts).

export const learn = (lesson: Lesson, atMs: number): Lesson =>
  Lesson.match(lesson, {
    Pending: () => Lesson.Learned({ atMs }),
    Learned: () => lesson,
  })

export const isPending = (lesson: Lesson): boolean =>
  Lesson.isAnyOf(['Pending'])(lesson)

// PRACTICE GATE

export const isFirstPreparation = (phase: Phase): boolean =>
  Phase.match(phase, {
    Ready: () => false,
    Preparation: ({ wave }) => wave === 1,
    Wave: () => false,
    Paused: () => false,
    Victory: () => false,
    GameOver: () => false,
  })

export const isPracticeGateHeld = (model: World): boolean =>
  isFirstPreparation(model.phase) &&
  (isPending(model.lessons.move) || isPending(model.lessons.fire))

// BREAKS

export const learnTimedBreaks = (model: World): World =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, {
        timedBreaks: lesson => learn(lesson, model.elapsedMs),
      }),
  })

export const learnOpenBreak = (model: World): World =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, {
        openBreak: lesson => learn(lesson, model.elapsedMs),
      }),
  })

export const isTimedBreak = (wave: number, clock: BreakClock): boolean =>
  wave > OPEN_BREAK_WAVE && BreakClock.isAnyOf(['Counting'])(clock)
