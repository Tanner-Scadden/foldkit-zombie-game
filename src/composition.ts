import { type Block, Update } from 'foldkit'

import { DialogBlock } from '@foldkit/ui'

import { CharacterBlock } from './characterBlock'
import { CoopBlock } from './coop'
import {
  makeBinding,
  makeComposition,
  makeNoopStep,
  makeOutMessageFold,
  makeStep,
} from './definition'
import { isProfileOpen } from './menuState'
import { mounts } from './mount'
import { ProfileTabsBlock } from './profile'
import { isBrowsing } from './shop'
import { ShopTabsBlock } from './shopTabs'
import { chooseLook, flipLook, rollLook } from './update/character'
import { closedCoop, leftRoom, neededNewerBuild } from './update/coop'
import { forgetAskedMode } from './update/home'
import { keepName, switchTab } from './update/profile'
import { afterMessage, settled } from './update/settle'
import { leaveShop, selectCategory } from './update/shop'

// NOTE: every child of the root, each placed on its Model field, so its
// generated Message is `Got<Field>Message` (GotShopDialogMessage). The
// root's own Model fields hold their state (`init: false`): see
// initialModel in src/model.ts. An OutMessage fold changes the root, so
// it is `settled`: the root's after-message Steps (music, save, run
// count) run on it as they do after a local Message.

// DIALOGS

export const ShopDialogBinding = makeBinding(DialogBlock, {
  field: 'shopDialog',
  init: false,
}).withOutMessagePolicy({
  fold: makeOutMessageFold(DialogBlock, {
    Opened: makeNoopStep,
    Closed: () =>
      makeStep(before =>
        Update.combineSteps([leaveShop, ...afterMessage(before)]),
      ),
    CompletedClose: makeNoopStep,
  }),
})

export const ProfileDialogBinding = makeBinding(DialogBlock, {
  field: 'profileDialog',
  init: false,
}).withOutMessagePolicy({
  fold: makeOutMessageFold(DialogBlock, {
    Opened: makeNoopStep,
    Closed: () => settled(keepName),
    CompletedClose: makeNoopStep,
  }),
})

export const PanelDialogBinding = makeBinding(DialogBlock, {
  field: 'panelDialog',
  init: false,
}).withOutMessagePolicy({
  fold: makeOutMessageFold(DialogBlock, {
    Opened: makeNoopStep,
    Closed: () => settled(forgetAskedMode),
    CompletedClose: makeNoopStep,
  }),
})

const dialogWithoutPolicy = makeOutMessageFold(DialogBlock, {
  Opened: makeNoopStep,
  Closed: makeNoopStep,
  CompletedClose: makeNoopStep,
})

export const HandDialogBinding = makeBinding(DialogBlock, {
  field: 'handDialog',
  init: false,
}).withOutMessagePolicy({ fold: dialogWithoutPolicy })

export const HomeScreenStepsBinding = makeBinding(DialogBlock, {
  field: 'homeScreenSteps',
  init: false,
}).withOutMessagePolicy({ fold: dialogWithoutPolicy })

export const UpdateGreetingBinding = makeBinding(DialogBlock, {
  field: 'updateGreeting',
  init: false,
}).withOutMessagePolicy({ fold: dialogWithoutPolicy })

// TABS

// NOTE: tabs only answer while their dialog is up.
export const ProfileTabsBinding = makeBinding(ProfileTabsBlock, {
  field: 'profileTabs',
  init: false,
  delivery: { when: isProfileOpen },
}).withOutMessagePolicy({
  fold: makeOutMessageFold(ProfileTabsBlock, {
    Selected: ({ value }) => settled(switchTab(value)),
  }),
})

export const ShopTabsBinding = makeBinding(ShopTabsBlock, {
  field: 'shopTabs',
  init: false,
  delivery: { when: model => isBrowsing(model.shop) },
}).withOutMessagePolicy({
  fold: makeOutMessageFold(ShopTabsBlock, {
    Selected: ({ value }) => settled(selectCategory(value)),
  }),
})

// THE LOOK TAB

export const CharacterBinding = makeBinding(CharacterBlock, {
  field: 'character',
  init: false,
}).withOutMessagePolicy({
  fold: makeOutMessageFold(CharacterBlock, {
    ChoseLook: ({ part, value }) => settled(chooseLook(part, value)),
    FlippedLook: ({ toggle }) => settled(flipLook(toggle)),
    RequestedRandomLook: () => settled(rollLook),
  }),
})

// CO-OP

export const CoopBinding = makeBinding(CoopBlock, {
  field: 'coop',
  init: false,
}).withOutMessagePolicy({
  fold: makeOutMessageFold(CoopBlock, {
    ClosedCoop: () => settled(closedCoop),
    NeededNewerBuild: () => settled(neededNewerBuild),
    LeftRoom: () => settled(leftRoom),
  }),
})

export const ApplicationComposition = makeComposition({
  bindings: [
    ShopDialogBinding,
    ShopTabsBinding,
    ProfileDialogBinding,
    ProfileTabsBinding,
    PanelDialogBinding,
    HandDialogBinding,
    HomeScreenStepsBinding,
    UpdateGreetingBinding,
    CharacterBinding,
    CoopBinding,
  ],
  mounts,
})
export type ApplicationViewBuilder = Block.ViewBuilderFor<
  typeof ApplicationComposition
>
// NOTE: an attribute the root's view builder makes, carrying the root's
// whole Message, its children's included.
export type ApplicationAttribute = Parameters<
  ApplicationViewBuilder['div']
>[0][number]
