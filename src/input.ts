import { Array, Option, Schema, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { STICK_DEAD_ZONE, STICK_RADIUS_PX } from './constants'
import {
  ZERO_VECTOR,
  addVectors,
  clampLength,
  clientToArena,
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

const UP_KEYS: ReadonlyArray<string> = ['KeyW', 'ArrowUp']
const DOWN_KEYS: ReadonlyArray<string> = ['KeyS', 'ArrowDown']
const LEFT_KEYS: ReadonlyArray<string> = ['KeyA', 'ArrowLeft']
const RIGHT_KEYS: ReadonlyArray<string> = ['KeyD', 'ArrowRight']
const FIRE_KEY = 'Space'
const START_KEYS: ReadonlyArray<string> = ['Enter', 'Space']
const ENDLESS_KEY = 'KeyE'
const KEEP_GOING_KEY = 'KeyK'
const PAUSE_KEYS: ReadonlyArray<string> = ['Escape', 'KeyP']
const START_WAVE_KEYS: ReadonlyArray<string> = ['Enter', 'KeyR']
const SWAP_KEYS: ReadonlyArray<string> = ['KeyQ', 'KeyE']
const PISTOL_KEY = 'Digit1'
const SPARE_KEY = 'Digit2'
const PLACE_TRAP_KEY = 'KeyT'
const NEXT_TRAP_KEY = 'KeyG'

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

export const WeaponChoice = Schema.Literals(['Swap', 'Pistol', 'Spare'])
export type WeaponChoice = typeof WeaponChoice.Type

export const maybeWeaponChoice = (
  code: string,
): Option.Option<WeaponChoice> => {
  if (Array.contains(SWAP_KEYS, code)) {
    return Option.some('Swap')
  } else if (code === PISTOL_KEY) {
    return Option.some('Pistol')
  } else if (code === SPARE_KEY) {
    return Option.some('Spare')
  } else {
    return Option.none()
  }
}

export const isStartKey = (code: string): boolean =>
  Array.contains(START_KEYS, code)

export const isEndlessKey = (code: string): boolean => code === ENDLESS_KEY

export const isKeepGoingKey = (code: string): boolean => code === KEEP_GOING_KEY

export const isPauseKey = (code: string): boolean =>
  Array.contains(PAUSE_KEYS, code)

export const isStartWaveKey = (code: string): boolean =>
  Array.contains(START_WAVE_KEYS, code)

const isAnyPressed = (
  pressedKeys: ReadonlyArray<string>,
  codes: ReadonlyArray<string>,
): boolean => Array.some(codes, code => Array.contains(pressedKeys, code))

const axis = (isNegative: boolean, isPositive: boolean): number =>
  (isPositive ? 1 : 0) - (isNegative ? 1 : 0)

export const keyboardMove = (pressedKeys: ReadonlyArray<string>): Vector =>
  pipe(
    {
      x: axis(
        isAnyPressed(pressedKeys, LEFT_KEYS),
        isAnyPressed(pressedKeys, RIGHT_KEYS),
      ),
      y: axis(
        isAnyPressed(pressedKeys, UP_KEYS),
        isAnyPressed(pressedKeys, DOWN_KEYS),
      ),
    },
    normalize,
    Option.getOrElse(() => ZERO_VECTOR),
  )

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

// POINTERS

export type PointerPress = Readonly<{
  pointerId: number
  device: PointerDevice
  clientX: number
  clientY: number
}>

export type PointerPosition = Readonly<{
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
    maybeMousePosition: () =>
      clientToArena(surface, { x: press.clientX, y: press.clientY }),
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

export const movePointer = (input: Input, position: PointerPosition): Input =>
  modifyFields(input, {
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
        maybeMousePosition: () => clientToArena(surface, client),
      }),
  })

export const isTrackingPointer = (input: Input): boolean =>
  Stick.guards.Active(input.moveStick) ||
  Stick.guards.Active(input.aimStick) ||
  MouseButton.guards.Held(input.mouseButton)

// INTENT

export const stickDeflection = (stick: Stick): Vector =>
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

const mouseAim = (input: Input, player: Player): Option.Option<Vector> =>
  Option.flatMap(input.maybeMousePosition, mousePosition =>
    directionBetween(player, mousePosition),
  )

const triggerOf = (input: Input): Trigger =>
  Stick.guards.Active(input.aimStick) ||
  MouseButton.guards.Held(input.mouseButton) ||
  Array.contains(input.pressedKeys, FIRE_KEY)
    ? 'Held'
    : 'Released'

export const deriveIntent = (input: Input, player: Player): Intent => ({
  move: clampLength(
    addVectors(
      keyboardMove(input.pressedKeys),
      pipe(input.moveStick, stickDeflection, withDeadZone),
    ),
    1,
  ),
  maybeAim: Option.orElse(stickAim(input.aimStick), () =>
    mouseAim(input, player),
  ),
  trigger: triggerOf(input),
})

export const thumbOffset = (stick: Stick): Vector =>
  scaleVector(stickDeflection(stick), STICK_RADIUS_PX)
