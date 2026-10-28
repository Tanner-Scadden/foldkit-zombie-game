import { modifyFields } from 'foldkit/struct'

import { Lesson, type Model } from './model'
import { ZOMBIE_KIND_ORDER } from './zombies'

export const asVeteran = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, {
        move: () => Lesson.Learned({ atMs: 0 }),
        fire: () => Lesson.Learned({ atMs: 0 }),
      }),
    introducedKinds: () => ZOMBIE_KIND_ORDER,
  })
