import { Option } from 'effect'
import { Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { Dialog, RadioGroup } from '@foldkit/ui'

import { dialogFolds } from './dialogs'
import {
  type Appearance,
  Body,
  type CharacterPicker,
  HairColor,
  HairStyle,
  LookPart,
  ShirtColor,
  SkinTone,
} from './model'

// MESSAGE

export const Message = defineMessageUnion({
  GotDialogMessage: { message: Dialog.Message },
  GotBodyMessage: { message: RadioGroup.Message },
  GotHairStyleMessage: { message: RadioGroup.Message },
  GotHairColorMessage: { message: RadioGroup.Message },
  GotSkinToneMessage: { message: RadioGroup.Message },
  GotShirtColorMessage: { message: RadioGroup.Message },
  ClickedRandomizeButton: {},
})
export type Message = typeof Message.Type

const LookChoice = defineTaggedUnion({
  Body: { body: Body },
  HairStyle: { hairStyle: HairStyle },
  HairColor: { hairColor: HairColor },
  SkinTone: { skinTone: SkinTone },
  ShirtColor: { shirtColor: ShirtColor },
})
type LookChoice = typeof LookChoice.Type

export const OutMessage = defineMessageUnion({
  ChoseLook: { choice: LookChoice },
  RequestedRandomLook: {},
})
export type OutMessage = typeof OutMessage.Type

// LOOK

export const BodyRadioGroup = RadioGroup.create<Body>()
export const HairStyleRadioGroup = RadioGroup.create<HairStyle>()
export const HairColorRadioGroup = RadioGroup.create<HairColor>()
export const SkinToneRadioGroup = RadioGroup.create<SkinTone>()
export const ShirtColorRadioGroup = RadioGroup.create<ShirtColor>()

export const chooseLook = (
  appearance: Appearance,
  choice: LookChoice,
): Appearance =>
  LookChoice.match(choice, {
    Body: ({ body }) => modifyFields(appearance, { body: () => body }),
    HairStyle: ({ hairStyle }) =>
      modifyFields(appearance, { hairStyle: () => hairStyle }),
    HairColor: ({ hairColor }) =>
      modifyFields(appearance, { hairColor: () => hairColor }),
    SkinTone: ({ skinTone }) =>
      modifyFields(appearance, { skinTone: () => skinTone }),
    ShirtColor: ({ shirtColor }) =>
      modifyFields(appearance, { shirtColor: () => shirtColor }),
  })

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<
  CharacterPicker,
  Message,
  OutMessage
>

const dialog = dialogFolds({
  read: (picker: CharacterPicker) => picker.dialog,
  write: (picker, nextDialog) =>
    modifyFields(picker, { dialog: () => nextDialog }),
  toParentMessage: message => Message.GotDialogMessage({ message }),
})

export const open = dialog.open

export const close = dialog.close

type PartLens = Readonly<{
  read: (picker: CharacterPicker) => RadioGroup.Model
  write: (picker: CharacterPicker, next: RadioGroup.Model) => CharacterPicker
}>

const PART_LENSES: Readonly<Record<LookPart, PartLens>> = {
  Body: {
    read: picker => picker.body,
    write: (picker, next) => modifyFields(picker, { body: () => next }),
  },
  HairStyle: {
    read: picker => picker.hairStyle,
    write: (picker, next) => modifyFields(picker, { hairStyle: () => next }),
  },
  HairColor: {
    read: picker => picker.hairColor,
    write: (picker, next) => modifyFields(picker, { hairColor: () => next }),
  },
  SkinTone: {
    read: picker => picker.skinTone,
    write: (picker, next) => modifyFields(picker, { skinTone: () => next }),
  },
  ShirtColor: {
    read: picker => picker.shirtColor,
    write: (picker, next) => modifyFields(picker, { shirtColor: () => next }),
  },
}

const PART_MESSAGES: Readonly<
  Record<LookPart, (message: RadioGroup.Message) => Message>
> = {
  Body: message => Message.GotBodyMessage({ message }),
  HairStyle: message => Message.GotHairStyleMessage({ message }),
  HairColor: message => Message.GotHairColorMessage({ message }),
  SkinTone: message => Message.GotSkinToneMessage({ message }),
  ShirtColor: message => Message.GotShirtColorMessage({ message }),
}

const foldPart = <Value extends string>(
  part: LookPart,
  radioGroup: RadioGroup.Bundle<Value>,
  toChoice: (value: Value) => LookChoice,
): Update.FoldWithOutMessage<
  CharacterPicker,
  Message,
  RadioGroup.Message,
  OutMessage
> =>
  Update.foldChild({
    update: radioGroup.update,
    read: (picker: CharacterPicker) =>
      Option.some(PART_LENSES[part].read(picker)),
    write: PART_LENSES[part].write,
    toParentMessage: PART_MESSAGES[part],
    toParentOutMessage: ({ value }) =>
      OutMessage.ChoseLook({ choice: toChoice(value) }),
  })

const PART_FOLDS = {
  Body: foldPart('Body', BodyRadioGroup, body => LookChoice.Body({ body })),
  HairStyle: foldPart('HairStyle', HairStyleRadioGroup, hairStyle =>
    LookChoice.HairStyle({ hairStyle }),
  ),
  HairColor: foldPart('HairColor', HairColorRadioGroup, hairColor =>
    LookChoice.HairColor({ hairColor }),
  ),
  SkinTone: foldPart('SkinTone', SkinToneRadioGroup, skinTone =>
    LookChoice.SkinTone({ skinTone }),
  ),
  ShirtColor: foldPart('ShirtColor', ShirtColorRadioGroup, shirtColor =>
    LookChoice.ShirtColor({ shirtColor }),
  ),
}

export const update = (picker: CharacterPicker, message: Message) =>
  Message.match<UpdateReturn>(message, {
    GotDialogMessage: ({ message: dialogMessage }) =>
      dialog.fold(picker, dialogMessage),
    GotBodyMessage: ({ message: groupMessage }) =>
      PART_FOLDS.Body(picker, groupMessage),
    GotHairStyleMessage: ({ message: groupMessage }) =>
      PART_FOLDS.HairStyle(picker, groupMessage),
    GotHairColorMessage: ({ message: groupMessage }) =>
      PART_FOLDS.HairColor(picker, groupMessage),
    GotSkinToneMessage: ({ message: groupMessage }) =>
      PART_FOLDS.SkinTone(picker, groupMessage),
    GotShirtColorMessage: ({ message: groupMessage }) =>
      PART_FOLDS.ShirtColor(picker, groupMessage),
    ClickedRandomizeButton: () => ({
      model: picker,
      outMessage: OutMessage.RequestedRandomLook(),
    }),
  })
