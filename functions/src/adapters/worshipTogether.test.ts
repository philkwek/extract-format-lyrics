import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { worshipTogetherAdapter } from './worshipTogether.js'
import { normalizeSongText } from '../normalizer.js'

describe('worshipTogetherAdapter', () => {
  it('matches worshiptogether URLs', () => {
    expect(
      worshipTogetherAdapter.matches('https://www.worshiptogether.com/songs/holy-forever-chris-tomlin/')
    ).toBe(true)
    expect(worshipTogetherAdapter.matches('https://pnwchords.com/song')).toBe(false)
  })

  it('extracts metadata, chords, and lyrics from fixture', () => {
    const fixturePath = path.join(__dirname, '__fixtures__', 'worshiptogether.html')
    const html = fs.readFileSync(fixturePath, 'utf-8')

    const raw = worshipTogetherAdapter.extract(html, 'https://www.worshiptogether.com/songs/holy-forever-chris-tomlin/')
    expect(raw.title).toBe('Holy Forever')
    expect(raw.artist).toBe('Chris Tomlin')
    expect(raw.originalKey).toBe('Db')
    expect(raw.content).toContain('thousand generations')

    const sections = normalizeSongText(raw.content)
    expect(sections.length).toBeGreaterThanOrEqual(2) // Intro, Verse 1
    expect(sections[0].type).toBe('Intro')
    expect(sections[1].type).toBe('Verse')
  })
})
