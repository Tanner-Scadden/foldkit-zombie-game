import { Option } from 'effect'
import { Update } from 'foldkit'
import {
  type Attribute,
  type ChildAttribute,
  type Html,
  type HtmlBuilder,
  createKeyedLazy,
} from 'foldkit/html'

import { Dialog } from '@foldkit/ui'

import { CLOSE_ICON } from './icons'

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

const shellView = <Message>(
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
          [
            h.Key(dialog.id),
            ...renderInfo.dialog,
            h.Class(dialogClass),
            ...dialogAttributes,
          ],
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

const NO_PANEL = (): ReadonlyArray<Html> => []

const closedShellView = <Message>(
  dialog: Dialog.Model,
  dialogClass: string,
  backdropClass: string,
  panelClass: string,
  toParentMessage: (message: Dialog.Message) => Message,
  h: HtmlBuilder<Message>,
): Html =>
  shellView(
    {
      dialog,
      dialogClass,
      backdropClass,
      panelClass,
      panelView: NO_PANEL,
      toParentMessage,
    },
    h,
  )

const lazyClosedShells = createKeyedLazy()

const isShut = (dialog: Dialog.Model): boolean =>
  !dialog.isOpen && dialog.animation.transitionState === 'Idle'

// NOTE: every menu dialog is in the view on every frame, and building even a
// closed one (its submodel boundary and Dialog's attributes) cost a run about
// a fifth of its view time. A dialog that is shut, neither open nor playing
// its leave animation, shows nothing, so it comes from a lazy slot keyed on
// its id and redraws only when its Dialog model changes, as opening does. Its
// `dialogAttributes` are left off while it is shut: they style the open
// panel, and the open view puts them back. So `toParentMessage` must be one
// function for the whole page, kept at module scope, or the slot misses.
//
// The `<dialog>` is keyed on its id, open or shut, and that is what makes
// the cache safe. A cache hit hands snabbdom the very VNode it patched last
// frame. Unkeyed, snabbdom pairs siblings by position, so when the page's
// list changed at both ends (opening co-op drops the home menu from the
// front and adds the co-op screen at the end) it built a new element for
// each cached dialog, wrote it into that shared VNode, and then removed the
// new element instead of the old one. The page kept the old dialogs while
// the cache pointed at detached copies, and the shop opened as a second
// `<dialog id="shop">` under an empty one that took every click. Keyed, a
// cached dialog is found by its id wherever it moves. `dialogs.scene.test.ts`
// holds every dialog to a key and every id to one element.
export const dialogShell = <Message>(
  shell: DialogShell<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  isShut(shell.dialog)
    ? lazyClosedShells(shell.dialog.id, closedShellView<Message>, [
        shell.dialog,
        shell.dialogClass,
        shell.backdropClass,
        shell.panelClass,
        shell.toParentMessage,
        h,
      ])
    : shellView(shell, h)

// CLOSE

type CloseButton<Message> = Readonly<{
  attributes: ReadonlyArray<Attribute<Message> | ChildAttribute>
  className: string
  label: string
}>

// NOTE: the one close button every menu dialog shares: the shop's red pixel
// X on a small face, centered in a bigger see-through button, so it looks
// small but a thumb still has a 48 px target. `className` only places it.
// `attributes` carry what it does: a Dialog's `closeButton`, or an OnClick
// for a screen that is not a Dialog, such as co-op's.
export const closeButtonView = <Message>(
  { attributes, className, label }: CloseButton<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      ...attributes,
      h.Class(`menu-close ${className}`),
      h.AriaLabel(label),
      h.AriaKeyshortcuts('Escape'),
    ],
    [
      h.span(
        [h.Class('menu-close-face'), h.AriaHidden(true)],
        [
          h.span([
            h.Class('menu-close-icon'),
            h.Style({ backgroundImage: CLOSE_ICON }),
          ]),
        ],
      ),
    ],
  )
