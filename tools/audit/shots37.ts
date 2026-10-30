// The Profile pass: each tab of the Profile (Look, Name, Account in each link
// step, Settings and its reset question) on a desktop, a landscape phone, and
// an upright phone, as `s37-<TAG>-<viewport>-<scene>.png`. It exits with 1 on
// a phone button under 48 px, a text field under 16 px (iOS zooms in on
// those), or the Profile past the screen's edge.
//   TAG=after BASE=http://localhost:4174/ bun run heavy -- bun tools/audit/shots37.ts
import {
  DESKTOP_1280,
  PHONE_844,
  UPRIGHT_390,
  type Viewport,
  deviceQuery,
  finish,
  harnessUrl,
  isPickedScene,
  launch,
  openPage,
  pickViewports,
  settleAnimations,
  shot,
  tagOr,
  wait,
} from './lib'

const TAG = tagOr('after')

const VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'd1280' },
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_390, name: 'p390' },
])

type Scene = Readonly<{
  name: string
  query: string
  click?: ReadonlyArray<string>
}>

const LOOK = 'look=Female,Ponytail,Ginger,Tan,Teal'

const SCENES: ReadonlyArray<Scene> = [
  { name: 'look', query: `profile=look&${LOOK}` },
  { name: 'name-empty', query: 'profile=name' },
  { name: 'name', query: 'profile=name&name=Dr. Chomp' },
  { name: 'account-local', query: 'profile=account' },
  { name: 'account', query: 'profile=account&sync=synced&devices=2' },
  {
    name: 'account-syncing',
    query: 'profile=account&sync=offline&devices=3',
  },
  {
    name: 'account-showing',
    query: 'profile=account&sync=synced&link=showing',
  },
  {
    name: 'account-entering',
    query: 'profile=account&sync=synced&link=entering',
  },
  {
    name: 'account-linked',
    query: 'profile=account&sync=synced&devices=2&link=linked',
  },
  {
    name: 'account-failed',
    query: 'profile=account&sync=synced&link=failed',
  },
  { name: 'settings', query: 'profile=settings&fit=full&rotate' },
  {
    name: 'settings-reset',
    query: 'profile=settings',
    click: ['#reset-tutorial'],
  },
]

const problems: Array<string> = []

const checkLayout = async (
  page: Awaited<ReturnType<typeof openPage>>,
  viewport: Viewport,
  where: string,
) => {
  const found = await page.evaluate(() => {
    const panel = document.querySelector('.profile')
    const box = panel?.getBoundingClientRect()
    const buttons = [
      ...document.querySelectorAll('.profile-dialog button'),
    ].map(button => {
      const rect = button.getBoundingClientRect()
      return {
        label:
          button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '',
        width: rect.width,
        height: rect.height,
        isShown: rect.width > 0 && rect.height > 0,
      }
    })
    const fields = [...document.querySelectorAll('.profile-dialog input')].map(
      input => ({
        id: input.id,
        size: Number.parseFloat(getComputedStyle(input).fontSize),
      }),
    )
    return {
      box: box
        ? {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
          }
        : null,
      buttons,
      fields,
      width: innerWidth,
      height: innerHeight,
    }
  })
  if (found.box === null) {
    problems.push(`${where}: no Profile open`)
    return
  }
  if (
    found.box.left < 0 ||
    found.box.top < 0 ||
    found.box.right > found.width ||
    found.box.bottom > found.height
  ) {
    problems.push(`${where}: the Profile is past the screen's edge`)
  }
  for (const field of found.fields) {
    if (field.size < 16) {
      problems.push(`${where}: #${field.id} is ${field.size}px, under 16px`)
    }
  }
  if (viewport.isPhone) {
    for (const button of found.buttons) {
      if (button.isShown && (button.width < 47.5 || button.height < 47.5)) {
        problems.push(
          `${where}: "${button.label}" is ${Math.round(button.width)}x${Math.round(button.height)}`,
        )
      }
    }
  }
}

const browser = await launch()
for (const viewport of VIEWPORTS as ReadonlyArray<Viewport>) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) continue
    const page = await openPage(browser, viewport)
    await page.goto(harnessUrl(scene.query, deviceQuery(viewport), 'nodev'))
    await page.waitForSelector('.profile-dialog[open] .profile-page', {
      timeout: 15000,
    })
    for (const selector of scene.click ?? []) {
      await page.click(selector)
      await wait(200)
    }
    await settleAnimations(page)
    await wait(400)
    const where = `${viewport.name} ${scene.name}`
    await checkLayout(page, viewport, where)
    await shot(page, `s37-${TAG}-${viewport.name}-${scene.name}`)
    await page.context().close()
  }
}
await browser.close()
finish(problems, 'Every Profile tab fits, with big enough buttons and fields.')
