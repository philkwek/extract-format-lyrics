// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SongTray from '../../../src/components/import/SongTray'
import type { SearchCandidate } from '../../../src/lib/api'

afterEach(cleanup)

const song = (n: number): SearchCandidate => ({
  site: 'pnwchords',
  title: `Song ${n}`,
  artist: `Artist ${n}`,
  url: `https://pnwchords.com/song-${n}`,
})

function setNarrow(isNarrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isNarrow && query.includes('max-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

const songs = (n: number) => Array.from({ length: n }, (_, i) => song(i + 1))

const base = {
  failedUrls: new Set<string>(),
  isCreating: false,
  error: null,
  onMove: vi.fn(),
  onReorder: vi.fn(),
  onRemove: vi.fn(),
  onCreate: vi.fn(),
}

describe('SongTray', () => {
  it('renders nothing until a song is added', () => {
    setNarrow(false)
    const { container } = render(<SongTray {...base} items={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a numbered side panel with up and down buttons and Create set at lg and up', () => {
    setNarrow(false)
    const onMove = vi.fn()
    render(<SongTray {...base} onMove={onMove} items={[song(1), song(2)]} />)
    expect(screen.getByText('2 songs added')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Move Song 1 up' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Move Song 1 down' }))
    expect(onMove).toHaveBeenCalledWith(0, 1)
  })

  it('collapses to a bottom bar below lg and expands with the same buttons', () => {
    setNarrow(true)
    render(<SongTray {...base} items={[song(1), song(2)]} />)
    expect(screen.queryByText('Song 1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /2 songs added/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Move Song 2 up' }))
    expect(base.onMove).toHaveBeenCalledWith(1, 0)
    expect(screen.getAllByRole('button', { name: 'Create set' })).toHaveLength(1)
  })

  it('removes a song and calls Create set', () => {
    setNarrow(false)
    const onRemove = vi.fn()
    const onCreate = vi.fn()
    render(<SongTray {...base} onRemove={onRemove} onCreate={onCreate} items={[song(1)]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Song 1' }))
    expect(onRemove).toHaveBeenCalledWith(song(1).url)
    fireEvent.click(screen.getByRole('button', { name: 'Create set' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('marks failed songs in words and explains what to do', () => {
    setNarrow(false)
    render(
      <SongTray
        {...base}
        items={[song(1), song(2)]}
        failedUrls={new Set([song(2).url])}
        error="Scrape failed"
      />,
    )
    expect(screen.getByText('Could not load this song')).toBeTruthy()
    expect(
      screen.getByText('Some songs could not be loaded. Remove them and try again.'),
    ).toBeTruthy()
  })

  it('shows the count only, in the singular for one song, with no limit note', () => {
    setNarrow(false)
    render(<SongTray {...base} items={songs(1)} />)
    expect(screen.getByText('1 song added')).toBeTruthy()
    expect(screen.queryByText(/of 30/)).toBeNull()
    expect(screen.queryByText(/You can add/)).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('says how many more fit only from 25 songs', () => {
    setNarrow(false)
    const { rerender } = render(<SongTray {...base} items={songs(24)} />)
    expect(screen.queryByText(/You can add/)).toBeNull()
    rerender(<SongTray {...base} items={songs(25)} />)
    expect(screen.getByText('You can add 5 more.')).toBeTruthy()
    rerender(<SongTray {...base} items={songs(29)} />)
    expect(screen.getByText('You can add 1 more.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('explains the limit and announces it at 30 songs', () => {
    setNarrow(false)
    render(<SongTray {...base} items={songs(30)} />)
    const sentence = 'Sets made here hold up to 30 songs. Remove one to add another.'
    expect(screen.getByRole('status').textContent).toBe(sentence)
    expect(screen.queryByText(/You can add/)).toBeNull()
  })

  it('highlights the song a button just moved', () => {
    setNarrow(false)
    render(<SongTray {...base} items={[song(1), song(2)]} />)
    const row = screen.getByText('Song 2').closest('li') as HTMLElement
    expect(row.className).not.toContain('border-ui-accent')
    fireEvent.click(screen.getByRole('button', { name: 'Move Song 2 up' }))
    expect(row.className).toContain('border-ui-accent')
  })
})
