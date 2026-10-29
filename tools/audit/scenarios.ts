import { wait } from './lib'

export type Scenario = Readonly<{
  q: string
  warm: () => Promise<unknown>
  bot: boolean
}>

export const SCENARIOS: Record<string, Scenario> = {
  idle: { q: '?wave=2&prep=60000', warm: () => wait(1500), bot: false },
  busy: {
    q: '?wave=6&start=wave&god&gun=smg',
    warm: () => wait(12000),
    bot: true,
  },
  worst: {
    q: '?wave=8&start=wave&god&gun=smg&fill&crowd=30',
    warm: () => wait(4000),
    bot: true,
  },
  endlessCap: {
    q: '?wave=15&mode=endless&start=wave&god&fill&crowd=20&tough',
    warm: () => wait(6000),
    bot: true,
  },
  gasbags: {
    q: '?wave=6&start=wave&god&gun=smg&fill&gasbags=16',
    warm: () => wait(4000),
    bot: true,
  },
  endless15: {
    q: '?wave=15&mode=endless&start=wave&god&gun=smg&tier=3&fill',
    warm: () => wait(15000),
    bot: true,
  },
}
