import { Duration, Effect, Schedule } from 'effect'
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientRequest,
} from 'effect/http'

// NOTE: a local workerd takes a moment to listen after it spawns, so a
// request that finds nobody there is sent again every 200 ms, up to 50 more
// times. Resolves with the answer's text.
export const askWorkerd = (
  request: HttpClientRequest.HttpClientRequest,
): Promise<string> =>
  HttpClient.execute(request).pipe(
    Effect.flatMap(response => response.text),
    Effect.retry({
      schedule: Schedule.spaced(Duration.millis(200)),
      times: 50,
    }),
    Effect.provide(FetchHttpClient.layer),
    Effect.runPromise,
  )
