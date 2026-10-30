import { Array } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { World } from './world'
import { type Zombie, ZombieAction } from './worldSchema'

// RECOVERY

const isRecovering = ZombieAction.isAnyOf(['Winded', 'Dazed'])

const recover =
  (deltaMs: number) =>
  (zombie: Zombie): Zombie => {
    const action = zombie.action
    if (ZombieAction.isAnyOf(['Winded'])(action)) {
      return modifyFields(zombie, {
        action: () =>
          action.remainingMs > deltaMs
            ? ZombieAction.Winded({ remainingMs: action.remainingMs - deltaMs })
            : ZombieAction.Roaming(),
      })
    } else if (ZombieAction.isAnyOf(['Dazed'])(action)) {
      return modifyFields(zombie, {
        action: () =>
          action.remainingMs > deltaMs
            ? ZombieAction.Dazed({
                remainingMs: action.remainingMs - deltaMs,
                durationMs: action.durationMs,
              })
            : ZombieAction.Roaming(),
      })
    } else {
      return zombie
    }
  }

export const recoverActions = (model: World, deltaMs: number): World =>
  Array.some(model.zombies, zombie => isRecovering(zombie.action))
    ? modifyFields(model, {
        zombies: Array.map(recover(deltaMs)),
      })
    : model
