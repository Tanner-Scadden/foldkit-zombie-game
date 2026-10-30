// NOTE: the harness's ready signal. The entry imports this module first, so
// it runs before any game module can make an image. It keeps every image
// element the page creates, through `document.createElement('img')` (what
// Foldkit's canvas image cache uses) or `new Image()`, so the signal waits for
// whatever images the page loads, however the game builds them: data URLs, an
// atlas, or files.

const created = new Set<HTMLImageElement>()

const nativeCreateElement = Document.prototype.createElement
Document.prototype.createElement = function (
  this: Document,
  tagName: string,
  options?: ElementCreationOptions,
) {
  const element = nativeCreateElement.call(this, tagName, options)
  if (element instanceof HTMLImageElement) {
    created.add(element)
  }
  return element
} as typeof Document.prototype.createElement

const NativeImage = window.Image
function TrackedImage(width?: number, height?: number): HTMLImageElement {
  const image = new NativeImage(width, height)
  created.add(image)
  return image
}
TrackedImage.prototype = NativeImage.prototype
window.Image = TrackedImage as unknown as typeof Image

const isPending = (image: HTMLImageElement): boolean =>
  image.getAttribute('src') !== null && !image.complete

// NOTE: images that are done are dropped from the set, so each check walks
// only the few still loading.
const pendingImages = (): ReadonlyArray<HTMLImageElement> => {
  const pending: Array<HTMLImageElement> = []
  for (const image of [...created, ...Array.from(document.images)]) {
    if (isPending(image)) {
      pending.push(image)
    } else if (image.getAttribute('src') !== null) {
      created.delete(image)
    }
  }
  return pending
}

const nextFrame = (): Promise<void> =>
  new Promise(resolve => requestAnimationFrame(() => resolve()))

const frames = async (count: number): Promise<void> => {
  for (let index = 0; index < count; index++) {
    await nextFrame()
  }
}

const SETTLE_LIMIT_MS = 10_000

// NOTE: resolves once the fonts are loaded, the scene has rendered, and every
// image the page asked for has loaded and decoded, with two more frames so a
// canvas that repaints when its image arrives has painted. `isHeld` is the
// extra condition a scene needs, such as a frozen scene's last frame. It gives
// up after ten seconds, so a broken image cannot hang a script forever.
export const settle = async (isHeld: () => boolean): Promise<void> => {
  const startedAt = performance.now()
  await document.fonts.ready
  await frames(2)
  while (performance.now() - startedAt < SETTLE_LIMIT_MS) {
    const pending = pendingImages()
    if (pending.length === 0 && isHeld()) {
      await frames(2)
      if (pendingImages().length === 0) {
        return
      }
    }
    await Promise.all(
      pending.map(image => image.decode().catch(() => undefined)),
    )
    await nextFrame()
  }
}
