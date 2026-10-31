import { Block } from 'foldkit'

import { Message } from './message'
import { Model } from './model'

// NOTE: the root's contract. Commands, Subscriptions, the audio resource,
// Steps, and Bindings are authored through it, so their names and Message
// types belong to the application (see "Blocks and Bindings" in AGENTS.md).
export const ApplicationDefinition = Block.makeDefinition('Application', {
  Model,
  Message,
})

export const {
  makeBinding,
  makeCommand,
  makeComposition,
  makeManagedResources,
  makeNoopStep,
  makeOutMessageFold,
  makeResource,
  makeStep,
  makeSubscriptions,
} = ApplicationDefinition
