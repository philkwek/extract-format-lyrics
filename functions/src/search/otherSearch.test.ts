import { describe, it, expect } from 'vitest'
import { parsePnwSearchHtml } from './pnwChordsSearch.js'
import { parseWorshipTogetherSearchHtml } from './worshipTogetherSearch.js'

describe('parsePnwSearchHtml', () => {
  it('parses wordpress search result posts', () => {
    const html = `
      <h2 class="post-title entry-title">
        <a href="https://pnwchords.com/good-grace-hillsong-worship/">Good Grace – Hillsong Worship</a>
      </h2>
    `
    const res = parsePnwSearchHtml(html)
    expect(res.length).toBe(1)
    expect(res[0].title).toBe('Good Grace')
    expect(res[0].artist).toBe('Hillsong Worship')
    expect(res[0].url).toContain('good-grace')
  })
})

describe('parseWorshipTogetherSearchHtml', () => {
  it('parses song directory links', () => {
    const html = `
      <a href="/songs/holy-forever-chris-tomlin/">Holy Forever</a>
    `
    const res = parseWorshipTogetherSearchHtml(html)
    expect(res.length).toBe(1)
    expect(res[0].title).toBe('Holy Forever')
    expect(res[0].url).toBe('https://www.worshiptogether.com/songs/holy-forever-chris-tomlin/')
  })
})
