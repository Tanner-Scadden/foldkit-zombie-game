import { Clock, Data, Duration, Effect, Option, Schema, pipe } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientResponse } from 'effect/http'

import { Phase } from './model'

// BUILD

export const DEV_BUILD = 'dev'

export const RUNNING_BUILD: string = __BUILD_ID__

export const isCheckingForUpdates = (runningBuild: string): boolean =>
  runningBuild !== DEV_BUILD

export const maybeNewerBuild = (
  runningBuild: string,
  remoteBuild: string,
): Option.Option<string> =>
  remoteBuild === runningBuild ? Option.none() : Option.some(remoteBuild)

// NOTE: checks run on any quiet screen so a newer build is already known
// when the player reaches the home menu, the only screen with the chip.
export const isUpdateCheckWindow = Phase.isAnyOf([
  'Ready',
  'Preparation',
  'Paused',
  'Victory',
  'GameOver',
])

export const UPDATE_CHECK_INTERVAL = Duration.minutes(5)

// FETCH

const VERSION_FILE = 'version.json'
const FETCH_TIMEOUT = Duration.seconds(10)

const VersionFile = Schema.Struct({ build: Schema.String })

class VersionCheckError extends Data.TaggedError('VersionCheckError')<{
  readonly reason: string
}> {}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const versionUrl = (stamp: number): string => {
  const url = new URL(VERSION_FILE, document.baseURI)
  url.searchParams.set('at', String(stamp))
  return url.href
}

// NOTE: no-store and the time query both keep a stale copy from answering,
// whatever the browser or a proxy in between would cache. Trace headers stay
// off so the request is the same plain GET it always was.
const fetchVersionFile = (stamp: number) =>
  pipe(
    HttpClient.get(versionUrl(stamp)),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(VersionFile)),
    Effect.provideService(FetchHttpClient.RequestInit, { cache: 'no-store' }),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError(error => new VersionCheckError({ reason: error.message })),
  )

export const fetchRemoteBuild: Effect.Effect<string, VersionCheckError> = pipe(
  Clock.currentTimeMillis,
  Effect.flatMap(fetchVersionFile),
  Effect.map(({ build }) => build),
  Effect.timeoutOrElse({
    duration: FETCH_TIMEOUT,
    orElse: () => Effect.fail(new VersionCheckError({ reason: 'timed out' })),
  }),
)

export const reloadPage: Effect.Effect<void, VersionCheckError> = Effect.try({
  try: () => window.location.reload(),
  catch: error => new VersionCheckError({ reason: describeError(error) }),
})
