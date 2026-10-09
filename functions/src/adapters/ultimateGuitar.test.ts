import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ultimateGuitarAdapter } from './ultimateGuitar.js'
import { normalizeSongText } from '../normalizer.js'

describe('ultimateGuitarAdapter', () => {
  it('matches ultimate guitar URLs', () => {
    expect(
      ultimateGuitarAdapter.matches('https://tabs.ultimate-guitar.com/tab/leonard-cohen/hallelujah-chords-198')
    ).toBe(true)
    expect(ultimateGuitarAdapter.matches('https://pnwchords.com/song')).toBe(false)
  })

  it('extracts metadata and chord content from fixture', () => {
    const fixturePath = path.join(__dirname, '__fixtures__', 'ultimate-guitar.html')
    const html = fs.readFileSync(fixturePath, 'utf-8')

    const rawSong = ultimateGuitarAdapter.extract(html, 'https://tabs.ultimate-guitar.com/tab/leonard-cohen/hallelujah-chords-198')
    expect(rawSong.title).toBe('Hallelujah')
    expect(rawSong.artist).toBe('Leonard Cohen')
    expect(rawSong.originalKey).toBe('C')
    expect(rawSong.content).toContain('[Verse 1]')
    expect(rawSong.content).not.toContain('[ch]')

    const sections = normalizeSongText(rawSong.content)
    expect(sections.length).toBe(2)
    expect(sections[0].type).toBe('Verse')
    expect(sections[1].type).toBe('Chorus')
  })
})
