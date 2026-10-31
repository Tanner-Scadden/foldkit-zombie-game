import { Block } from 'foldkit'

import { ApplicationComposition } from './composition'
import { EffectsLayer } from './layer'
import { init, update } from './main'
import type { Model } from './model'
import { subscriptions } from './subscriptions'
import { managedResources } from './update/sound'
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
