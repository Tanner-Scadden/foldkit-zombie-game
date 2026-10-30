import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

import { foldkitBrandingViews, isViewSource } from './viewIdentity'

const ROOT = resolve(import.meta.dirname, '../..')

const sourceOf = (path: string): string =>
  readFileSync(join(ROOT, path), 'utf8')

const VNODE_MAKERS = /\bh\.[a-zA-Z]+\(|\bCanvas\.view\(|\bdefineView\b/

describe('which modules the view identity transform brands', () => {
  test('a view module, even one that imports its builder only as a type', () => {
    expect(isViewSource(sourceOf('src/homeView.ts'))).toBe(true)
    expect(isViewSource(sourceOf('src/layers.ts'))).toBe(true)
    expect(isViewSource(sourceOf('src/characterView.ts'))).toBe(true)
  })

  test('not the simulation, the pathing, or a canvas shape builder', () => {
    expect(isViewSource(sourceOf('src/simulation.ts'))).toBe(false)
    expect(isViewSource(sourceOf('src/pathing.ts'))).toBe(false)
    expect(isViewSource(sourceOf('src/effectsView.ts'))).toBe(false)
  })

  test('every module under src that makes a vnode', () => {
    const unbranded = readdirSync(join(ROOT, 'src'), { recursive: true })
      .map(String)
      .filter(path => path.endsWith('.ts') && !path.endsWith('.test.ts'))
      .map(path => `src/${path}`)
      .filter(path => {
        const source = sourceOf(path)
        return VNODE_MAKERS.test(source) && !isViewSource(source)
      })
    expect(unbranded).toStrictEqual([])
  })

  test('wraps only the view identity plugin', () => {
    const names = foldkitBrandingViews().map(plugin => plugin.name)
    expect(names).toContain('foldkit:view-identity')
  })
})
