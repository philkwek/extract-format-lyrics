import { describe, expect, it } from 'vitest'

// Chrome colours come from the ui-* utilities; hex is only allowed where the protected
// song sheet keeps its own colours, or in the song tab strip until it gets its own task.
const sources = import.meta.glob('../src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const hexClass = /\[#[0-9a-fA-F]{3,8}\]/g

const allowed: Record<string, number> = {
  '../src/components/SongSheet.tsx': Infinity,
  '../src/components/ChordKeyboard.tsx': Infinity,
  '../src/pages/SessionPage.tsx': 8,
}

describe('chrome colours', () => {
  it('finds the source files', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20)
  })

  it('uses ui-* tokens instead of hex colour classes', () => {
    const offenders = Object.entries(sources)
      .map(([file, text]) => ({ file, count: text.match(hexClass)?.length ?? 0 }))
      .filter(({ file, count }) => count > (allowed[file] ?? 0))
      .map(({ file, count }) => `${file}: ${count}`)

    expect(offenders).toEqual([])
  })
})
