// The Durable Object bill for co-op rooms, for the cost tables in
// MULTIPLAYER.md. It plays a month of room sessions arriving through the day,
// packs them into shards (several rooms in one Durable Object), and prices
// the requests and the wall time with Cloudflare's published rates.
//   bun tools/mp-spike/cost.ts
// It is light (well under a second) and prints one JSON report.
//
// The billing rules it uses, from
// https://developers.cloudflare.com/durable-objects/platform/pricing/
// (checked 2026-10-29):
// - Workers Paid is $5 a month and includes 1 million requests and 400,000
//   GB-s; then $0.15 per million requests and $12.50 per million GB-s.
//   Billable usage above the included amount is rounded up to the next
//   million before pricing.
// - Free: 100,000 requests and 13,000 GB-s a day, then requests fail.
// - Opening a WebSocket is one request; incoming messages count 20 to 1;
//   outgoing messages and protocol pings are free.
// - Duration is wall time while the object is active and not eligible for
//   hibernation, at the 128 MB allocated (0.128 GB in Cloudflare's own
//   examples), whatever the object really uses. A shard with no room in it
//   holds no timer and hibernates, so it bills nothing.

const DAYS_PER_MONTH = 30
const GB_PER_OBJECT = 0.128
const PAID = {
  base: 5,
  includedRequests: 1_000_000,
  includedGbSeconds: 400_000,
  perMillionRequests: 0.15,
  perMillionGbSeconds: 12.5,
}
const FREE = { requestsPerDay: 100_000, gbSecondsPerDay: 13_000 }

type Scenario = Readonly<{
  name: string
  sessionsPerDay: number
  players: number
  minutes: number
  // Input messages a player sends each second, on average.
  inputsPerSecond: number
  // Rooms one Durable Object holds at once (1 is a Durable Object per room).
  roomsPerShard: number
  // Rooms in different regions never share a shard.
  regions: number
}>

// A small seeded generator (mulberry32), so every run prints the same bill.
const generator = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

// When a session starts, in seconds into the day: 60% in a six hour evening
// peak, the rest spread over the other eighteen hours.
const PEAK_START = 17 * 3600
const PEAK_SECONDS = 6 * 3600
const startOf = (random: () => number): number =>
  random() < 0.6
    ? PEAK_START + random() * PEAK_SECONDS
    : (PEAK_START + PEAK_SECONDS + random() * (86_400 - PEAK_SECONDS)) % 86_400

// Wall seconds the shards of one region bill in a day: each new room goes
// into the fullest shard with room to spare, or a new shard. A shard bills
// while it holds at least one room.
const shardSecondsOfDay = (
  starts: ReadonlyArray<number>,
  roomSeconds: number,
  roomsPerShard: number,
): number => {
  type Shard = { ends: Array<number>; busySince: number }
  const shards: Array<Shard> = []
  let billed = 0
  const sorted = [...starts].sort((a, b) => a - b)
  sorted.forEach(start => {
    shards.forEach(shard => {
      const open = shard.ends.filter(end => end > start)
      if (shard.ends.length > 0 && open.length === 0) {
        billed += Math.max(...shard.ends) - shard.busySince
      }
      shard.ends = open
    })
    const candidates = shards
      .filter(shard => shard.ends.length < roomsPerShard)
      .sort((a, b) => b.ends.length - a.ends.length)
    const chosen = candidates[0]
    if (chosen === undefined) {
      shards.push({ ends: [start + roomSeconds], busySince: start })
    } else {
      if (chosen.ends.length === 0) chosen.busySince = start
      chosen.ends.push(start + roomSeconds)
    }
  })
  shards.forEach(shard => {
    if (shard.ends.length > 0) {
      billed += Math.max(...shard.ends) - shard.busySince
    }
  })
  return billed
}

const roundUpMillions = (value: number) =>
  value <= 0 ? 0 : Math.ceil(value / 1_000_000) * 1_000_000

const bill = (scenario: Scenario) => {
  const random = generator(20_261_029)
  const roomSeconds = scenario.minutes * 60
  const requestsPerSession =
    scenario.players +
    (scenario.players * scenario.inputsPerSecond * roomSeconds) / 20 +
    // Lobby: READY toggles, look changes, and the start, as incoming
    // messages, plus a few Worker calls that are not object requests.
    10
  let objectSeconds = 0
  for (let day = 0; day < DAYS_PER_MONTH; day++) {
    const perRegion = Array.from(
      { length: scenario.regions },
      (): Array<number> => [],
    )
    for (let session = 0; session < scenario.sessionsPerDay; session++) {
      perRegion[session % scenario.regions]?.push(startOf(random))
    }
    objectSeconds += perRegion.reduce(
      (sum, starts) =>
        sum + shardSecondsOfDay(starts, roomSeconds, scenario.roomsPerShard),
      0,
    )
  }
  const sessions = scenario.sessionsPerDay * DAYS_PER_MONTH
  const requests = sessions * requestsPerSession
  const gbSeconds = objectSeconds * GB_PER_OBJECT
  const requestsCost =
    (roundUpMillions(requests - PAID.includedRequests) / 1_000_000) *
    PAID.perMillionRequests
  const durationCost =
    (roundUpMillions(gbSeconds - PAID.includedGbSeconds) / 1_000_000) *
    PAID.perMillionGbSeconds
  const gbSecondsPerSession = gbSeconds / sessions
  return {
    ...scenario,
    requestsPerSession: Math.round(requestsPerSession),
    gbSecondsPerSession: Number(gbSecondsPerSession.toFixed(1)),
    requestsPerMonth: Math.round(requests),
    gbSecondsPerMonth: Math.round(gbSeconds),
    requestsCost: Number(requestsCost.toFixed(2)),
    durationCost: Number(durationCost.toFixed(2)),
    totalPerMonth: Number((PAID.base + requestsCost + durationCost).toFixed(2)),
    // The free plan's daily ceiling for sessions like these.
    freeSessionsPerDay: Math.floor(
      Math.min(
        FREE.requestsPerDay / requestsPerSession,
        FREE.gbSecondsPerDay / gbSecondsPerSession,
      ),
    ),
    freeLimitedBy:
      FREE.requestsPerDay / requestsPerSession <
      FREE.gbSecondsPerDay / gbSecondsPerSession
        ? 'requests'
        : 'duration',
  }
}

const base = { players: 4, minutes: 10, regions: 1 } as const
const scenarios: ReadonlyArray<Scenario> = [100, 1_000].flatMap(
  sessionsPerDay => [
    {
      ...base,
      name: 'Before: 20 Hz inputs, a Durable Object per room',
      sessionsPerDay,
      inputsPerSecond: 20,
      roomsPerShard: 1,
    },
    {
      ...base,
      name: 'Inputs on change, at most 10 Hz',
      sessionsPerDay,
      inputsPerSecond: 10,
      roomsPerShard: 1,
    },
    {
      ...base,
      name: 'Inputs at 10 Hz, 6 rooms a shard',
      sessionsPerDay,
      inputsPerSecond: 10,
      roomsPerShard: 6,
    },
    {
      ...base,
      name: 'Inputs at 10 Hz, 8 rooms a shard',
      sessionsPerDay,
      inputsPerSecond: 10,
      roomsPerShard: 8,
    },
    {
      ...base,
      name: 'Inputs at 10 Hz, 8 rooms a shard, 3 regions',
      sessionsPerDay,
      inputsPerSecond: 10,
      roomsPerShard: 8,
      regions: 3,
    },
  ],
)

console.log(JSON.stringify(scenarios.map(bill), null, 2))
