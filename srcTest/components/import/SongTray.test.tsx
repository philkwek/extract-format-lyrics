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

function setPhone(isPhone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isPhone && query.includes('max-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

const base = {
  failedUrls: new Set<string>(),
  isCreating: false,
  error: null,
  onMove: vi.fn(),
  onRemove: vi.fn(),
  onCreate: vi.fn(),
}

describe('SongTray', () => {
  it('renders nothing until a song is added', () => {
    setPhone(false)
    const { container } = render(<SongTray {...base} items={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows numbered songs with left and right buttons on wider screens', () => {
    setPhone(false)
    const onMove = vi.fn()
    render(<SongTray {...base} onMove={onMove} items={[song(1), song(2)]} />)
    expect(screen.getByText('Your set · 2 of 30 songs')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Move Song 1 left' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Move Song 1 right' }))
    expect(onMove).toHaveBeenCalledWith(0, 1)
    expect(screen.queryByRole('button', { name: 'Move Song 1 up' })).toBeNull()
  })

  it('collapses to a count on phones and expands with up and down buttons', () => {
    setPhone(true)
    render(<SongTray {...base} items={[song(1), song(2)]} />)
    expect(screen.queryByText('Song 1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /2 of 30 songs/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Move Song 2 up' }))
    expect(base.onMove).toHaveBeenCalledWith(1, 0)
    expect(screen.queryByRole('button', { name: 'Move Song 1 left' })).toBeNull()
  })

  it('removes a song and calls Create set', () => {
    setPhone(false)
    const onRemove = vi.fn()
    const onCreate = vi.fn()
    render(<SongTray {...base} onRemove={onRemove} onCreate={onCreate} items={[song(1)]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Song 1' }))
    expect(onRemove).toHaveBeenCalledWith(song(1).url)
    fireEvent.click(screen.getByRole('button', { name: 'Create set' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('marks failed songs in words and explains what to do', () => {
    setPhone(false)
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
})
