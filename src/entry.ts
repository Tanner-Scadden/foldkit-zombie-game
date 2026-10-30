// NOTE: first, so the prebuilt sprite atlas is in place before any module
// builds a sprite (see src/spriteAtlasBoot.ts).
import './spriteAtlasBoot'
import { Effect } from 'effect'
import { Runtime } from 'foldkit'

import { managedResources } from './commands'
import { init, update } from './main'
import { Message } from './message'
import { Model } from './model'
import { preventPageZoom } from './noZoom'
import { layer as PlayerStoreLayer } from './store'
import { subscriptions } from './subscriptions'
import { view } from './view'

// NOTE: every module has run by here, sprites built at module load included.
performance.mark('load:modules')

Effect.runSync(preventPageZoom)

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions,
  managedResources,
  resources: PlayerStoreLayer,
  container: document.getElementById('root'),
  devTools: {
    Message,
    excludeFromHistory: [
      'TickedFrame',
      'MovedPointer',
      'MovedMouse',
      'CompletedPlaySound',
    ],
  },
})

Runtime.run(application)
