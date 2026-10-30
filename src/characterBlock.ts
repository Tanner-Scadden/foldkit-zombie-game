import { Block } from 'foldkit'

import { CharacterComposition, init, update } from './character'
import { view } from './characterView'
import type { CharacterPicker } from './model'

const prepare = () => CharacterComposition.prepareBlock({ init, update, view })
export const CharacterBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof CharacterPicker,
  typeof prepare
> = Block.assemble(prepare)
