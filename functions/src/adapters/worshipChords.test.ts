import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { worshipChordsAdapter } from './worshipChords.js'
import { normalizeSongText } from '../normalizer.js'

describe('worshipChordsAdapter', () => {
  it('matches worshipchords URLs', () => {
    expect(worshipChordsAdapter.matches('https://worshipchords.com/goodness-of-god-chords/')).toBe(true)
    expect(worshipChordsAdapter.matches('https://pnwchords.com/song')).toBe(false)
  })

  it('detects Cloudflare verification block', () => {
    const blockedHtml = `<html><head><title>Just a moment...</title></head><body><div id="challenge-error-text"></div></body></html>`
    expect(() => worshipChordsAdapter.extract(blockedHtml, 'https://worshipchords.com/song')).toThrow(/anti-bot verification/)
  })

  it('extracts metadata and content from fixture', () => {
    const fixturePath = path.join(__dirname, '__fixtures__', 'worshipchords.html')
    const html = fs.readFileSync(fixturePath, 'utf-8')

    const raw = worshipChordsAdapter.extract(html, 'https://worshipchords.com/goodness-of-god-chords/')
    expect(raw.title).toBe('Goodness of God')
    expect(raw.artist).toBe('Bethel Music')
    expect(raw.originalKey).toBe('G')
    expect(raw.content).toContain('I love You, Lord')

    const sections = normalizeSongText(raw.content)
    expect(sections.length).toBe(3) // Intro, Verse 1, Chorus
    expect(sections[0].type).toBe('Intro')
    expect(sections[1].type).toBe('Verse')
    expect(sections[2].type).toBe('Chorus')
  })
})
