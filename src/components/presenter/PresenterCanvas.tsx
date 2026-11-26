import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { classes } from '../../lib/classes'
import { partitionSections, type SheetColumns } from '../../lib/songLayout'
import { toPresenterSections, usePresenterFit } from '../../lib/presenterFit'
import { resolveAlign, type PresenterDisplay } from '../../lib/presenterSettings'
import type { SharedLyricsSong } from '../../types/song'

interface PresenterCanvasProps {
  song: SharedLyricsSong | null
  display: PresenterDisplay
  view: 'whole'
  blackout: boolean
}

function songSignature(song: SharedLyricsSong | null): string {
  if (!song) return ''
  return [
    song.entryId,
    ...song.sections.map((section) => `${section.label}\u0000${section.lines.join('\u0000')}`),
  ].join('\u0001')
}

function contentKey(song: SharedLyricsSong, display: PresenterDisplay): string {
  return `${songSignature(song)}:${display.caps}:${display.textScale}`
}

export default function PresenterCanvas({
  song,
  display,
  view,
  blackout,
}: PresenterCanvasProps) {
  const reduceMotion = Boolean(useReducedMotion())
  const [shownSong, setShownSong] = useState<SharedLyricsSong | null>(song)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (songSignature(song) === songSignature(shownSong)) {
      const settle = window.setTimeout(() => setVisible(true), 0)
      return () => window.clearTimeout(settle)
    }
    if (!song || !shownSong || reduceMotion) {
      const swap = window.setTimeout(() => {
        setShownSong(song)
        setVisible(true)
      }, 0)
      return () => window.clearTimeout(swap)
    }
    const fadeOut = window.setTimeout(() => setVisible(false), 0)
    const swap = window.setTimeout(() => {
      setShownSong(song)
      setVisible(true)
    }, 150)
    return () => {
      window.clearTimeout(fadeOut)
      window.clearTimeout(swap)
    }
  }, [song, shownSong, reduceMotion])

  const viewportHeight = typeof window === 'undefined' ? 1080 : window.innerHeight
  const maxFontPx = Math.round(((viewportHeight * 56) / 1080) * (display.textScale / 100))
  const minFontPx = Math.max(14, Math.round(viewportHeight * 0.018))
  const { containerRef, fontPx, columns, fitsOnScreen } = usePresenterFit({
    enabled: Boolean(shownSong) && !blackout,
    contentKey: shownSong ? contentKey(shownSong, display) : '',
    maxFontPx,
    minFontPx,
    maxColumns: 3,
  })

  if (blackout || !song) {
    return <div className="h-screen w-screen overflow-hidden bg-black" aria-hidden="true" />
  }

  const sheetColumns = Math.min(3, Math.max(1, columns)) as SheetColumns
  const sectionColumns = shownSong
    ? partitionSections(toPresenterSections(shownSong), sheetColumns)
    : []
  const align = resolveAlign(display, view)
  const isDark = display.theme === 'dark'

  return (
    <div
      className={classes(
        'relative h-screen w-screen overflow-hidden',
        isDark ? 'bg-neutral-950 text-neutral-100' : 'bg-white text-neutral-950',
      )}
    >
      <div
        style={{
          opacity: visible ? 1 : 0,
          transition: reduceMotion ? 'none' : 'opacity 150ms ease',
        }}
      >
        <div
          className="absolute font-medium"
          style={{ left: '2.5vw', top: '3.7vh', fontSize: '2.6vh' }}
        >
          {shownSong?.title}
        </div>
        <div
          className="absolute"
          style={{ top: '10.4vh', left: '4.2vw', right: '4.2vw', bottom: '4vh' }}
        >
          <div
            ref={containerRef}
            className={classes(
              'h-full w-full',
              fitsOnScreen ? 'overflow-hidden' : 'overflow-y-auto',
            )}
          >
            <div
              data-presenter-content
              className={classes(
                'flex min-h-full w-full justify-center',
                fitsOnScreen ? 'items-center' : 'items-start',
                align === 'center' ? 'text-center' : 'text-left',
                display.caps && 'uppercase',
              )}
              style={{ gap: '1.4em', fontSize: `${fontPx}px`, lineHeight: 1.5 }}
            >
              {sectionColumns.map((column, columnIndex) => (
                <div
                  key={columnIndex}
                  className="flex shrink-0 flex-col"
                  style={{ gap: '0.8em' }}
                >
                  {column.map(({ section, originalIndex }) => (
                    <section key={originalIndex}>
                      {section.label && <div className="font-bold">{section.label}</div>}
                      {section.lines.map((line, lineIndex) => (
                        <div key={lineIndex} className="font-medium">
                          {line.kind === 'lyric'
                            ? line.text
                            : line.kind === 'tab'
                              ? line.raw
                              : line.chords.join('   ')}
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
