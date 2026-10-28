import { Array, Option, pipe } from 'effect'
import {
  Command,
  type StorySimulation,
  given,
  message,
  model,
  story,
} from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { type SoundEffect, positionVariation } from './audio'
import { ARENA_HEIGHT, ARENA_WIDTH, ZOMBIE_MAX_HP } from './constants'
import {
  Message,
  PlaySound,
  ResumeAudio,
  managedResources,
  update,
} from './main'
import {
  AudioState,
  type Bullet,
  type Model,
  Phase,
  type Zombie,
  ZombieState,
  initialModel,
} from './model'

const SURFACE = { left: 0, top: 0, width: 800, height: 400 }
const FRAME_MS = 16
const MID_GAME_MS = 30_000
const MUZZLE_X = ARENA_WIDTH / 2 + 10
const SHOT_X = ARENA_WIDTH / 2 + 6
const SHOT_Y = ARENA_HEIGHT / 2

const readyScreen: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some(SURFACE),
})

const withAudio = (base: Model, audio: AudioState): Model =>
  modifyFields(base, { audio: () => audio })

const playing = (audio: AudioState): Model =>
  modifyFields(withAudio(readyScreen, audio), {
    phase: () => Phase.Playing(),
  })

const zombieAt = (id: number, x: number, y: number): Zombie => ({
  id,
  x,
  y,
  speed: 0,
  hp: ZOMBIE_MAX_HP,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
})

const oneHitZombieAt = (id: number, x: number, y: number): Zombie =>
  modifyFields(zombieAt(id, x, y), { hp: () => 1 })

const withOneHitZombieInFront = (base: Model): Model =>
  modifyFields(base, {
    zombies: () => [oneHitZombieAt(100, MUZZLE_X, ARENA_HEIGHT / 2)],
  })

const tick = message(Message.TickedFrame({ deltaTime: FRAME_MS }))
const pressFire = message(Message.PressedKey({ code: 'Space' }))
const pressMute = message(Message.PressedKey({ code: 'KeyM' }))

const soundsOf = (
  commands: StorySimulation<Model, Message>['commands'],
): ReadonlyArray<unknown> =>
  pipe(
    commands,
    Array.filter(command => command.name === PlaySound.name),
    Array.map(command => command.args?.['sound']),
  )

const expectSounds =
  (expected: ReadonlyArray<SoundEffect>) =>
  <StoryModel, StoryMessage, OutMessage>(
    simulation: StorySimulation<StoryModel, StoryMessage, OutMessage>,
  ): StorySimulation<StoryModel, StoryMessage, OutMessage> => {
    expect(soundsOf(simulation.commands)).toEqual(expected)
    return simulation
  }

type PlaySoundResolver = readonly [
  typeof PlaySound,
  typeof Message.CompletedPlaySound.Type,
]

const playedResolver = (sound: SoundEffect): PlaySoundResolver => [
  PlaySound,
  Message.CompletedPlaySound({ sound, outcome: 'Played' }),
]

const resolvePlayed = (sound: SoundEffect) =>
  Command.resolve(
    PlaySound,
    Message.CompletedPlaySound({ sound, outcome: 'Played' }),
  )

const resolveAllPlayed = (sounds: ReadonlyArray<SoundEffect>) =>
  Command.resolveAll(...Array.map(sounds, playedResolver))

const COMBAT_SOUNDS: ReadonlyArray<SoundEffect> = [
  'Shot',
  'ZombieHit',
  'ZombieDeath',
]

const requestsAudioEngine = (current: Model): boolean =>
  Option.isSome(managedResources.audioEngine.modelToMaybeRequirements(current))

describe('audio unlock', () => {
  test('a key press unlocks audio and the fresh round plays the start sound', () => {
    story(
      update,
      given(readyScreen),
      model(current => {
        expect(current.audio).toEqual(AudioState.Locked())
        expect(requestsAudioEngine(current)).toBe(false)
      }),
      message(Message.PressedKey({ code: 'Enter' })),
      Command.expectNone(),
      model(current => {
        expect(current.audio).toEqual(AudioState.Unlocking())
        expect(requestsAudioEngine(current)).toBe(true)
      }),
      message(Message.AcquiredAudioEngine()),
      Command.expectExact(ResumeAudio),
      Command.resolve(
        ResumeAudio,
        Message.CompletedResumeAudio({ playback: 'Running' }),
      ),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Ready())
      }),
      Command.expectExact(PlaySound({ sound: 'Start', variation: 0 })),
      resolvePlayed('Start'),
    )
  })

  test('a mouse press unlocks audio', () => {
    story(
      update,
      given(readyScreen),
      message(
        Message.PressedPointer({
          pointerId: 1,
          device: 'Mouse',
          clientX: 400,
          clientY: 200,
        }),
      ),
      Command.expectNone(),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Unlocking())
      }),
    )
  })

  test('a touch press unlocks audio and a still-suspended context retries on release', () => {
    story(
      update,
      given(readyScreen),
      message(
        Message.PressedPointer({
          pointerId: 7,
          device: 'Touch',
          clientX: 120,
          clientY: 300,
        }),
      ),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Unlocking())
      }),
      message(Message.AcquiredAudioEngine()),
      Command.resolve(
        ResumeAudio,
        Message.CompletedResumeAudio({ playback: 'Suspended' }),
      ),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Suspended())
      }),
      message(Message.ReleasedPointer({ pointerId: 7 })),
      Command.expectExact(ResumeAudio),
      Command.resolve(
        ResumeAudio,
        Message.CompletedResumeAudio({ playback: 'Running' }),
      ),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Ready())
      }),
      Command.expectExact(PlaySound({ sound: 'Start', variation: 0 })),
      resolvePlayed('Start'),
    )
  })

  test('a browser without Web Audio stays silent for good', () => {
    story(
      update,
      given(readyScreen),
      message(Message.PressedKey({ code: 'Enter' })),
      message(
        Message.FailedAcquireAudioEngine({ reason: 'AudioContext missing' }),
      ),
      model(current => {
        expect(current.audio).toEqual(AudioState.Unavailable())
        expect(requestsAudioEngine(current)).toBe(false)
      }),
      message(Message.PressedKey({ code: 'Space' })),
      tick,
      Command.expectNone(),
    )
  })
})

describe('frame sounds', () => {
  test('a frame with a shot, a hit, and a kill plays each sound once', () => {
    story(
      update,
      given(withOneHitZombieInFront(playing(AudioState.Ready()))),
      pressFire,
      Command.expectNone(),
      tick,
      Command.expectHas(
        PlaySound({
          sound: 'Shot',
          variation: positionVariation(SHOT_X, SHOT_Y),
        }),
      ),
      expectSounds(COMBAT_SOUNDS),
      resolveAllPlayed(COMBAT_SOUNDS),
    )
  })

  test('a frame where the player is touched plays the hurt sound', () => {
    story(
      update,
      given(
        modifyFields(playing(AudioState.Ready()), {
          zombies: () => [zombieAt(100, ARENA_WIDTH / 2 + 2, ARENA_HEIGHT / 2)],
        }),
      ),
      tick,
      expectSounds(['PlayerHurt']),
      resolvePlayed('PlayerHurt'),
    )
  })

  test('forty kills in one frame play one death sound', () => {
    const floodSize = 40
    const victims = Array.makeBy(floodSize, index =>
      oneHitZombieAt(
        200 + index,
        20 + (index % 10) * 30,
        20 + Math.floor(index / 10) * 40,
      ),
    )
    const killingBullets = Array.map(victims, ({ id, x, y }): Bullet => ({
      id: id + floodSize,
      x,
      y,
      velocityX: 1,
      velocityY: 0,
      remainingMs: 900,
    }))

    story(
      update,
      given(
        modifyFields(playing(AudioState.Ready()), {
          zombies: () => victims,
          bullets: () => killingBullets,
        }),
      ),
      tick,
      model(({ frameEvents }) => {
        expect(
          Array.filter(frameEvents, ({ _tag }) => _tag === 'ZombieKilled'),
        ).toHaveLength(floodSize)
      }),
      expectSounds(['ZombieHit', 'ZombieDeath']),
      resolveAllPlayed(['ZombieHit', 'ZombieDeath']),
    )
  })

  test('no sound Commands while audio is locked, unlocking, suspended, or unavailable', () => {
    const silentStates = [
      AudioState.Locked(),
      AudioState.Unlocking(),
      AudioState.Suspended(),
      AudioState.Unavailable(),
    ]
    const bulletAtZombie: Bullet = {
      id: 1,
      x: MUZZLE_X,
      y: ARENA_HEIGHT / 2,
      velocityX: 1,
      velocityY: 0,
      remainingMs: 900,
    }
    Array.forEach(silentStates, audio => {
      story(
        update,
        given(
          modifyFields(withOneHitZombieInFront(playing(audio)), {
            bullets: () => [bulletAtZombie],
          }),
        ),
        tick,
        model(({ frameEvents }) => {
          expect(Array.map(frameEvents, ({ _tag }) => _tag)).toEqual([
            'ZombieHit',
            'ZombieKilled',
          ])
        }),
        Command.expectNone(),
      )
    })
  })

  test('a muted game plays no sounds', () => {
    story(
      update,
      given(withOneHitZombieInFront(playing(AudioState.Ready()))),
      pressMute,
      model(({ soundSetting }) => {
        expect(soundSetting).toBe('Muted')
      }),
      pressFire,
      tick,
      model(({ frameEvents }) => {
        expect(Array.isReadonlyArrayNonEmpty(frameEvents)).toBe(true)
      }),
      Command.expectNone(),
    )
  })

  test('M turns a muted game back on', () => {
    story(
      update,
      given(
        modifyFields(withOneHitZombieInFront(playing(AudioState.Ready())), {
          soundSetting: () => 'Muted',
        }),
      ),
      pressMute,
      model(({ soundSetting }) => {
        expect(soundSetting).toBe('On')
      }),
      pressFire,
      tick,
      expectSounds(COMBAT_SOUNDS),
      resolveAllPlayed(COMBAT_SOUNDS),
    )
  })

  test('the mute button toggles the setting and unlocks audio', () => {
    story(
      update,
      given(playing(AudioState.Locked())),
      message(Message.ClickedMuteButton()),
      model(({ soundSetting, audio }) => {
        expect(soundSetting).toBe('Muted')
        expect(audio).toEqual(AudioState.Unlocking())
      }),
      message(Message.ClickedMuteButton()),
      model(({ soundSetting }) => {
        expect(soundSetting).toBe('On')
      }),
    )
  })

  test('a context the browser suspends mid-game waits for the next press', () => {
    story(
      update,
      given(
        modifyFields(withOneHitZombieInFront(playing(AudioState.Ready())), {
          elapsedMs: () => MID_GAME_MS,
        }),
      ),
      pressFire,
      tick,
      Command.resolveAll(
        ...Array.map(COMBAT_SOUNDS, (sound): PlaySoundResolver => [
          PlaySound,
          Message.CompletedPlaySound({
            sound,
            outcome: 'DroppedWhileSuspended',
          }),
        ]),
      ),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Suspended())
      }),
      message(Message.PressedKey({ code: 'KeyW' })),
      Command.expectExact(ResumeAudio),
      Command.resolve(
        ResumeAudio,
        Message.CompletedResumeAudio({ playback: 'Running' }),
      ),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Ready())
      }),
    )
  })
})
