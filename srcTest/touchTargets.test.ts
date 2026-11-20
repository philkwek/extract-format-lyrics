// The frontend tsconfig omits node types; this test reads the stylesheet from disk.
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

function blockAfter(source: string, marker: string) {
  const start = source.indexOf(marker)
  if (start === -1) throw new Error(`missing ${marker}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error(`unclosed ${marker}`)
}

function coarseBlock() {
  return blockAfter(css, '@media (pointer: coarse)')
}

function rule(block: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = block.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`no ${selector} rule in the coarse pointer block`)
  return match[1]
}

function expectSize(selector: string, properties: string[]) {
  const body = rule(coarseBlock(), selector)
  for (const property of properties) {
    expect(body, `${selector} should set ${property}`).toMatch(
      new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*2\\.75rem`),
    )
  }
}

describe('touch targets', () => {
  it('adds the coarse pointer block before the reduced motion block', () => {
    expect(css).toContain('@media (pointer: coarse)')
    expect(css.indexOf('@media (pointer: coarse)')).toBeLessThan(
      css.indexOf('@media (prefers-reduced-motion: reduce)'),
    )
  })

  it('raises the shared controls to 44px on touch screens', () => {
    expectSize('.ui-button--sm', ['min-height'])
    expectSize('.ui-button--icon', ['width', 'height'])
    expectSize('.ui-segmented__item', ['min-height'])
    expectSize('.ui-segmented--compact', ['height'])
    expectSize('.song-tray-icon', ['width', 'height'])
    expectSize('.ui-field--sm', ['min-height'])
  })

  it('keeps the compact segmented items a pad smaller than their track', () => {
    const body = rule(coarseBlock(), '.ui-segmented--compact .ui-segmented__item')
    expect(body).toMatch(/height: calc\(2\.75rem - \(var\(--seg-pad\) \* 2\)\)/)
    expect(body).toMatch(/min-height: calc\(2\.75rem - \(var\(--seg-pad\) \* 2\)\)/)
  })

  it('keeps the song tray icons winning over the shared icon button', () => {
    const block = coarseBlock()
    expect(block.indexOf('.song-tray-icon')).toBeGreaterThan(block.indexOf('.ui-button--icon'))
  })

  it('gives the Key, pad and text size controls the same touch height as the buttons beside them', () => {
    for (const file of ['TransposeSelector.tsx', 'PadControls.tsx', 'DisplayControls.tsx']) {
      const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8')
      const fixedHeights = source.match(/\bh-8\b/g) ?? []
      const touchHeights = source.match(/\bpointer-coarse:h-11\b/g) ?? []
      expect(fixedHeights.length).toBeGreaterThan(0)
      expect(touchHeights.length).toBe(fixedHeights.length)
    }
  })

  it('keeps the sideways phone full screen header at 32px', () => {
    expect(css).toMatch(/\.fullscreen-compact-row \.ui-button--sm,[^}]*min-height: 2rem/)
    expect(css).toMatch(
      /\.fullscreen-compact-row \[class\*='pointer-coarse:h-11'\] \{ height: 2rem; \}/,
    )
    expect(css.indexOf('.fullscreen-compact-row .ui-button--sm')).toBeGreaterThan(
      css.indexOf('.ui-field--sm { min-height: 2.75rem; }'),
    )
  })

  it('leaves the desktop sizes alone', () => {
    expect(css).toMatch(/\.ui-button--sm \{ min-height: 2rem;/)
    expect(css).toMatch(/\.ui-button--icon \{ width: 2\.65rem; height: 2\.65rem;/)
    expect(css).toMatch(/\.song-tray-icon \{ width: 1\.75rem; height: 1\.75rem; \}/)
    expect(css).toMatch(/\.ui-field--sm \{ min-height: 1\.75rem;/)
  })
})
