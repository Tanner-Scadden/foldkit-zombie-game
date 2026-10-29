import { Runtime } from 'foldkit'

import { managedResources } from './commands'
import { init, update } from './main'
import { Message } from './message'
import { Model } from './model'
import { layer as PlayerStoreLayer } from './store'
import { subscriptions } from './subscriptions'
import { view } from './view'

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
