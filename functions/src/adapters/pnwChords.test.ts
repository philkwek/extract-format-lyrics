import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pnwChordsAdapter } from './pnwChords.js'
import { normalizeSongText } from '../normalizer.js'

describe('pnwChordsAdapter', () => {
  it('matches pnwchords URLs', () => {
    expect(pnwChordsAdapter.matches('https://pnwchords.com/good-grace-hillsong-worship/')).toBe(true)
    expect(pnwChordsAdapter.matches('https://tabs.ultimate-guitar.com/tab/123')).toBe(false)
  })

  it('extracts metadata, key, and chords from fixture', () => {
    const fixturePath = path.join(__dirname, '__fixtures__', 'pnwchords.html')
    const html = fs.readFileSync(fixturePath, 'utf-8')

    const raw = pnwChordsAdapter.extract(html, 'https://pnwchords.com/good-grace-hillsong-worship/')
    expect(raw.title).toBe('Good Grace')
    expect(raw.artist).toBe('Hillsong Worship')
    expect(raw.originalKey).toBe('G')
    expect(raw.content).toContain('People, come together')

    const sections = normalizeSongText(raw.content)
    expect(sections.length).toBe(2)
    expect(sections[0].type).toBe('Verse')
    expect(sections[1].type).toBe('Chorus')
  })
})
