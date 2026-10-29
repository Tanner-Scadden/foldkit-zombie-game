import { Effect } from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { program } from './guard'

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
