import { modifyFields } from 'foldkit/struct'

import { ApplyRotation } from '../commands'
import type { Model } from '../model'
import type { UpdateStep } from './step'

// ROTATION

export const toggleRotation = (model: Model): Model =>
  model.orientationLock === 'Supported'
    ? modifyFields(model, {
        rotationSetting: setting =>
          setting === 'Landscape' ? 'Auto' : 'Landscape',
      })
    : model

// NOTE: a lock can be dropped by the browser, so the rotation is applied
// again whenever it could have been lost or changed: once the device is
// known to lock, once the save is read, when the setting changes, when full
// screen comes on, and when the page is shown again. Only where a lock is
// supported, so a desktop or an iPhone never tries.
const shouldApplyRotation = (before: Model, after: Model): boolean =>
  after.orientationLock === 'Supported' &&
  (before.orientationLock !== after.orientationLock ||
    (before.saveStatus !== after.saveStatus && after.saveStatus === 'Read') ||
    before.rotationSetting !== after.rotationSetting ||
    (before.fullscreen !== after.fullscreen && after.fullscreen === 'On') ||
    (before.pageVisibility !== after.pageVisibility &&
      after.pageVisibility === 'Visible'))

export const applyRotationFrom =
  (before: Model): UpdateStep =>
  stepModel =>
    shouldApplyRotation(before, stepModel)
      ? {
          model: stepModel,
          commands: [ApplyRotation({ rotation: stepModel.rotationSetting })],
        }
      : { model: stepModel }
