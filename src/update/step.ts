import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { AppServices } from '../commands'
import type { Message } from '../message'
import type { Input, Model } from '../model'
import { refreshIntent } from '../simulation'

export type UpdateReturn = Update.Return<Model, Message, AppServices>
export type UpdateStep = Update.Step<Model, Message, AppServices>

export const withInput = (model: Model, toNextInput: (input: Input) => Input) =>
  refreshIntent(modifyFields(model, { input: toNextInput }))
