import { describe, expect, it } from 'vitest'
import { sectionTone } from '../../src/lib/presenterSections'

describe('sectionTone', () => {
  it('uses violet for chorus labels', () => {
    expect(sectionTone('Chorus')).toContain('violet-500')
    expect(sectionTone('Chorus 2')).toContain('text-violet-700')
    expect(sectionTone('CHORUS')).toContain('dark:border-violet-300')
  })

  it('uses sky for verse labels', () => {
    expect(sectionTone('Verse 1')).toContain('sky-500')
    expect(sectionTone('verse 3')).toContain('text-sky-700')
  })

  it('uses teal for everything else', () => {
    expect(sectionTone('Bridge')).toContain('teal-500')
    expect(sectionTone('Intro')).toContain('text-teal-700')
    expect(sectionTone('')).toContain('dark:border-teal-300')
  })
})
