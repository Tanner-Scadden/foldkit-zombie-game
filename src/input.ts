import { Array, Option, Schema, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { type Camera, viewToWorld } from './camera'
import { STICK_DEAD_ZONE, STICK_RADIUS_PX } from './constants'
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
const FIRE_UP_KEY = 'ArrowUp'
const FIRE_DOWN_KEY = 'ArrowDown'
const FIRE_LEFT_KEY = 'ArrowLeft'
const FIRE_RIGHT_KEY = 'ArrowRight'
const PREVIOUS_BUTTON_KEYS: ReadonlyArray<string> = [FIRE_LEFT_KEY, FIRE_UP_KEY]
const NEXT_BUTTON_KEYS: ReadonlyArray<string> = [FIRE_RIGHT_KEY, FIRE_DOWN_KEY]

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

// NOTE: the arrow keys aim and fire in the direction held, so a keyboard
// alone plays the whole game. Two arrows together fire on the diagonal.
const keyboardAim = (
  pressedKeys: ReadonlyArray<string>,
): Option.Option<Vector> =>
  normalize({
    x: axis(
      Array.contains(pressedKeys, FIRE_LEFT_KEY),
      Array.contains(pressedKeys, FIRE_RIGHT_KEY),
    ),
    y: axis(
      Array.contains(pressedKeys, FIRE_UP_KEY),
      Array.contains(pressedKeys, FIRE_DOWN_KEY),
    ),
  })

export const pressKey = (input: Input, code: string): Input =>
  modifyFields(input, {
    pressedKeys: pressedKeys =>
      Array.contains(pressedKeys, code)
        ? pressedKeys
        : Array.append(pressedKeys, code),
  })

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
  Option.isSome(keyboardAim(input.pressedKeys))
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
    Option.orElse(() => keyboardAim(input.pressedKeys)),
    Option.orElse(() => mouseAim(input, player, camera)),
  ),
  trigger: triggerOf(input),
})

export const thumbOffset = (stick: Stick): Vector =>
  scaleVector(stickDeflection(stick), STICK_RADIUS_PX)
