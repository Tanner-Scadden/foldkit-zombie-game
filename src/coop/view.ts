import { Array, Option, Order, pipe } from 'effect'
import { Canvas, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import {
  type Lobby,
  type LobbyMember,
  MAX_PLAYERS,
  type RoomScore,
} from '@munch/netcode'

import { CLOCK_ICON, CLOSE_ICON, SHARE_ICON, TROPHY_ICON } from '../icons'
import type { Appearance } from '../model'
import {
  AWAY_ICON,
  BACK_ICON,
  CHECK_ICON,
  CODE_ICON,
  COOP_ICON,
  CROWN_ICON,
  KICK_ICON,
  LEAVE_ICON,
  LINK_ICON,
  NEW_ROOM_ICON,
  OFFLINE_ICON,
  QUICK_ICON,
  WAIT_ICON,
  portraitOf,
} from './icons'
import { Message } from './message'
import {
  type CoopProblem,
  type Model,
  type Queue,
  type Room,
  Screen,
} from './model'
import {
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type WorldState,
  playerMarks,
  secondsLeft,
} from './seam'
import {
  CODE_INPUT_ID,
  QUICK_PLAY_BUTTON_ID,
  READY_BUTTON_ID,
  ROOM_CODE_LENGTH,
  isHost,
  isInLobby,
  meIn,
} from './update'
import { CANVAS_HEIGHT, CANVAS_SCALE, CANVAS_WIDTH, worldShapes } from './world'

// INPUTS

export type ViewInputs = Readonly<{
  look: Appearance
  isKeyboard: boolean
}>

// NOTE: until each player's look rides in the lobby, a teammate wears one
// of these, by seat, and your own seat wears your own look.
const SEAT_LOOKS: Array.NonEmptyReadonlyArray<Appearance> = [
  {
    body: 'Male',
    hairStyle: 'Crop',
    hairColor: 'Brown',
    skinTone: 'Light',
    shirtColor: 'Blue',
  },
  {
    body: 'Female',
    hairStyle: 'Ponytail',
    hairColor: 'Ginger',
    skinTone: 'Tan',
    shirtColor: 'Teal',
  },
  {
    body: 'Male',
    hairStyle: 'Curls',
    hairColor: 'Black',
    skinTone: 'Deep',
    shirtColor: 'Yellow',
  },
  {
    body: 'Female',
    hairStyle: 'Long',
    hairColor: 'Pink',
    skinTone: 'Fair',
    shirtColor: 'Purple',
  },
]

const seatLook = (seat: number): Appearance =>
  Option.getOrElse(Array.get(SEAT_LOOKS, seat % SEAT_LOOKS.length), () =>
    Array.headNonEmpty(SEAT_LOOKS),
  )

const lookOf = (inputs: ViewInputs, mySeat: number, seat: number) =>
  seat === mySeat ? inputs.look : seatLook(seat)

// PIECES

const iconView = (
  className: string,
  icon: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.span([
    h.Class(className),
    h.AriaHidden(true),
    h.Style({ backgroundImage: icon }),
  ])

const keyCapView = (
  inputs: ViewInputs,
  cap: string,
  h: HtmlBuilder<Message>,
): Html =>
  inputs.isKeyboard
    ? h.span([h.Class('coop-key'), h.AriaHidden(true)], [cap])
    : h.empty

const portraitView = (
  look: Appearance,
  className: string,
  h: HtmlBuilder<Message>,
): Html => iconView(`coop-portrait ${className}`, portraitOf(look), h)

const closeButtonView = (inputs: ViewInputs, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('panel-close coop-close'),
      h.AriaLabel('Close co-op'),
      h.AriaKeyshortcuts('Escape'),
      h.OnClick(Message.ClickedCloseButton()),
    ],
    [iconView('panel-close-icon', CLOSE_ICON, h), keyCapView(inputs, 'ESC', h)],
  )

const backButtonView = (
  label: string,
  message: Message,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('coop-back'),
      h.AriaLabel(label),
      h.AriaKeyshortcuts('Escape'),
      h.OnClick(message),
    ],
    [iconView('coop-back-icon', BACK_ICON, h)],
  )

const PROBLEM_WORDS: Readonly<Record<CoopProblem, string>> = {
  Offline: 'OFFLINE',
  NoRoom: 'NO ROOM',
  Full: 'FULL',
  Started: 'STARTED',
  Busy: 'BUSY',
  NotACode: 'BAD CODE',
  Kicked: 'KICKED',
  Dropped: 'LOST',
}

const PROBLEM_LINES: Readonly<Record<CoopProblem, string>> = {
  Offline: 'Co-op needs the internet.',
  NoRoom: 'No room has that code.',
  Full: 'That room is full.',
  Started: 'That room already started.',
  Busy: 'Too many tries. Wait a moment.',
  NotACode: 'That is not a room code.',
  Kicked: 'The host kicked you.',
  Dropped: 'The connection dropped.',
}

const problemView = (
  maybeProblem: Option.Option<CoopProblem>,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(maybeProblem, {
    onNone: () => h.empty,
    onSome: problem =>
      h.p(
        [
          h.Class('coop-problem'),
          h.Role('alert'),
          h.AriaLabel(PROBLEM_LINES[problem]),
        ],
        [
          iconView('coop-problem-icon', OFFLINE_ICON, h),
          h.span([h.AriaHidden(true)], [PROBLEM_WORDS[problem]]),
        ],
      ),
  })

// HUB

const quickHeadsView = (h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class('coop-quick-heads'), h.AriaHidden(true)],
    Array.map(Array.range(0, MAX_PLAYERS - 1), seat =>
      portraitView(seatLook(seat), 'coop-quick-head', h),
    ),
  )

const hubView = (
  maybeProblem: Option.Option<CoopProblem>,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('coop-hub')],
    [
      closeButtonView(inputs, h),
      h.h2(
        [h.Class('coop-title'), h.AriaLabel('Co-op')],
        [iconView('coop-title-icon', COOP_ICON, h), h.span([], ['CO-OP'])],
      ),
      h.button(
        [
          h.Type('button'),
          h.Id(QUICK_PLAY_BUTTON_ID),
          h.Class('coop-quick'),
          h.AriaLabel('Quick play: join players anywhere'),
          h.AriaKeyshortcuts('Enter'),
          h.OnClick(Message.ClickedQuickPlayButton()),
        ],
        [
          h.span(
            [h.Class('coop-quick-face')],
            [
              iconView('coop-quick-icon', QUICK_ICON, h),
              h.span([h.Class('coop-quick-label')], ['QUICK PLAY']),
              quickHeadsView(h),
            ],
          ),
          keyCapView(inputs, 'ENTER', h),
        ],
      ),
      h.div(
        [h.Class('coop-pair')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('coop-tile coop-tile-code'),
              h.AriaLabel('Join a friend with a code'),
              h.OnClick(Message.ClickedCodeButton()),
            ],
            [
              iconView('coop-tile-icon', CODE_ICON, h),
              h.span([h.Class('coop-tile-label')], ['CODE']),
            ],
          ),
          h.button(
            [
              h.Type('button'),
              h.Class('coop-tile coop-tile-new'),
              h.AriaLabel('Make a room for friends'),
              h.OnClick(Message.ClickedCreateButton()),
            ],
            [
              iconView('coop-tile-icon', NEW_ROOM_ICON, h),
              h.span([h.Class('coop-tile-label')], ['NEW ROOM']),
            ],
          ),
        ],
      ),
      problemView(maybeProblem, h),
    ],
  )

// CODE

const slotState = (typed: string, index: number): string => {
  if (index < typed.length) {
    return 'Filled'
  } else if (index === typed.length) {
    return 'Next'
  } else {
    return 'Empty'
  }
}

const codeSlotsView = (typed: string, h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class('coop-slots'), h.AriaHidden(true)],
    Array.map(Array.range(0, ROOM_CODE_LENGTH - 1), index =>
      h.span(
        [
          h.Class('coop-slot'),
          h.DataAttribute('state', slotState(typed, index)),
        ],
        [typed.charAt(index)],
      ),
    ),
  )

const codeView = (
  typed: string,
  maybeProblem: Option.Option<CoopProblem>,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('coop-code')],
    [
      backButtonView('Back', Message.ClickedBackButton(), h),
      closeButtonView(inputs, h),
      iconView('coop-code-icon', CODE_ICON, h),
      h.form(
        [h.Class('coop-code-form'), h.OnSubmit(Message.SubmittedCode())],
        [
          h.label(
            [h.Class('coop-code-field')],
            [
              h.input([
                h.Id(CODE_INPUT_ID),
                h.Class('coop-code-input'),
                h.AriaLabel('Room code'),
                h.Type('text'),
                h.Value(typed),
                h.Autocomplete('off'),
                h.Autocapitalize('characters'),
                h.Spellcheck(false),
                h.EnterKeyHint('go'),
                h.OnInput(value => Message.UpdatedCode({ value })),
              ]),
              codeSlotsView(typed, h),
            ],
          ),
          h.button(
            [
              h.Type('submit'),
              h.Class('coop-go'),
              h.AriaLabel('Join'),
              h.Disabled(typed.length < ROOM_CODE_LENGTH),
            ],
            [iconView('coop-go-icon', QUICK_ICON, h), h.span([], ['GO'])],
          ),
        ],
      ),
      problemView(maybeProblem, h),
    ],
  )

// ASKING

const askingView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('coop-asking'), h.Role('status'), h.AriaLabel('Finding the room')],
    [
      h.span(
        [h.Class('coop-bounce'), h.AriaHidden(true)],
        Array.map(Array.range(0, 2), seat =>
          portraitView(seatLook(seat), 'coop-bounce-head', h),
        ),
      ),
    ],
  )

// QUEUE

const queueSeatView = (
  queue: Queue,
  inputs: ViewInputs,
  seat: number,
  h: HtmlBuilder<Message>,
): Html => {
  const isFilled = seat < queue.waiting
  const isMe = seat === queue.position - 1
  const name = Option.getOrElse(Array.get(queue.names, seat), () => '')
  return h.keyed('li')(
    `seat-${seat}`,
    [
      h.Class('coop-queue-seat'),
      h.DataAttribute('state', isFilled ? 'Filled' : 'Empty'),
      h.DataAttribute('me', isMe ? 'Me' : 'Other'),
    ],
    [
      isFilled
        ? portraitView(
            isMe ? inputs.look : seatLook(seat),
            'coop-queue-head',
            h,
          )
        : h.span([h.Class('coop-queue-empty'), h.AriaHidden(true)], ['?']),
      h.span([h.Class('coop-nameplate')], [isFilled ? name : '']),
    ],
  )
}

const offerView = (
  queue: Queue,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
) => {
  if (queue.offerPlayers === 0 || queue.answer === 'Waiting') {
    return h.empty
  }
  const heads = Array.map(Array.range(0, queue.offerPlayers - 1), seat =>
    portraitView(
      seat === queue.position - 1 ? inputs.look : seatLook(seat),
      seat < queue.accepted
        ? 'coop-offer-head coop-offer-yes'
        : 'coop-offer-head',
      h,
    ),
  )
  return h.div(
    [h.Class('coop-offer')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('coop-offer-start'),
          h.DataAttribute('answer', queue.answer),
          h.AriaLabel(
            `Start with ${queue.offerPlayers} players. ${queue.accepted} said yes`,
          ),
          h.AriaPressed(queue.answer === 'Accepted' ? 'true' : 'false'),
          h.OnClick(Message.ClickedAcceptOfferButton()),
        ],
        [
          h.span(
            [h.Class('coop-offer-label')],
            [`START WITH ${queue.offerPlayers}?`],
          ),
          h.span([h.Class('coop-offer-heads'), h.AriaHidden(true)], heads),
          keyCapView(inputs, 'ENTER', h),
        ],
      ),
      queue.answer === 'Accepted'
        ? h.empty
        : h.button(
            [
              h.Type('button'),
              h.Class('coop-offer-wait'),
              h.AriaLabel('Keep waiting for four'),
              h.OnClick(Message.ClickedKeepWaitingButton()),
            ],
            [iconView('coop-offer-wait-icon', WAIT_ICON, h)],
          ),
    ],
  )
}

const queueView = (
  queue: Queue,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('coop-queue')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('panel-close coop-close'),
          h.AriaLabel('Stop looking'),
          h.AriaKeyshortcuts('Escape'),
          h.OnClick(Message.ClickedCancelQueueButton()),
        ],
        [
          iconView('panel-close-icon', CLOSE_ICON, h),
          keyCapView(inputs, 'ESC', h),
        ],
      ),
      iconView('coop-queue-icon', QUICK_ICON, h),
      h.ol(
        [
          h.Class('coop-queue-seats'),
          h.AriaLabel(`${queue.waiting} of ${queue.groupSize} players here`),
        ],
        Array.map(Array.range(0, Math.max(1, queue.groupSize) - 1), seat =>
          queueSeatView(queue, inputs, seat, h),
        ),
      ),
      offerView(queue, inputs, h),
    ],
  )

// LOBBY

const roomCodeView = (code: string, h: HtmlBuilder<Message>): Html =>
  h.span(
    [
      h.Class('coop-room-code'),
      h.AriaLabel(`Room code ${code.split('').join(' ')}`),
    ],
    Array.map(code.split(''), symbol =>
      h.span([h.Class('coop-room-code-symbol'), h.AriaHidden(true)], [symbol]),
    ),
  )

const shareButtonView = (room: Room, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('coop-share'),
      h.DataAttribute('share', room.share),
      h.AriaLabel(
        room.share === 'Copied' ? 'Link copied' : 'Share the room link',
      ),
      h.OnClick(Message.ClickedShareButton()),
    ],
    [
      iconView(
        'coop-share-icon',
        room.share === 'Idle' ? SHARE_ICON : CHECK_ICON,
        h,
      ),
      iconView('coop-share-link', LINK_ICON, h),
    ],
  )

const leaveButtonView = (room: Room, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('coop-leave'),
      h.AriaLabel('Leave the room'),
      h.Disabled(room.departure === 'Leaving'),
      h.OnClick(Message.ClickedLeaveButton()),
    ],
    [iconView('coop-leave-icon', LEAVE_ICON, h)],
  )

const seatView = (
  room: Room,
  lobby: Lobby,
  inputs: ViewInputs,
  seat: number,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(
    Array.findFirst(lobby.members, member => member.slot === seat),
    {
      onNone: () =>
        h.keyed('li')(
          `seat-${seat}`,
          [
            h.Class('coop-seat'),
            h.DataAttribute('state', 'Empty'),
            h.AriaLabel('Empty seat'),
          ],
          [h.span([h.Class('coop-seat-empty'), h.AriaHidden(true)], ['+'])],
        ),
      onSome: member => memberSeatView(room, lobby, inputs, member, h),
    },
  )

const memberSeatView = (
  room: Room,
  lobby: Lobby,
  inputs: ViewInputs,
  member: LobbyMember,
  h: HtmlBuilder<Message>,
): Html => {
  const isMe = Option.exists(room.maybePlayerId, id => id === member.playerId)
  const isTheHost = lobby.host === member.playerId
  const canKick = isHost(room) && !isMe && lobby.status === 'Lobby'
  const label = `${member.name}${isMe ? ', you' : ''}${isTheHost ? ', host' : ''}${member.ready ? ', ready' : ''}`
  return h.keyed('li')(
    member.playerId,
    [
      h.Class('coop-seat'),
      h.DataAttribute('state', member.ready ? 'Ready' : 'Here'),
      h.DataAttribute('me', isMe ? 'Me' : 'Other'),
      h.AriaLabel(label),
    ],
    [
      portraitView(lookOf(inputs, room.slot, member.slot), 'coop-seat-head', h),
      isTheHost ? iconView('coop-crown', CROWN_ICON, h) : h.empty,
      member.ready
        ? h.span(
            [h.Class('coop-stamp'), h.AriaHidden(true)],
            [iconView('coop-stamp-icon', CHECK_ICON, h)],
          )
        : h.empty,
      h.span([h.Class('coop-nameplate'), h.AriaHidden(true)], [member.name]),
      canKick
        ? h.button(
            [
              h.Type('button'),
              h.Class('coop-kick'),
              h.AriaLabel(`Kick ${member.name}`),
              h.OnClick(
                Message.ClickedKickButton({ playerId: member.playerId }),
              ),
            ],
            [iconView('coop-kick-icon', KICK_ICON, h)],
          )
        : h.empty,
    ],
  )
}

const resultView = (
  room: Room,
  lobby: Lobby,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(lobby.result, {
    onNone: () => h.empty,
    onSome: result =>
      h.div(
        [h.Class('coop-result'), h.AriaLabel('Last run')],
        [
          iconView('coop-result-icon', TROPHY_ICON, h),
          h.ol(
            [h.Class('coop-result-scores')],
            pipe(
              result.scores,
              Array.sort(BY_SCORE_DESCENDING),
              Array.map(score =>
                h.keyed('li')(
                  score.playerId,
                  [
                    h.Class('coop-result-score'),
                    h.AriaLabel(`${nameAt(lobby, score.slot)}: ${score.score}`),
                  ],
                  [
                    portraitView(
                      lookOf(inputs, room.slot, score.slot),
                      'coop-result-head',
                      h,
                    ),
                    h.span([h.AriaHidden(true)], [`${score.score}`]),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
  })

const BY_SCORE_DESCENDING = Order.flip(
  Order.mapInput(Order.Number, (score: RoomScore) => score.score),
)

const nameAt = (lobby: Lobby, slot: number): string =>
  Option.match(
    Array.findFirst(lobby.members, member => member.slot === slot),
    { onNone: () => `Player ${slot + 1}`, onSome: member => member.name },
  )

const readyButtonView = (
  room: Room,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html => {
  const isReady = Option.exists(meIn(room), me => me.ready)
  return h.button(
    [
      h.Type('button'),
      h.Id(READY_BUTTON_ID),
      h.Class('coop-ready'),
      h.DataAttribute('ready', isReady ? 'Ready' : 'NotReady'),
      h.AriaPressed(isReady ? 'true' : 'false'),
      h.AriaKeyshortcuts('Enter'),
      h.Disabled(Option.isNone(meIn(room))),
      h.OnClick(Message.ClickedReadyButton()),
    ],
    [
      h.span(
        [h.Class('coop-ready-face')],
        [
          iconView('coop-ready-icon', CHECK_ICON, h),
          h.span([h.Class('coop-ready-label')], ['READY']),
        ],
      ),
      keyCapView(inputs, 'ENTER', h),
    ],
  )
}

const lobbyView = (
  room: Room,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('coop-lobby')],
    [
      h.div(
        [h.Class('coop-lobby-top')],
        [
          leaveButtonView(room, h),
          roomCodeView(room.code, h),
          shareButtonView(room, h),
        ],
      ),
      Option.match(room.maybeLobby, {
        onNone: () => askingView(h),
        onSome: lobby =>
          h.ol(
            [h.Class('coop-seats'), h.AriaLabel('Players')],
            Array.map(Array.range(0, MAX_PLAYERS - 1), seat =>
              seatView(room, lobby, inputs, seat, h),
            ),
          ),
      }),
      Option.match(room.maybeLobby, {
        onNone: () => h.empty,
        onSome: lobby => resultView(room, lobby, inputs, h),
      }),
      readyButtonView(room, inputs, h),
    ],
  )

// ARENA

const toWorldPoint = (point: Readonly<{ x: number; y: number }>) => ({
  x: point.x / CANVAS_SCALE,
  y: point.y / CANVAS_SCALE,
})

const percent = (part: number, whole: number): string =>
  `${(part * 100) / whole}%`

const nameplatesView = (
  room: Room,
  world: WorldState,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('coop-plates'), h.AriaHidden(true)],
    Array.map(playerMarks(world), mark =>
      h.keyed('span')(
        `plate-${mark.slot}`,
        [
          h.Class('coop-plate'),
          h.DataAttribute('me', mark.slot === room.slot ? 'Me' : 'Other'),
          h.DataAttribute('away', mark.isAway ? 'Away' : 'Here'),
          h.Style({
            left: percent(mark.x, WORLD_WIDTH),
            top: percent(mark.y, WORLD_HEIGHT),
          }),
        ],
        [
          mark.isAway ? iconView('coop-plate-away', AWAY_ICON, h) : h.empty,
          Option.match(room.maybeLobby, {
            onNone: () => `Player ${mark.slot + 1}`,
            onSome: lobby => nameAt(lobby, mark.slot),
          }),
          h.span([h.Class('coop-plate-score')], [`${mark.score}`]),
        ],
      ),
    ),
  )

const countdownView = (room: Room, h: HtmlBuilder<Message>): Html =>
  h.keyed('div')(
    `countdown-${Option.match(room.maybeLobby, { onNone: () => 0, onSome: lobby => lobby.round })}`,
    [h.Class('coop-countdown'), h.AriaHidden(true)],
    Array.map(['3', '2', '1', 'GO!'], (word, index) =>
      h.keyed('span')(
        word,
        [
          h.Class('coop-countdown-word'),
          h.Style({ animationDelay: `${index * 0.6}s` }),
        ],
        [word],
      ),
    ),
  )

const awayView = (room: Room, h: HtmlBuilder<Message>): Html =>
  room.link === 'Reconnecting'
    ? h.div(
        [h.Class('coop-away'), h.Role('status'), h.AriaLabel('Reconnecting')],
        [iconView('coop-away-icon', AWAY_ICON, h)],
      )
    : h.empty

const endedView = (room: Room, h: HtmlBuilder<Message>): Html =>
  room.session.phase._tag === 'Ended'
    ? h.div(
        [h.Class('coop-ended'), h.Role('status'), h.AriaLabel('Run over')],
        [iconView('coop-ended-icon', TROPHY_ICON, h)],
      )
    : h.empty

const arenaHudView = (
  room: Room,
  maybeWorld: Option.Option<WorldState>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('coop-arena-hud')],
    [
      leaveButtonView(room, h),
      Option.match(maybeWorld, {
        onNone: () => h.empty,
        onSome: world =>
          h.span(
            [
              h.Class('coop-timer'),
              h.AriaLabel(`${secondsLeft(world)} seconds left`),
            ],
            [
              iconView('coop-timer-icon', CLOCK_ICON, h),
              `${secondsLeft(world)}`,
            ],
          ),
      }),
    ],
  )

const arenaView = (
  room: Room,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('coop-arena')],
    [
      h.div(
        [h.Class('coop-arena-frame')],
        [
          Canvas.view(
            {
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              className: 'coop-arena-canvas',
              shapes: Option.match(room.maybeWorld, {
                onNone: () => [],
                onSome: world =>
                  worldShapes(
                    world,
                    seat => lookOf(inputs, room.slot, seat),
                    room.session.renderedMs,
                  ),
              }),
              onPointerDown: point =>
                Message.PressedArena({ point: toWorldPoint(point) }),
              onPointerMove: point =>
                Message.MovedArena({ point: toWorldPoint(point) }),
              onPointerUp: () => Message.ReleasedArena(),
            },
            h,
          ),
          Option.match(room.maybeWorld, {
            onNone: () => h.empty,
            onSome: world => nameplatesView(room, world, h),
          }),
          countdownView(room, h),
          awayView(room, h),
          endedView(room, h),
        ],
      ),
      arenaHudView(room, room.maybeWorld, h),
    ],
  )

const roomView = (
  room: Room,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  isInLobby(room) ? lobbyView(room, inputs, h) : arenaView(room, inputs, h)

// VIEW

const screenName = (model: Model): string =>
  Screen.match(model.screen, {
    Closed: () => 'Closed',
    Hub: () => 'Hub',
    Code: () => 'Code',
    Asking: () => 'Asking',
    Queue: () => 'Queue',
    InRoom: ({ room }) => (isInLobby(room) ? 'Lobby' : 'Arena'),
  })

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, inputs, h) =>
    Screen.isAnyOf(['Closed'])(model.screen)
      ? h.empty
      : h.section(
          [
            h.Class('coop'),
            h.DataAttribute('screen', screenName(model)),
            h.AriaLabel('Co-op'),
          ],
          [
            Screen.match(model.screen, {
              Closed: () => h.empty,
              Hub: ({ maybeProblem }) => hubView(maybeProblem, inputs, h),
              Code: ({ typed, maybeProblem }) =>
                codeView(typed, maybeProblem, inputs, h),
              Asking: () => askingView(h),
              Queue: ({ queue }) => queueView(queue, inputs, h),
              InRoom: ({ room }) => roomView(room, inputs, h),
            }),
          ],
        ),
)
