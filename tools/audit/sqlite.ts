// Checks the on-device save in SQLite on OPFS, in headless Chrome, against
// the production build or a deployed copy:
// 1. An older localStorage save is imported into SQLite on the first load.
// 2. A setting changed after that lasts across a reload while localStorage
//    stays untouched, so it came back from SQLite, and the database file
//    is in OPFS.
// 3. A second tab follows the first, its change goes through the leader,
//    and when the leader closes the second tab takes over the database.
//    Every reload after that still reads one whole, current save.
// Run it through the heavy guard:
//   BASE=http://localhost:4173/ bun run heavy -- bun tools/audit/sqlite.ts
import type { Page } from 'playwright-core'

import { GAME, launch, wait } from './lib'

const BASE = process.env.BASE ?? GAME
const SAVE_KEY = 'munch-manor:save'

const legacySave = {
  version: 2,
  onboarding: {
    lessons: {
      move: 'Learned',
      fire: 'Learned',
      startWave: 'Learned',
      shop: 'Pending',
      swap: 'Pending',
      pickup: 'Pending',
      timedBreaks: 'Pending',
      openBreak: 'Pending',
    },
    trapHint: 'Unseen',
    introducedKinds: [],
  },
  homeScreenTip: 'Unseen',
  settings: { sound: 'Muted', music: 'On', shake: 'On' },
  appearance: {
    body: 'Male',
    hairStyle: 'Crop',
    hairColor: 'Brown',
    skinTone: 'Light',
    shirtColor: 'Teal',
  },
  difficulty: { chosen: 'Normal', card: 'Seen', nightmare: 'Locked' },
}

const failures: Array<string> = []
const check = (isOk: boolean, label: string) => {
  console.log(`${isOk ? 'ok  ' : 'FAIL'} ${label}`)
  if (!isOk) {
    failures.push(label)
  }
}

const browser = await launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
})
const errors: Array<string> = []
const watch = (page: Page, name: string) => {
  page.on('pageerror', error => errors.push(`${name}: ${error.message}`))
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) {
      errors.push(`${name}: ${response.status()} ${response.url()}`)
    }
  })
}

const awaitGame = (page: Page) =>
  page.waitForFunction(() => document.getElementById('splash') === null, {
    timeout: 45_000,
  })

const toggleSelector = (label: string) =>
  `.setting-toggle:has(.setting-label:text-is("${label}"))`

// NOTE: the settings panel on the home menu shows each setting as a toggle
// with aria-pressed. It is opened once per page load.
const openSettings = async (page: Page) => {
  if ((await page.locator('.setting-toggle').count()) === 0) {
    await page.click('#home-settings')
    await page.waitForSelector('.setting-toggle')
  }
}

const setting = async (page: Page, label: string) => {
  await openSettings(page)
  return page.locator(toggleSelector(label)).getAttribute('aria-pressed')
}

const flip = async (page: Page, label: string) => {
  await openSettings(page)
  await page.locator(toggleSelector(label)).click()
}

const isMuted = async (page: Page) =>
  (await setting(page, 'Sound')) === 'false' ? 'true' : 'false'
const isMusicOn = (page: Page) => setting(page, 'Music')

const legacyInStorage = (page: Page) =>
  page.evaluate(key => localStorage.getItem(key), SAVE_KEY)

const opfsFiles = (page: Page) =>
  page.evaluate(async () => {
    const found: Array<string> = []
    const walk = async (dir: FileSystemDirectoryHandle, path: string) => {
      for await (const [name, handle] of (dir as any).entries()) {
        if (handle.kind === 'directory') {
          await walk(handle, `${path}${name}/`)
        } else {
          found.push(`${path}${name}`)
        }
      }
    }
    await walk(await navigator.storage.getDirectory(), '/')
    return found
  })

const page = await context.newPage()
watch(page, 'tab 1')
await page.goto(new URL('version.json', BASE).href)
await page.evaluate(([key, json]) => localStorage.setItem(key, json), [
  SAVE_KEY,
  JSON.stringify(legacySave),
] as const)

const started = Date.now()
await page.goto(BASE)
await awaitGame(page)
console.log(`     the first load took ${Date.now() - started} ms`)
await wait(300)
check(
  (await isMuted(page)) === 'true',
  'the localStorage save is imported on the first load',
)
const files = await opfsFiles(page)
check(
  files.some(file => file.startsWith('/.munch-manor/')),
  `the database lives in OPFS (${files.length} files under /.munch-manor/)`,
)

await page.evaluate(key => localStorage.removeItem(key), SAVE_KEY)
await flip(page, 'Sound')
await flip(page, 'Music')
await wait(600)
check((await isMuted(page)) === 'false', 'the sound goes back on')
check((await isMusicOn(page)) === 'false', 'the music goes off')
check(
  (await legacyInStorage(page)) === null,
  'the change is not written to localStorage',
)

await page.reload()
await awaitGame(page)
await wait(300)
check(
  (await isMuted(page)) === 'false' && (await isMusicOn(page)) === 'false',
  'after a reload both settings came back from SQLite',
)

const second = await context.newPage()
watch(second, 'tab 2')
await second.goto(BASE)
await awaitGame(second)
await wait(300)
check(
  (await isMusicOn(second)) === 'false',
  'a second tab reads the save through the leader',
)
await flip(second, 'Sound')
await wait(600)
check((await isMuted(second)) === 'true', 'the second tab mutes')

await page.close()
await wait(1500)
await flip(second, 'Music')
await wait(800)
check(
  (await isMusicOn(second)) === 'true',
  'the second tab turns the music on after the leader closed',
)

await second.reload()
await awaitGame(second)
await wait(300)
check(
  (await isMuted(second)) === 'true' && (await isMusicOn(second)) === 'true',
  'after the leader closed, a reload reads both changes from the second tab',
)

const third = await context.newPage()
watch(third, 'tab 3')
await Promise.all([third.goto(BASE), second.reload()])
await Promise.all([awaitGame(third), awaitGame(second)])
await wait(300)
check(
  (await isMuted(third)) === 'true' && (await isMuted(second)) === 'true',
  'two tabs loading at once both read the whole save',
)
check(
  (await legacyInStorage(third)) === null,
  'localStorage was never written while OPFS worked',
)
check(
  errors.length === 0,
  `no page errors${errors.length > 0 ? `: ${errors.join(' | ')}` : ''}`,
)

await browser.close()
if (failures.length > 0) {
  process.exit(1)
}
