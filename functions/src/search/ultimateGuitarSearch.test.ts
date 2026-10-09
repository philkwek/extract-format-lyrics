import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseUgSearchHtml } from './ultimateGuitarSearch.js'

describe('parseUgSearchHtml', () => {
  it('extracts search candidate versions from fixture', () => {
    const fixturePath = path.join(__dirname, '__fixtures__', 'ug-search.html')
    const html = fs.readFileSync(fixturePath, 'utf-8')

    const candidates = parseUgSearchHtml(html)
    expect(candidates.length).toBe(2)
    expect(candidates[0].title).toBe('Hallelujah')
    expect(candidates[0].artist).toBe('Leonard Cohen')
    expect(candidates[0].versionLabel).toBe('Ver 1')
    expect(candidates[0].url).toContain('leonard-cohen')
    expect(candidates[1].artist).toBe('Jeff Buckley')
  })
})
