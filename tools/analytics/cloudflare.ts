import {
  Array,
  Config,
  Data,
  Effect,
  Option,
  Redacted,
  Schema,
  String,
  pipe,
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

// NOTE: the report reads D1 through the Cloudflare REST API with the same
// credentials as a local deploy: CLOUDFLARE_API_TOKEN, or else the token in
// the macOS keychain under cloudflare-api-token, and CLOUDFLARE_ACCOUNT_ID,
// or else the token's only account. The token is never printed.

const API = 'https://api.cloudflare.com/client/v4'
const KEYCHAIN_SERVICE = 'cloudflare-api-token'
const PRODUCTION_STAGE = 'prod'

export class CloudflareError extends Data.TaggedError('CloudflareError')<{
  readonly reason: string
}> {}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : globalThis.String(error)

export const databaseName = (stage: string): string =>
  stage === PRODUCTION_STAGE
    ? 'munch-manor-analytics'
    : `munch-manor-analytics-${stage}`

// CREDENTIALS

const keychainToken = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* spawner
    .string(
      ChildProcess.make('security', [
        'find-generic-password',
        '-s',
        KEYCHAIN_SERVICE,
        '-w',
      ]),
    )
    .pipe(
      Effect.map(String.trim),
      Effect.filterOrFail(
        token => token !== '',
        () => new CloudflareError({ reason: 'the keychain token is empty' }),
      ),
      Effect.mapError(
        () =>
          new CloudflareError({
            reason: `set CLOUDFLARE_API_TOKEN or add ${KEYCHAIN_SERVICE} to the keychain`,
          }),
      ),
    )
})

export const apiToken = pipe(
  Config.option(Config.Redacted('CLOUDFLARE_API_TOKEN')),
  Effect.mapError(error => new CloudflareError({ reason: describe(error) })),
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.map(keychainToken, Redacted.make),
      onSome: Effect.succeed,
    }),
  ),
)

// REQUESTS

const Envelope = <S extends Schema.Top>(result: S) =>
  Schema.Struct({
    success: Schema.Boolean,
    errors: Schema.Array(Schema.Struct({ message: Schema.String })),
    result: Schema.NullOr(result),
  })

const request = <S extends Schema.Top>(
  token: Redacted.Redacted<string>,
  path: string,
  result: S,
  init: RequestInit = {},
) =>
  pipe(
    Effect.tryPromise({
      try: signal =>
        fetch(`${API}${path}`, {
          ...init,
          signal,
          headers: {
            Authorization: `Bearer ${Redacted.value(token)}`,
            'Content-Type': 'application/json',
          },
        }).then(response => response.json()),
      catch: error => new CloudflareError({ reason: describe(error) }),
    }),
    Effect.flatMap(json =>
      Effect.mapError(
        Schema.decodeUnknownEffect(Envelope(result))(json),
        error => new CloudflareError({ reason: error.message }),
      ),
    ),
    Effect.flatMap(envelope =>
      envelope.success && envelope.result !== null
        ? Effect.succeed(envelope.result)
        : Effect.fail(
            new CloudflareError({
              reason: Array.join(
                Array.map(envelope.errors, ({ message }) => message),
                '; ',
              ),
            }),
          ),
    ),
  )

const Account = Schema.Struct({ id: Schema.String, name: Schema.String })

export const accountId = (token: Redacted.Redacted<string>) =>
  pipe(
    Config.option(Config.String('CLOUDFLARE_ACCOUNT_ID')),
    Effect.mapError(error => new CloudflareError({ reason: describe(error) })),
    Effect.flatMap(
      Option.match({
        onSome: Effect.succeed,
        onNone: () =>
          pipe(
            request(token, '/accounts', Schema.Array(Account)),
            Effect.flatMap(accounts =>
              Option.match(Array.head(accounts), {
                onNone: () =>
                  Effect.fail(new CloudflareError({ reason: 'no account' })),
                onSome: ({ id }) => Effect.succeed(id),
              }),
            ),
          ),
      }),
    ),
  )

const DatabaseInfo = Schema.Struct({
  uuid: Schema.String,
  name: Schema.String,
})

export const databaseId = (
  token: Redacted.Redacted<string>,
  account: string,
  name: string,
) =>
  pipe(
    request(
      token,
      `/accounts/${account}/d1/database?name=${encodeURIComponent(name)}`,
      Schema.Array(DatabaseInfo),
    ),
    Effect.flatMap(databases =>
      Option.match(
        Array.findFirst(databases, database => database.name === name),
        {
          onNone: () =>
            Effect.fail(
              new CloudflareError({ reason: `no D1 database named ${name}` }),
            ),
          onSome: ({ uuid }) => Effect.succeed(uuid),
        },
      ),
    ),
  )

const QueryResult = Schema.Array(
  Schema.Struct({
    success: Schema.Boolean,
    results: Schema.Array(Schema.Unknown),
  }),
)

export const query = <S extends Schema.Top>(
  token: Redacted.Redacted<string>,
  account: string,
  database: string,
  sql: string,
  row: S,
) =>
  pipe(
    request(
      token,
      `/accounts/${account}/d1/database/${database}/query`,
      QueryResult,
      {
        method: 'POST',
        body: JSON.stringify({ sql }),
      },
    ),
    Effect.map(results =>
      Option.match(Array.head(results), {
        onNone: () => [],
        onSome: ({ results: rows }) => rows,
      }),
    ),
    Effect.flatMap(rows =>
      Effect.mapError(
        Schema.decodeEffect(Schema.Array(row))(rows),
        error => new CloudflareError({ reason: error.message }),
      ),
    ),
  )
