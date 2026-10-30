import { Array, Option, Schema, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { type Camera, viewToWorld } from './camera'
import {
  AIM_TURN_DEGREES_PER_SECOND,
  MS_PER_SECOND,
  STICK_DEAD_ZONE,
  STICK_RADIUS_PX,
} from './constants'
import {
  ZERO_VECTOR,
  addVectors,
  clampLength,
  clientToView,
  directionBetween,
  isLeftHalf,
  normalize,
  scaleVector,
  vectorLength,
} from './geometry'
import {
  type Input,
  type Intent,
  MouseButton,
  type Player,
  type PointerDevice,
  Stick,
  type SurfaceRectangle,
  type Trigger,
  type Vector,
} from './model'

// KEYS

const UP_KEY = 'KeyW'
const DOWN_KEY = 'KeyS'
const LEFT_KEY = 'KeyA'
const RIGHT_KEY = 'KeyD'
const START_KEY = 'Enter'
const ENDLESS_KEY = 'KeyE'
const KEEP_GOING_KEY = 'KeyK'
const CHARACTER_KEY = 'KeyC'
const PAUSE_KEY = 'Escape'
const START_WAVE_KEY = 'Enter'
const RELOAD_KEY = 'KeyR'
const SWAP_KEY = 'KeyQ'
const PLACE_TRAP_KEY = 'KeyT'
const NEXT_TRAP_KEY = 'KeyG'
const MENU_KEY = 'KeyH'
const TURN_LEFT_KEY = 'ArrowLeft'
const TURN_RIGHT_KEY = 'ArrowRight'
const SNAP_UP_KEY = 'ArrowUp'
const SNAP_DOWN_KEY = 'ArrowDown'
const FIRE_KEY = 'Space'
const PREVIOUS_BUTTON_KEYS: ReadonlyArray<string> = [TURN_LEFT_KEY, SNAP_UP_KEY]
const NEXT_BUTTON_KEYS: ReadonlyArray<string> = [TURN_RIGHT_KEY, SNAP_DOWN_KEY]

export const FocusStep = Schema.Literals(['Previous', 'Next'])
export type FocusStep = typeof FocusStep.Type

export const maybeFocusStep = (code: string): Option.Option<FocusStep> => {
  if (Array.contains(PREVIOUS_BUTTON_KEYS, code)) {
    return Option.some('Previous')
  } else if (Array.contains(NEXT_BUTTON_KEYS, code)) {
    return Option.some('Next')
  } else {
    return Option.none()
  }
}

export const isMenuKey = (code: string): boolean => code === MENU_KEY

export const TrapChoice = Schema.Literals(['Place', 'Next'])
export type TrapChoice = typeof TrapChoice.Type

export const maybeTrapChoice = (code: string): Option.Option<TrapChoice> => {
  if (code === PLACE_TRAP_KEY) {
    return Option.some('Place')
  } else if (code === NEXT_TRAP_KEY) {
    return Option.some('Next')
  } else {
    return Option.none()
  }
}

export const isStartKey = (code: string): boolean => code === START_KEY

export const isEndlessKey = (code: string): boolean => code === ENDLESS_KEY

export const isKeepGoingKey = (code: string): boolean => code === KEEP_GOING_KEY

export const isCharacterKey = (code: string): boolean => code === CHARACTER_KEY

export const isPauseKey = (code: string): boolean => code === PAUSE_KEY

export const isStartWaveKey = (code: string): boolean => code === START_WAVE_KEY

export const isReloadKey = (code: string): boolean => code === RELOAD_KEY

export const isSwapKey = (code: string): boolean => code === SWAP_KEY

const axis = (isNegative: boolean, isPositive: boolean): number =>
  (isPositive ? 1 : 0) - (isNegative ? 1 : 0)

const keyboardMove = (pressedKeys: ReadonlyArray<string>): Vector =>
  pipe(
    {
      x: axis(
        Array.contains(pressedKeys, LEFT_KEY),
        Array.contains(pressedKeys, RIGHT_KEY),
      ),
      y: axis(
        Array.contains(pressedKeys, UP_KEY),
        Array.contains(pressedKeys, DOWN_KEY),
      ),
    },
    normalize,
    Option.getOrElse(() => ZERO_VECTOR),
  )

// NOTE: a keyboard alone plays the whole game. The aim heading stays where
// it was left, and Space fires along it. Up or Down snaps the heading
// straight that way, or onto the diagonal when Left or Right is held too;
// Left or Right on its own turns the heading a little at a time. Whichever
// aimed last wins: an arrow or Space makes the heading the aim until the
// pointer moves or presses again, so letting go of the keys never swings the
// player back toward the mouse.
const FULL_TURN = 2 * Math.PI

const AIM_TURN_RADIANS_PER_SECOND =
  (AIM_TURN_DEGREES_PER_SECOND / 360) * FULL_TURN

const wrapHeading = (heading: number): number =>
  heading - FULL_TURN * Math.floor((heading + Math.PI) / FULL_TURN)

const turnAxis = (pressedKeys: ReadonlyArray<string>): number =>
  axis(
    Array.contains(pressedKeys, TURN_LEFT_KEY),
    Array.contains(pressedKeys, TURN_RIGHT_KEY),
  )

const snapAxis = (pressedKeys: ReadonlyArray<string>): number =>
  axis(
    Array.contains(pressedKeys, SNAP_UP_KEY),
    Array.contains(pressedKeys, SNAP_DOWN_KEY),
  )

const maybeSnappedHeading = (
  pressedKeys: ReadonlyArray<string>,
): Option.Option<number> => {
  const snap = snapAxis(pressedKeys)
  return snap === 0
    ? Option.none()
    : Option.some(Math.atan2(snap, turnAxis(pressedKeys)))
}

const snapAim = (input: Input): Input =>
  modifyFields(input, {
    aimHeading: heading =>
      Option.getOrElse(maybeSnappedHeading(input.pressedKeys), () => heading),
  })

export const turnAim = (input: Input, deltaMs: number): Input =>
  Option.match(maybeSnappedHeading(input.pressedKeys), {
    onSome: snapped => modifyFields(input, { aimHeading: () => snapped }),
    onNone: () =>
      modifyFields(input, {
        aimHeading: heading =>
          wrapHeading(
            heading +
              (turnAxis(input.pressedKeys) *
                AIM_TURN_RADIANS_PER_SECOND *
                deltaMs) /
                MS_PER_SECOND,
          ),
      }),
  })

const AIM_KEYS: ReadonlyArray<string> = [
  TURN_LEFT_KEY,
  TURN_RIGHT_KEY,
  SNAP_UP_KEY,
  SNAP_DOWN_KEY,
  FIRE_KEY,
]

const isAimKey = (code: string): boolean => Array.contains(AIM_KEYS, code)

export const headingVector = (heading: number): Vector => ({
  x: Math.cos(heading),
  y: Math.sin(heading),
})

const keyboardAim = (input: Input): Option.Option<Vector> =>
  input.aimSource === 'Keys'
    ? Option.some(headingVector(input.aimHeading))
    : Option.none()

export const pressKey = (input: Input, code: string): Input =>
  snapAim(
    modifyFields(input, {
      pressedKeys: pressedKeys =>
        Array.contains(pressedKeys, code)
          ? pressedKeys
          : Array.append(pressedKeys, code),
      aimSource: aimSource => (isAimKey(code) ? 'Keys' : aimSource),
    }),
  )

export const releaseKey = (input: Input, code: string): Input =>
  modifyFields(input, {
    pressedKeys: Array.filter(pressedCode => pressedCode !== code),
  })

export const releaseAll = (input: Input): Input =>
  modifyFields(input, {
    pressedKeys: () => [],
    mouseButton: () => MouseButton.Released(),
    moveStick: () => Stick.Idle(),
    aimStick: () => Stick.Idle(),
  })

export const releaseSticks = (input: Input): Input =>
  modifyFields(input, {
    moveStick: () => Stick.Idle(),
    aimStick: () => Stick.Idle(),
  })

// POINTERS

export type PointerPress = Readonly<{
  pointerId: number
  device: PointerDevice
  clientX: number
  clientY: number
}>

type PointerPosition = Readonly<{
  pointerId: number
  clientX: number
  clientY: number
}>

const activateIfIdle = (stick: Stick, press: PointerPress): Stick =>
  Stick.match(stick, {
    Idle: () =>
      Stick.Active({
        pointerId: press.pointerId,
        originX: press.clientX,
        originY: press.clientY,
        currentX: press.clientX,
        currentY: press.clientY,
      }),
    Active: () => stick,
  })

const pressTouch = (
  input: Input,
  surface: SurfaceRectangle,
  press: PointerPress,
): Input => {
  if (isLeftHalf(surface, press.clientX)) {
    return modifyFields(input, {
      moveStick: stick => activateIfIdle(stick, press),
    })
  } else {
    return modifyFields(input, {
      aimStick: stick => activateIfIdle(stick, press),
      aimSource: () => 'Pointer',
    })
  }
}

const pressMouse = (
  input: Input,
  surface: SurfaceRectangle,
  press: PointerPress,
): Input =>
  modifyFields(input, {
    mouseButton: () => MouseButton.Held({ pointerId: press.pointerId }),
    maybeMouseInView: () =>
      clientToView(surface, { x: press.clientX, y: press.clientY }),
    aimSource: () => 'Pointer',
  })

export const pressPointer = (
  input: Input,
  maybeSurface: Option.Option<SurfaceRectangle>,
  press: PointerPress,
): Input =>
  Option.match(maybeSurface, {
    onNone: () => input,
    onSome: surface =>
      press.device === 'Mouse'
        ? pressMouse(input, surface, press)
        : pressTouch(input, surface, press),
  })

const moveStickPointer = (stick: Stick, position: PointerPosition): Stick =>
  Stick.match(stick, {
    Idle: () => stick,
    Active: active =>
      active.pointerId === position.pointerId
        ? Stick.Active({
            pointerId: active.pointerId,
            originX: active.originX,
            originY: active.originY,
            currentX: position.clientX,
            currentY: position.clientY,
          })
        : stick,
  })

const isMouseHeldBy = (input: Input, pointerId: number): boolean =>
  MouseButton.match(input.mouseButton, {
    Released: () => false,
    Held: held => held.pointerId === pointerId,
  })

export const movePointer = (
  input: Input,
  maybeSurface: Option.Option<SurfaceRectangle>,
  position: PointerPosition,
): Input =>
  isMouseHeldBy(input, position.pointerId)
    ? moveMouse(input, maybeSurface, {
        x: position.clientX,
        y: position.clientY,
      })
    : modifyFields(input, {
        moveStick: stick => moveStickPointer(stick, position),
        aimStick: stick => moveStickPointer(stick, position),
      })

const releaseStickPointer = (stick: Stick, pointerId: number): Stick =>
  Stick.match(stick, {
    Idle: () => stick,
    Active: active => (active.pointerId === pointerId ? Stick.Idle() : stick),
  })

const releaseMouseButton = (
  mouseButton: MouseButton,
  pointerId: number,
): MouseButton =>
  MouseButton.match(mouseButton, {
    Released: () => mouseButton,
    Held: held =>
      held.pointerId === pointerId ? MouseButton.Released() : mouseButton,
  })

export const releasePointer = (input: Input, pointerId: number): Input =>
  modifyFields(input, {
    moveStick: stick => releaseStickPointer(stick, pointerId),
    aimStick: stick => releaseStickPointer(stick, pointerId),
    mouseButton: mouseButton => releaseMouseButton(mouseButton, pointerId),
  })

export const moveMouse = (
  input: Input,
  maybeSurface: Option.Option<SurfaceRectangle>,
  client: Vector,
): Input =>
  Option.match(maybeSurface, {
    onNone: () => input,
    onSome: surface =>
      modifyFields(input, {
        maybeMouseInView: () => clientToView(surface, client),
        aimSource: () => 'Pointer',
      }),
  })

export const isTrackingPointer = (input: Input): boolean =>
  Stick.isAnyOf(['Active'])(input.moveStick) ||
  Stick.isAnyOf(['Active'])(input.aimStick) ||
  MouseButton.isAnyOf(['Held'])(input.mouseButton)

// INTENT

const stickDeflection = (stick: Stick): Vector =>
  Stick.match(stick, {
    Idle: () => ZERO_VECTOR,
    Active: ({ originX, originY, currentX, currentY }) =>
      clampLength(
        {
          x: (currentX - originX) / STICK_RADIUS_PX,
          y: (currentY - originY) / STICK_RADIUS_PX,
        },
        1,
      ),
  })

const withDeadZone = (deflection: Vector): Vector =>
  vectorLength(deflection) < STICK_DEAD_ZONE ? ZERO_VECTOR : deflection

const stickAim = (stick: Stick): Option.Option<Vector> =>
  pipe(stick, stickDeflection, withDeadZone, normalize)

const mouseAim = (
  input: Input,
  player: Player,
  camera: Camera,
): Option.Option<Vector> =>
  Option.flatMap(input.maybeMouseInView, mouseInView =>
    directionBetween(player, viewToWorld(camera, mouseInView)),
  )

const triggerOf = (input: Input): Trigger =>
  Stick.isAnyOf(['Active'])(input.aimStick) ||
  MouseButton.isAnyOf(['Held'])(input.mouseButton) ||
  Array.contains(input.pressedKeys, FIRE_KEY)
    ? 'Held'
    : 'Released'

export const deriveIntent = (
  input: Input,
  player: Player,
  camera: Camera,
): Intent => ({
  move: clampLength(
    addVectors(
      keyboardMove(input.pressedKeys),
      pipe(input.moveStick, stickDeflection, withDeadZone),
    ),
    1,
  ),
  maybeAim: pipe(
    stickAim(input.aimStick),
    Option.orElse(() => keyboardAim(input)),
    Option.orElse(() => mouseAim(input, player, camera)),
  ),
  trigger: triggerOf(input),
})

export const thumbOffset = (stick: Stick): Vector =>
  scaleVector(stickDeflection(stick), STICK_RADIUS_PX)
