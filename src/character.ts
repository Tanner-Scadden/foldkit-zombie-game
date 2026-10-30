import { Option, Schema } from 'effect'
import { Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { RadioGroup } from '@foldkit/ui'

import {
  type Appearance,
  Body,
  type CharacterPicker,
  Extra,
  FacialHair,
  HairColor,
  HairStyle,
  LookPart,
  LookSection,
  Makeup,
  Outfit,
  Print,
  ShirtColor,
  SkinTone,
} from './model'

// MESSAGE

export const Message = defineMessageUnion({
  GotPartMessage: { partId: LookPart, message: RadioGroup.Message },
  GotSectionMessage: { message: RadioGroup.Message },
  ClickedDiceButton: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  ChoseLook: { part: LookPart, value: Schema.String },
  RequestedRandomLook: {},
})
export type OutMessage = typeof OutMessage.Type

// LOOK

export const SectionRadioGroup = RadioGroup.create<LookSection>()

// NOTE: one radio group serves every part: its values are the part's own
// words, and chooseLook reads them back through the part's Schema.
export const PartRadioGroup = RadioGroup.create<string>()

// NOTE: the parts on each of the Look tab's little tabs, in order.
export const SECTION_PARTS: Readonly<
  Record<LookSection, ReadonlyArray<LookPart>>
> = {
  Body: ['Body', 'SkinTone'],
  Hair: ['HairStyle', 'HairColor'],
  Face: ['FacialHair', 'Makeup', 'Extra'],
  Outfit: ['Outfit', 'ShirtColor'],
  Print: ['Print'],
}

const readAs =
  <A extends string>(schema: Schema.Codec<A>) =>
  (value: string): Option.Option<A> =>
    Schema.decodeUnknownOption(schema)(value)

type Part = Readonly<{
  read: (picker: CharacterPicker) => RadioGroup.Model
  write: (picker: CharacterPicker, next: RadioGroup.Model) => CharacterPicker
  choose: (appearance: Appearance, value: string) => Appearance
}>

// NOTE: each part's radio group in the picker, and how a chosen word lands
// in the look. A word that is not one of the part's options leaves the
// look as it was.
const PARTS: Readonly<Record<LookPart, Part>> = {
  Body: {
    read: picker => picker.body,
    write: (picker, next) => modifyFields(picker, { body: () => next }),
    choose: (appearance, value) =>
      Option.match(readAs(Body)(value), {
        onNone: () => appearance,
        onSome: body => modifyFields(appearance, { body: () => body }),
      }),
  },
  HairStyle: {
    read: picker => picker.hairStyle,
    write: (picker, next) => modifyFields(picker, { hairStyle: () => next }),
    choose: (appearance, value) =>
      Option.match(readAs(HairStyle)(value), {
        onNone: () => appearance,
        onSome: hairStyle =>
          modifyFields(appearance, { hairStyle: () => hairStyle }),
      }),
  },
  HairColor: {
    read: picker => picker.hairColor,
    write: (picker, next) => modifyFields(picker, { hairColor: () => next }),
    choose: (appearance, value) =>
      Option.match(readAs(HairColor)(value), {
        onNone: () => appearance,
        onSome: hairColor =>
          modifyFields(appearance, { hairColor: () => hairColor }),
      }),
  },
  SkinTone: {
    read: picker => picker.skinTone,
    write: (picker, next) => modifyFields(picker, { skinTone: () => next }),
    choose: (appearance, value) =>
      Option.match(readAs(SkinTone)(value), {
        onNone: () => appearance,
        onSome: skinTone =>
          modifyFields(appearance, { skinTone: () => skinTone }),
      }),
  },
  ShirtColor: {
    read: picker => picker.shirtColor,
    write: (picker, next) => modifyFields(picker, { shirtColor: () => next }),
    choose: (appearance, value) =>
      Option.match(readAs(ShirtColor)(value), {
        onNone: () => appearance,
        onSome: shirtColor =>
          modifyFields(appearance, { shirtColor: () => shirtColor }),
      }),
  },
  Outfit: {
    read: picker => picker.outfit,
    write: (picker, next) => modifyFields(picker, { outfit: () => next }),
    choose: (appearance, value) =>
      Option.match(readAs(Outfit)(value), {
        onNone: () => appearance,
        onSome: outfit => modifyFields(appearance, { outfit: () => outfit }),
      }),
  },
  Print: {
    read: picker => picker.print,
    write: (picker, next) => modifyFields(picker, { print: () => next }),
    choose: (appearance, value) =>
      Option.match(readAs(Print)(value), {
        onNone: () => appearance,
        onSome: print => modifyFields(appearance, { print: () => print }),
      }),
  },
  FacialHair: {
    read: picker => picker.facialHair,
    write: (picker, next) => modifyFields(picker, { facialHair: () => next }),
    choose: (appearance, value) =>
      Option.match(readAs(FacialHair)(value), {
        onNone: () => appearance,
        onSome: facialHair =>
          modifyFields(appearance, { facialHair: () => facialHair }),
      }),
  },
  Makeup: {
    read: picker => picker.makeup,
    write: (picker, next) => modifyFields(picker, { makeup: () => next }),
    choose: (appearance, value) =>
      Option.match(readAs(Makeup)(value), {
        onNone: () => appearance,
        onSome: makeup => modifyFields(appearance, { makeup: () => makeup }),
      }),
  },
  Extra: {
    read: picker => picker.extra,
    write: (picker, next) => modifyFields(picker, { extra: () => next }),
    choose: (appearance, value) =>
      Option.match(readAs(Extra)(value), {
        onNone: () => appearance,
        onSome: extra => modifyFields(appearance, { extra: () => extra }),
      }),
  },
}

export const partGroupOf = (
  picker: CharacterPicker,
  part: LookPart,
): RadioGroup.Model => PARTS[part].read(picker)

export const chooseLook = (
  appearance: Appearance,
  part: LookPart,
  value: string,
): Appearance => PARTS[part].choose(appearance, value)

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<
  CharacterPicker,
  Message,
  OutMessage
>

const foldPart = (
  part: LookPart,
): Update.FoldWithOutMessage<
  CharacterPicker,
  Message,
  RadioGroup.Message,
  OutMessage
> =>
  Update.foldChild({
    update: PartRadioGroup.update,
    read: (picker: CharacterPicker) => Option.some(PARTS[part].read(picker)),
    write: PARTS[part].write,
    toParentMessage: message =>
      Message.GotPartMessage({ partId: part, message }),
    toParentOutMessage: ({ value }) => OutMessage.ChoseLook({ part, value }),
  })

const PART_FOLDS: Readonly<Record<LookPart, ReturnType<typeof foldPart>>> = {
  Body: foldPart('Body'),
  HairStyle: foldPart('HairStyle'),
  HairColor: foldPart('HairColor'),
  SkinTone: foldPart('SkinTone'),
  ShirtColor: foldPart('ShirtColor'),
  Outfit: foldPart('Outfit'),
  Print: foldPart('Print'),
  FacialHair: foldPart('FacialHair'),
  Makeup: foldPart('Makeup'),
  Extra: foldPart('Extra'),
}

// NOTE: a little tab's choice changes only which parts show. It plays no
// poof, since the look itself is the same.
const foldSection = Update.foldChild({
  update: SectionRadioGroup.update,
  read: (picker: CharacterPicker) => Option.some(picker.sections),
  write: (picker: CharacterPicker, next: RadioGroup.Model) =>
    modifyFields(picker, { sections: () => next }),
  toParentMessage: message => Message.GotSectionMessage({ message }),
  foldOutMessage:
    ({ value }) =>
    (picker: CharacterPicker) => ({
      model: modifyFields(picker, { section: () => value }),
    }),
})

export const update = (picker: CharacterPicker, message: Message) =>
  Message.match<UpdateReturn>(message, {
    GotPartMessage: ({ partId, message: groupMessage }) =>
      PART_FOLDS[partId](picker, groupMessage),
    GotSectionMessage: ({ message: groupMessage }) =>
      foldSection(picker, groupMessage),
    ClickedDiceButton: () => ({
      model: picker,
      outMessage: OutMessage.RequestedRandomLook(),
    }),
  })
