import type { Layer } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { CommandsLayer } from '../commands'
import { refreshIntent } from '../frame'
import type { Message } from '../message'
import type { Input, Model } from '../model'

// NOTE: the handlers the root's Commands need, read off the Layer that
// supplies them, so a plain Step can return any root Command. A Step that
// opens a dialog or talks to co-op uses a Binding, which needs the root's
// graph: author it with `makeStep` from src/definition.ts instead.
export type AppHandlers = Layer.Success<typeof CommandsLayer>

export type UpdateReturn = Update.Return<Model, Message, AppHandlers>
export type UpdateStep = Update.Step<Model, Message, AppHandlers>

export const withInput = (model: Model, toNextInput: (input: Input) => Input) =>
  refreshIntent(modifyFields(model, { input: toNextInput }))

export const unchanged: UpdateStep = model => ({ model })

// NOTE: a Step that only changes the Model, from a plain Model function.
export const modelStep =
  (change: (model: Model) => Model): UpdateStep =>
  model => ({ model: change(model) })

// NOTE: the first Step of a Step built from the Model it is given (inside
// `makeStep`): the Model it made from that one.
export const toModel =
  (next: Model): UpdateStep =>
  () => ({ model: next })

// NOTE: Update.combineSteps for plain Steps, typed to the root Model, so a
// Model just built by modifyFields fits. Steps that use a Binding combine
// with Update.combineSteps itself, inside `makeStep`.
export const combine = (
  model: Model,
  steps: ReadonlyArray<UpdateStep>,
): UpdateReturn => Update.combineSteps(model, steps)
