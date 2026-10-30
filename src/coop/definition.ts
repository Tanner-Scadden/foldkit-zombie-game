import { Block } from 'foldkit'

import { Message, OutMessage } from './message'
import { Model } from './model'

// NOTE: co-op's contract. Its Commands and Subscriptions are authored
// through it, so their names belong to co-op (`Coop/RequestRoom`).
export const CoopDefinition = Block.makeDefinition('Coop', {
  Model,
  Message,
  OutMessage,
})

export const { makeCommand, makeComposition, makeSubscriptions } =
  CoopDefinition
