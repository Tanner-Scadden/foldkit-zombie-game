// NOTE: first, so the prebuilt sprite atlas is in place before any module
// builds a sprite (see src/spriteAtlasBoot.ts).
import './spriteAtlasBoot'
import { Effect, Layer } from 'effect'
import { Runtime } from 'foldkit'

import { managedResources } from './commands'
import { layer as CoopNetLayer } from './coop/net'
import { layer as InstallPromptLayer } from './install'
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
  resources: Layer.merge(
    Layer.provideMerge(CoopNetLayer, PlayerStoreLayer),
    InstallPromptLayer,
  ),
  container: document.getElementById('root'),
  devTools: {
    Message,
    excludeFromHistory: [
      'TickedFrame',
      'GotCoopMessage',
      'MovedPointer',
      'MovedMouse',
      'CompletedPlaySound',
    ],
  },
})

Runtime.run(application)
