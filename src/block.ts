import { Block } from 'foldkit'

import { managedResources } from './commands'
import { ApplicationComposition } from './composition'
import { EffectsLayer } from './layer'
import { init, update } from './main'
import type { Model } from './model'
import { subscriptions } from './subscriptions'
import { view } from './view'

const prepare = () =>
  ApplicationComposition.prepareBlock({
    init,
    update,
    view,
    subscriptions,
    managedResources,
    EffectsLayer,
  })
export const ApplicationBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare)
