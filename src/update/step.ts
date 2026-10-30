import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { AppServices } from '../commands'
import { refreshIntent } from '../frame'
import type { Message } from '../message'
import type { Input, Model } from '../model'

export type UpdateReturn = Update.Return<Model, Message, AppServices>
export type UpdateStep = Update.Step<Model, Message, AppServices>

export const withInput = (model: Model, toNextInput: (input: Input) => Input) =>
  refreshIntent(modifyFields(model, { input: toNextInput }))
