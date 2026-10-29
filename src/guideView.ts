import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Message } from './message'
import { type Model, MunchopediaPage, type ZombieKind } from './model'
import {
  BADGES,
  ENTRY_COUNT,
  type EntryFrame,
  MUNCHOPEDIA,
  type MunchopediaEntry,
  countLabel,
  discoveredKinds,
  entryFrameAt,
  entryName,
  entryOf,
  firstEntryFrame,
  isDiscovered,
  killsOf,
} from './munchopedia'

// TEXT

const UNKNOWN_NAME = '???'

export const munchopediaText = (
  model: Model,
): Readonly<{ title: string; blurb: string }> => ({
  title: 'Munchopedia',
  blurb: `${discoveredKinds(model.bests.killsByKind).length} of ${ENTRY_COUNT} discovered, ${countLabel(model.bests.totalKills)} zombies splatted`,
})

const isBoss = (kind: ZombieKind): boolean => kind === 'Boss'

const countText = (kind: ZombieKind, count: number): string =>
  isBoss(kind)
    ? `Beaten ${countLabel(count)} ${count === 1 ? 'time' : 'times'}`
    : `${countLabel(count)} splatted`

const lockedHint = (kind: ZombieKind): string =>
  isBoss(kind)
    ? 'Beat the boss at the end of the campaign to fill in this page.'
    : 'Splat one to fill in this page.'

// PICTURE

const PICTURE_PX = 64

const pictureScale = (frame: EntryFrame): number =>
  Math.max(1, Math.floor(PICTURE_PX / frame.height))

const pictureView = (
  maybeFrame: Option.Option<EntryFrame>,
  isKnown: boolean,
  altText: string,
  className: string,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(maybeFrame, {
    onNone: () => h.span([h.Class(className)]),
    onSome: frame =>
      h.img([
        h.Class(className),
        h.Src(frame.src),
        h.Alt(altText),
        h.DataAttribute('known', isKnown ? 'Known' : 'Unknown'),
        h.Style({
          width: `${frame.width * pictureScale(frame)}px`,
          height: `${frame.height * pictureScale(frame)}px`,
        }),
      ]),
  })

const pictureAlt = (kind: ZombieKind, isKnown: boolean): string =>
  isKnown
    ? `${entryName(kind)} shuffling along and falling apart`
    : 'A dark silhouette of a zombie you have not met yet'

// LIST

const tileView = (
  model: Model,
  entry: MunchopediaEntry,
  h: HtmlBuilder<Message>,
): Html => {
  const count = killsOf(model.bests.killsByKind, entry.kind)
  const isKnown = isDiscovered(model.bests.killsByKind, entry.kind)
  const isNew = isKnown && !Array.contains(model.home.openedEntries, entry.kind)
  const name = isKnown ? entryName(entry.kind) : UNKNOWN_NAME
  return h.li(
    [h.Class('munch-tile-item')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('munch-tile'),
          h.DataAttribute('known', isKnown ? 'Known' : 'Unknown'),
          h.AriaLabel(
            isKnown
              ? `${name}, ${countText(entry.kind, count)}${isNew ? ', new entry' : ''}`
              : 'Unknown zombie, not found yet',
          ),
          h.OnClick(
            Message.ClickedMunchopediaEntryButton({ kind: entry.kind }),
            { propagation: 'Stop' },
          ),
        ],
        [
          h.span(
            [h.Class('munch-tile-picture'), h.AriaHidden(true)],
            [
              pictureView(
                firstEntryFrame(entry.kind),
                isKnown,
                '',
                'munch-sprite',
                h,
              ),
            ],
          ),
          h.span([h.Class('munch-tile-name')], [name]),
          ...(isKnown
            ? [h.span([h.Class('munch-tile-count')], [`×${countLabel(count)}`])]
            : []),
          ...(isNew
            ? [h.span([h.Class('munch-tile-new'), h.AriaHidden(true)], ['NEW'])]
            : []),
        ],
      ),
    ],
  )
}

const listView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.ul(
    [h.Class('munch-list'), h.AriaLabel('Zombies')],
    Array.map(MUNCHOPEDIA, entry => tileView(model, entry, h)),
  )

// ENTRY

const ENTRY_NAME_ID = 'munch-entry-name'

const badgeView = (count: number, h: HtmlBuilder<Message>) =>
  Array.map(BADGES, badge => {
    const isEarned = count >= badge.threshold
    return h.li(
      [
        h.Class('munch-badge'),
        h.DataAttribute('badge', badge.name),
        h.DataAttribute('earned', isEarned ? 'Earned' : 'Unearned'),
      ],
      [
        h.span([h.Class('munch-badge-count')], [countLabel(badge.threshold)]),
        h.span(
          [h.Class('sr-only')],
          [isEarned ? ` ${badge.name}, earned` : ` ${badge.name}, not yet`],
        ),
      ],
    )
  })

const knownEntryView = (
  model: Model,
  entry: MunchopediaEntry,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const count = killsOf(model.bests.killsByKind, entry.kind)
  return [
    h.p([h.Class('munch-bio')], [entry.bio]),
    h.h4([h.Class('munch-heading')], ['What it does']),
    h.p([h.Class('munch-text')], [entry.behavior]),
    h.h4([h.Class('munch-heading')], ['How to beat it']),
    h.p([h.Class('munch-text')], [entry.howToBeat]),
    h.div(
      [h.Class('munch-count-row')],
      [
        h.p([h.Class('munch-count')], [countText(entry.kind, count)]),
        h.ul(
          [h.Class('munch-badges'), h.AriaLabel('Badges')],
          badgeView(count, h),
        ),
      ],
    ),
  ]
}

const entryView = (
  model: Model,
  kind: ZombieKind,
  h: HtmlBuilder<Message>,
): Html => {
  const entry = entryOf(kind)
  const isKnown = isDiscovered(model.bests.killsByKind, kind)
  return h.article(
    [
      h.Class('munch-entry'),
      h.DataAttribute('known', isKnown ? 'Known' : 'Unknown'),
      h.AriaLabelledBy(ENTRY_NAME_ID),
    ],
    [
      h.div(
        [h.Class('munch-stage')],
        [
          pictureView(
            isKnown
              ? entryFrameAt(kind, model.screenMs)
              : firstEntryFrame(kind),
            isKnown,
            pictureAlt(kind, isKnown),
            'munch-sprite',
            h,
          ),
        ],
      ),
      h.div(
        [h.Class('munch-facts')],
        [
          h.h3(
            [h.Id(ENTRY_NAME_ID), h.Class('munch-name')],
            [isKnown ? entryName(kind) : UNKNOWN_NAME],
          ),
          ...(isKnown
            ? knownEntryView(model, entry, h)
            : [h.p([h.Class('munch-bio')], [lockedHint(kind)])]),
        ],
      ),
    ],
  )
}

// BODY

export const munchopediaBodyView = (
  model: Model,
  doneButton: Html,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  MunchopediaPage.match(model.home.munchopediaPage, {
    List: () => [
      listView(model, h),
      h.div([h.Class('panel-actions')], [doneButton]),
    ],
    Entry: ({ kind }) => [
      entryView(model, kind, h),
      h.div(
        [h.Class('panel-actions')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('panel-button munch-back'),
              h.AriaLabel('Back to every zombie'),
              h.OnClick(Message.ClickedMunchopediaListButton(), {
                propagation: 'Stop',
              }),
            ],
            ['Back'],
          ),
          doneButton,
        ],
      ),
    ],
  })
