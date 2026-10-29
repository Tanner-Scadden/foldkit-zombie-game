import { Runtime } from 'foldkit'

import {
  Message,
  Model,
  init,
  managedResources,
  subscriptions,
  update,
} from './main'
import { layer as PlayerStoreLayer } from './store'
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
