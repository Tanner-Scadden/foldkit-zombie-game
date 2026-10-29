import { Option } from 'effect'
import { Update } from 'foldkit'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { Dialog } from '@foldkit/ui'

// UPDATE

type DialogFoldConfig<Model, Message, R> = Readonly<{
  read: (model: Model) => Dialog.Model
  write: (model: Model, nextDialog: Dialog.Model) => Model
  toParentMessage: (message: Dialog.Message) => Message
  foldOutMessage?: (
    outMessage: Dialog.OutMessage,
  ) => Update.Step<Model, Message, R>
}>

export type DialogFolds<Model, Message, R = never> = Readonly<{
  fold: Update.Fold<Model, Message, Dialog.Message, R>
  open: Update.Step<Model, Message, R>
  close: Update.Step<Model, Message, R>
}>

const ignoreOutMessage =
  <Model, Message>() =>
  (_outMessage: Dialog.OutMessage): Update.Step<Model, Message> =>
  model => ({ model })

// NOTE: one lens onto a Dialog field gives its three folds: the Dialog's own
// Messages, opening it, and closing it. Each runs `foldOutMessage` on the
// Opened and Closed OutMessages, which are ignored when it is left out.
export const dialogFolds = <Model, Message, R = never>({
  read,
  write,
  toParentMessage,
  foldOutMessage = ignoreOutMessage<Model, Message>(),
}: DialogFoldConfig<Model, Message, R>): DialogFolds<Model, Message, R> => {
  const lens = {
    read: (model: Model) => Option.some(read(model)),
    write,
    toParentMessage,
    foldOutMessage,
  }
  return {
    fold: Update.foldChild({ update: Dialog.update, ...lens }),
    open: Update.foldChildStep({ update: Dialog.open, ...lens }),
    close: Update.foldChildStep({ update: Dialog.close, ...lens }),
  }
}

// VIEW

type DialogShell<Message> = Readonly<{
  dialog: Dialog.Model
  dialogClass: string
  backdropClass: string
  panelClass: string
  dialogAttributes?: ReadonlyArray<Attribute<Message>>
  panelView: (renderInfo: Dialog.RenderInfo) => ReadonlyArray<Html>
  toParentMessage: (message: Dialog.Message) => Message
}>

export const dialogShell = <Message>(
  {
    dialog,
    dialogClass,
    backdropClass,
    panelClass,
    dialogAttributes = [],
    panelView,
    toParentMessage,
  }: DialogShell<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: dialog.id,
    model: dialog,
    view: Dialog.view,
    viewInputs: {
      hasDescription: true,
      toView: renderInfo =>
        h.dialog(
          [...renderInfo.dialog, h.Class(dialogClass), ...dialogAttributes],
          renderInfo.isVisible
            ? [
                h.div([...renderInfo.backdrop, h.Class(backdropClass)]),
                h.div(
                  [...renderInfo.panel, h.Class(panelClass)],
                  panelView(renderInfo),
                ),
              ]
            : [],
        ),
    },
    toParentMessage,
  })
