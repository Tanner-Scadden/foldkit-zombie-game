import { Option } from 'effect'
import { Mount, Subscription, given, scene, tap } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS } from './constants'
import { Message } from './message'
import { type Model, Phase, type PlannedSpawn, initialModel } from './model'
import { MeasureGameSurface } from './mount'
import { ROOT, SCENE_SUBSCRIPTIONS } from './testing'
import { asVeteran } from './veteran'

// NOTE: a lazy view (`createLazy`, `createKeyedLazy`, the shut dialog cache)
// hands snabbdom the very VNode it patched last frame. Snabbdom pairs
// unkeyed siblings by position, so when such a list changes it can build a
// new element for the cached VNode, write it into that shared VNode, and
// remove the new element instead of the old one: the page keeps a stale
// copy while the cache points at a detached one. That is how co-op once
// left two shop dialogs in the page. These tests render two frames and hold
// every VNode the second frame reuses from the first to a key.

type VNodeLike = Readonly<{
  sel?: string | undefined
  key?: PropertyKey | undefined
  children?: ReadonlyArray<VNodeLike | string> | undefined
}>

const nodesOf = (root: VNodeLike): ReadonlyArray<VNodeLike> => {
  const found: Array<VNodeLike> = []
  const visit = (node: VNodeLike | string) => {
    if (typeof node === 'string') {
      return
    }
    found.push(node)
    node.children?.forEach(visit)
  }
  visit(root)
  return found
}

// NOTE: the VNodes of `next` that are the very objects of `previous`, at the
// top of each reused subtree (snabbdom skips what is under one).
const reusedRoots = (
  previous: VNodeLike,
  next: VNodeLike,
): ReadonlyArray<VNodeLike> => {
  const before = new Set(nodesOf(previous))
  const found: Array<VNodeLike> = []
  const visit = (node: VNodeLike | string) => {
    if (typeof node === 'string') {
      return
    }
    if (before.has(node)) {
      found.push(node)
      return
    }
    node.children?.forEach(visit)
  }
  visit(next)
  return found
}

const describeNode = (node: VNodeLike): string => node.sel ?? '(text)'

// NOTE: renders the model, then one more frame, and hands back the reused
// VNodes' keys and the selectors of any reused VNode without one.
const reuseAcrossAFrame = (
  model: Model,
  surface: typeof LANDSCAPE,
): Readonly<{
  keys: ReadonlyArray<string>
  unkeyed: ReadonlyArray<string>
}> => {
  const frames: Array<VNodeLike> = []
  const keep = tap<Model, Message>(({ html }) => {
    frames.push(html)
  })
  scene(
    ROOT,
    given(model),
    Mount.resolve(MeasureGameSurface, Message.MeasuredGameSurface(surface)),
    keep,
    Subscription.emit(
      SCENE_SUBSCRIPTIONS.frame,
      Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
    ),
    keep,
  )
  const [previous, next] = frames
  if (previous === undefined || next === undefined) {
    throw new Error('Expected two frames')
  }
  const reused = reusedRoots(previous, next)
  return {
    keys: reused.flatMap(node =>
      typeof node.key === 'string' ? [node.key] : [],
    ),
    unkeyed: reused.filter(node => node.key === undefined).map(describeNode),
  }
}

const LANDSCAPE = { left: 0, top: 0, width: 844, height: 390 }
const PORTRAIT = { left: 0, top: 0, width: 390, height: 844 }

const DISTANT_SPAWN: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
}

const home: Model = modifyFields(asVeteran(initialModel), {
  saveStatus: () => 'Read',
})

const fighting: Model = modifyFields(asVeteran(initialModel), {
  lastDevice: () => 'Touch',
  phase: () =>
    Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
})

const inPortrait = (model: Model): Model =>
  modifyFields(model, {
    orientation: () => 'Portrait',
    maybeSurface: () => Option.some(PORTRAIT),
  })

describe('cached VNodes', () => {
  test('on the home menu, every VNode a frame reuses is keyed', () => {
    const { keys, unkeyed } = reuseAcrossAFrame(home, LANDSCAPE)
    expect(unkeyed).toEqual([])
    expect(keys).toEqual(
      expect.arrayContaining(['room-layer', 'decal-layer', 'sprite-warm-up']),
    )
  })

  test('in a landscape fight, every VNode a frame reuses is keyed', () => {
    const { keys, unkeyed } = reuseAcrossAFrame(fighting, LANDSCAPE)
    expect(unkeyed).toEqual([])
    expect(keys).toEqual(
      expect.arrayContaining(['room-layer', 'sprite-warm-up', 'shop']),
    )
  })

  test('in a portrait fight, the thumb area and every other reused VNode is keyed', () => {
    const { keys, unkeyed } = reuseAcrossAFrame(inPortrait(fighting), PORTRAIT)
    expect(unkeyed).toEqual([])
    expect(keys).toEqual(
      expect.arrayContaining(['room-layer', 'sprite-warm-up', 'thumb-area']),
    )
  })
})
