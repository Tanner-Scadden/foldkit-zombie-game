import { Runtime } from 'foldkit'

import { Message, Model, init, subscriptions, update } from './main'
import { view } from './view'

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions,
  container: document.getElementById('root'),
  devTools: {
    Message,
    excludeFromHistory: ['TickedFrame', 'MovedPointer', 'MovedMouse'],
  },
})

Runtime.run(application)
