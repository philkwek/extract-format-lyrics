import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { worshipChordsNetAdapter } from '../../src/adapters/worshipChordsNet.js'
import { normalizeSectionLabel } from '../../src/adapters/chartSectionLabels.js'
import { normalizeSongText } from '../../src/normalizer.js'

describe('worshipChordsNetAdapter', () => {
  it('matches worshipchords.net but not worshipchords.com', () => {
    expect(worshipChordsNetAdapter.matches('https://www.worshipchords.net/guitar/a/b-1')).toBe(true)
    expect(worshipChordsNetAdapter.matches('https://worshipchords.net/guitar/a/b')).toBe(true)
    expect(worshipChordsNetAdapter.matches('https://worshipchords.com/goodness-of-god-chords/')).toBe(false)
    expect(worshipChordsNetAdapter.matches('https://worshipchords.net.evil.com/song')).toBe(false)
  })

  it('detects Cloudflare verification block', () => {
    const blockedHtml = `<html><head><title>Just a moment...</title></head><body><div id="challenge-error-text"></div></body></html>`
    expect(() =>
      worshipChordsNetAdapter.extract(blockedHtml, 'https://www.worshipchords.net/guitar/a/b')
    ).toThrow(/anti-bot verification/)
  })

  it('extracts metadata, content and normalized section labels from the fixture', () => {
    const fixturePath = path.join(__dirname, '__fixtures__', 'worshipchordsnet.html')
    const html = fs.readFileSync(fixturePath, 'utf-8')

    const raw = worshipChordsNetAdapter.extract(
      html,
      'https://www.worshipchords.net/guitar/bethel-music/goodness-of-god-169394'
    )
    expect(raw.title).toBe('Goodness Of God')
    expect(raw.artist).toBe('Bethel Music')
    expect(raw.originalKey).toBe('G')
    expect(raw.capo).toBe(2)
    expect(raw.content).toContain('Verse 1')
    expect(raw.content).toContain('Chorus 1')
    expect(raw.content).toContain('Tag:')
    expect(raw.content).not.toContain('Bible Verse')
    expect(raw.content).not.toContain('Psalm 40')

    const sections = normalizeSongText(raw.content)
    expect(sections.map((section) => section.type)).toEqual([
      'Intro',
      'Verse',
      'Chorus',
      'Other',
    ])
    expect(sections[3].label).toBe('Tag')
  })

  it('throws a clear error for a page without a chart', () => {
    expect(() =>
      worshipChordsNetAdapter.extract(
        '<html><body><span class="stitle">Artist page</span></body></html>',
        'https://www.worshipchords.net/artists/1/test'
      )
    ).toThrow(/Could not locate chord chart content/)
  })

  it.each([
    ['first verse', 'Verse 1'],
    ['Second Verse', 'Verse 2'],
    ['Verse 3', 'Verse 3'],
    ['Chorus Repeat', 'Chorus'],
    ['Chorus 2', 'Chorus 2'],
    ['Pre Chorus 1', 'Pre-Chorus 1'],
    ['Bridge Repeat', 'Bridge'],
    ['Interlude', 'Instrumental'],
    ['Tag', 'Tag:'],
    ['Turnaround 2', 'Turnaround:'],
    ['not a section label', null],
  ])('normalizes the label %s', (label, expected) => {
    expect(normalizeSectionLabel(label)).toBe(expected)
  })
})
