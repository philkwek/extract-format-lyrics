// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, renderHook } from '@testing-library/react'
import { getArrowSongIndex, useSongArrowKeys } from '../../src/lib/useSongArrowKeys'

function setup(overrides: Partial<{ enabled: boolean; count: number; activeIndex: number }> = {}) {
  const onSelect = vi.fn()
  const view = renderHook(
    (props: { enabled: boolean; count: number; activeIndex: number }) =>
      useSongArrowKeys({ ...props, onSelect }),
    { initialProps: { enabled: true, count: 3, activeIndex: 1, ...overrides } },
  )
  return { onSelect, ...view }
}

function pressWindow(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  window.dispatchEvent(event)
  return event
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('getArrowSongIndex', () => {
  it('moves one song each way', () => {
    expect(getArrowSongIndex('ArrowRight', 1, 3)).toBe(2)
    expect(getArrowSongIndex('ArrowLeft', 1, 3)).toBe(0)
  })

  it('does not wrap at the first or last song', () => {
    expect(getArrowSongIndex('ArrowRight', 2, 3)).toBeNull()
    expect(getArrowSongIndex('ArrowLeft', 0, 3)).toBeNull()
  })

  it('ignores other keys and an empty set', () => {
    expect(getArrowSongIndex('ArrowUp', 1, 3)).toBeNull()
    expect(getArrowSongIndex('PageDown', 1, 3)).toBeNull()
    expect(getArrowSongIndex(' ', 1, 3)).toBeNull()
    expect(getArrowSongIndex('ArrowRight', 0, 0)).toBeNull()
  })
})

describe('useSongArrowKeys', () => {
  it('selects the next and previous song from anywhere on the page', () => {
    const { onSelect } = setup()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onSelect).toHaveBeenNthCalledWith(1, 2)
    expect(onSelect).toHaveBeenNthCalledWith(2, 0)
  })

  it('does nothing at the ends', () => {
    const last = setup({ activeIndex: 2 })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(last.onSelect).not.toHaveBeenCalled()
    last.unmount()

    const first = setup({ activeIndex: 0 })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(first.onSelect).not.toHaveBeenCalled()
  })

  it('does nothing while chord editing is off limits', () => {
    const { onSelect } = setup({ enabled: false })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('ignores inputs, textareas, selects and contenteditable elements', () => {
    const { onSelect } = setup()
    for (const element of [
      document.createElement('input'),
      document.createElement('textarea'),
      document.createElement('select'),
    ]) {
      document.body.appendChild(element)
      fireEvent.keyDown(element, { key: 'ArrowRight' })
    }
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    document.body.appendChild(editable)
    fireEvent.keyDown(editable, { key: 'ArrowRight' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('ignores the key when a modifier is held', () => {
    const { onSelect } = setup()
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) {
      pressWindow('ArrowRight', { [modifier]: true })
    }
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('leaves a key another handler already consumed to that handler', () => {
    const { onSelect } = setup()
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    })
    event.preventDefault()
    window.dispatchEvent(event)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('ignores the key while a modal is open', () => {
    const { onSelect } = setup()
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.appendChild(modal)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('leaves scrolling keys to the browser', () => {
    const { onSelect } = setup()
    for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' ']) {
      expect(pressWindow(key).defaultPrevented).toBe(false)
    }
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('prevents the default only when it actually moves', () => {
    const { onSelect } = setup({ activeIndex: 0 })
    expect(pressWindow('ArrowRight').defaultPrevented).toBe(true)
    expect(onSelect).toHaveBeenCalledWith(1)
    expect(pressWindow('ArrowLeft').defaultPrevented).toBe(false)
  })
})
