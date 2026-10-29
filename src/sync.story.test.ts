import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  Message,
  RedeemLinkCode,
  ReloadSyncedSave,
  RequestLinkCode,
  WriteSave,
  update,
} from './main'
import { Loading, type Model, initialModel } from './model'
import {
  LinkFlow,
  PlayerChange,
  SyncState,
  changesBetween,
  syncStateText,
} from './playerSync'
import { type PlayerSave, saveOf } from './save'

const read: Model = modifyFields(initialModel, {
  loading: () => Loading.Loaded(),
  saveStatus: () => 'Read',
})

const fromAnotherDevice = (base: Model): PlayerSave => {
  const save = saveOf(base)
  return {
    ...save,
    appearance: { ...save.appearance, shirtColor: 'Purple', hairColor: 'Pink' },
    settings: { ...save.settings, music: 'Off' },
    bests: {
      ...save.bests,
      runsPlayed: 9,
      totalKills: 400,
      killsByKind: { Shambler: 390, Tank: 10 },
    },
  }
}

describe('a save from another device', () => {
  test('replaces the look, settings, and bests, and writes nothing back', () => {
    const synced = fromAnotherDevice(read)
    story(
      update,
      given(read),
      message(Message.UpdatedSyncedSave({ save: synced })),
      model(current => {
        expect(current.appearance.shirtColor).toBe('Purple')
        expect(current.musicSetting).toBe('Off')
        expect(current.bests.runsPlayed).toBe(9)
        expect(current.bests.killsByKind.Shambler).toBe(390)
        expect(current.bests.killsByKind.Tank).toBe(10)
      }),
      Command.expectNone(),
    )
  })

  test('a change after it writes only that change', () => {
    const synced = fromAnotherDevice(read)
    const afterSync = modifyFields(read, {
      appearance: () => synced.appearance,
      musicSetting: () => 'Off',
    })
    story(
      update,
      given(read),
      message(Message.UpdatedSyncedSave({ save: synced })),
      message(Message.ClickedMuteButton()),
      Command.expectHas(
        WriteSave({
          save: saveOf(
            modifyFields(afterSync, {
              soundSetting: () => 'Muted',
              bests: () => ({
                ...read.bests,
                runsPlayed: 9,
                totalKills: 400,
                killsByKind: {
                  ...read.bests.killsByKind,
                  Shambler: 390,
                  Tank: 10,
                },
              }),
            }),
          ),
          changes: [
            PlayerChange.ChangedSettings({
              settings: { ...synced.settings, sound: 'Muted' },
            }),
          ],
        }),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })
})

describe('a save from sync during a write', () => {
  test('waits for the write, then reads the store again', () => {
    const synced = fromAnotherDevice(read)
    story(
      update,
      given(
        modifyFields(read, {
          soundSetting: () => 'Muted',
          writesInFlight: () => 1,
        }),
      ),
      message(Message.UpdatedSyncedSave({ save: synced })),
      model(current => {
        expect(current.soundSetting).toBe('Muted')
        expect(current.musicSetting).toBe('On')
        expect(current.syncedSave).toBe('Stale')
      }),
      message(Message.CompletedWriteSave()),
      model(current => {
        expect(current.writesInFlight).toBe(0)
        expect(current.syncedSave).toBe('Current')
      }),
      Command.resolve(
        ReloadSyncedSave,
        Message.CompletedReloadSyncedSave({
          maybeSave: Option.some({
            ...synced,
            settings: { ...synced.settings, sound: 'Muted' },
          }),
        }),
      ),
      model(current => {
        expect(current.soundSetting).toBe('Muted')
        expect(current.musicSetting).toBe('Off')
      }),
    )
  })
})

describe('the sync status line', () => {
  test('says where the save is', () => {
    story(
      update,
      given(read),
      message(
        Message.UpdatedSyncStatus({ state: SyncState.Synced({ devices: 2 }) }),
      ),
      model(current => {
        expect(syncStateText(current.syncState)).toBe(
          'Synced. Linked to 2 devices',
        )
      }),
      message(
        Message.UpdatedSyncStatus({ state: SyncState.Offline({ devices: 2 }) }),
      ),
      model(current => {
        expect(syncStateText(current.syncState)).toBe('Offline, will sync')
      }),
    )
    expect(syncStateText(SyncState.Synced({ devices: 1 }))).toBe('Synced')
    expect(syncStateText(SyncState.LocalOnly())).toBe('Saved on this device')
  })
})

describe('linking a device', () => {
  test('Link another device asks for a code and shows it', () => {
    story(
      update,
      given(read),
      message(Message.ClickedLinkDeviceButton()),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Requesting())
      }),
      Command.expectExact(RequestLinkCode()),
      Command.resolve(
        RequestLinkCode,
        Message.SucceededRequestLinkCode({ code: 'ABC234' }),
      ),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Showing({ code: 'ABC234' }))
      }),
      message(Message.ClickedCancelLinkButton()),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Idle())
      }),
    )
  })

  test('Use a code sends what was typed, in capitals', () => {
    story(
      update,
      given(read),
      message(Message.ClickedUseCodeButton()),
      message(Message.UpdatedLinkCode({ value: 'abc234' })),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Entering({ code: 'ABC234' }))
      }),
      message(Message.SubmittedLinkCode()),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Redeeming({ code: 'ABC234' }))
      }),
      Command.expectExact(RedeemLinkCode({ code: 'ABC234' })),
      Command.resolve(
        RedeemLinkCode,
        Message.FailedRedeemLinkCode({ problem: 'WrongCode' }),
      ),
      model(current => {
        expect(current.linkFlow).toEqual(
          LinkFlow.Failed({ problem: 'WrongCode' }),
        )
      }),
      message(Message.UpdatedLinkCode({ value: 'xyz789' })),
      message(Message.SubmittedLinkCode()),
      Command.resolve(RedeemLinkCode, Message.SucceededRedeemLinkCode()),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Linked())
      }),
    )
  })

  test('submitting with nothing to submit does nothing', () => {
    story(
      update,
      given(read),
      message(Message.SubmittedLinkCode()),
      Command.expectNone(),
      model(current => {
        expect(current.linkFlow).toEqual(LinkFlow.Idle())
      }),
    )
  })
})

describe('changes as mutations', () => {
  test('a run, a new look, and an unlock become their own mutations, in order', () => {
    const before = saveOf(read)
    const after: PlayerSave = {
      ...before,
      appearance: {
        ...before.appearance,
        body: before.appearance.body === 'Male' ? 'Female' : 'Male',
      },
      difficulty: { chosen: 'Nightmare', card: 'Seen', nightmare: 'Unlocked' },
      bests: {
        ...before.bests,
        runsPlayed: before.bests.runsPlayed + 1,
        totalKills: before.bests.totalKills + 5,
        killsByKind: { Runner: 5 },
        byDifficulty: {
          ...before.bests.byDifficulty,
          Hard: { fastestWinMs: 500_000, bestEndlessWave: null },
        },
      },
    }
    expect(
      Array.from(changesBetween(before, after), change => change._tag),
    ).toEqual([
      'ChangedAppearance',
      'UnlockedNightmare',
      'ChangedDifficulty',
      'RecordedRun',
    ])
    expect(changesBetween(before, before)).toEqual([])
    expect(Option.isNone(Option.none())).toBe(true)
  })
})
