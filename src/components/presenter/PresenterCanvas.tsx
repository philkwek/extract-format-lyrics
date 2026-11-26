import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { classes } from '../../lib/classes'
import { partitionSections, type SheetColumns } from '../../lib/songLayout'
import { toPresenterSections, usePresenterFit } from '../../lib/presenterFit'
import { resolveAlign, type PresenterDisplay } from '../../lib/presenterSettings'
import type { SharedLyricsSection, SharedLyricsSong } from '../../types/song'

type PresenterView = 'whole' | 'sections'

interface PresenterCanvasProps {
  song: SharedLyricsSong | null
  display: PresenterDisplay
  view: PresenterView
  sectionIndex: number | null
  blackout: boolean
  /** The design height the font maths are based on, so the canvas scales with its parent. */
  heightPx: number
}

function songSignature(song: SharedLyricsSong | null): string {
  if (!song) return ''
  return [
    song.entryId,
    ...song.sections.map((section) => `${section.label}\u0000${section.lines.join('\u0000')}`),
  ].join('\u0001')
}

function contentKey(
  song: SharedLyricsSong,
  display: PresenterDisplay,
  view: PresenterView,
  sectionIndex: number | null,
): string {
  return `${songSignature(song)}:${view}:${sectionIndex ?? ''}:${display.caps}:${display.textScale}`
}

function sectionAt(song: SharedLyricsSong, index: number | null): SharedLyricsSection | null {
  if (song.sections.length === 0) return null
  const clamped = Math.min(Math.max(index ?? 0, 0), song.sections.length - 1)
  return song.sections[clamped] ?? null
}

function SectionBlock({ section }: { section: SharedLyricsSection }) {
  return (
    <section>
      {section.label && <div className="font-bold">{section.label}</div>}
      {section.lines.map((line, lineIndex) => (
        <div key={lineIndex} className="font-medium">
          {line}
        </div>
      ))}
    </section>
  )
}

export default function PresenterCanvas({
  song,
  display,
  view,
  sectionIndex,
  blackout,
  heightPx,
}: PresenterCanvasProps) {
  const reduceMotion = Boolean(useReducedMotion())
  const [shownSong, setShownSong] = useState<SharedLyricsSong | null>(song)
  const [shownSectionIndex, setShownSectionIndex] = useState<number | null>(sectionIndex)
  const [visible, setVisible] = useState(true)

  const sameSong = Boolean(song && shownSong && song.entryId === shownSong.entryId)
  const displayedSong = sameSong ? song : shownSong
  const displayedSectionIndex = sameSong ? sectionIndex : shownSectionIndex

  useEffect(() => {
    if (sameSong) {
      const settle = window.setTimeout(() => {
        setShownSong(song)
        setShownSectionIndex(sectionIndex)
        setVisible(true)
      }, 0)
      return () => window.clearTimeout(settle)
    }
    if (!song || !shownSong || reduceMotion) {
      const swap = window.setTimeout(() => {
        setShownSong(song)
        setShownSectionIndex(sectionIndex)
        setVisible(true)
      }, 0)
      return () => window.clearTimeout(swap)
    }
    const fadeOut = window.setTimeout(() => setVisible(false), 0)
    const swap = window.setTimeout(() => {
      setShownSong(song)
      setShownSectionIndex(sectionIndex)
      setVisible(true)
    }, 150)
    return () => {
      window.clearTimeout(fadeOut)
      window.clearTimeout(swap)
    }
  }, [sameSong, song, sectionIndex, shownSong, reduceMotion])

  const sectionsView = view === 'sections'
  const maxFontPx = Math.round((heightPx * (sectionsView ? 72 : 56)) / 1080)
  const minFontPx = Math.max(14, Math.round(heightPx * 0.018))
  const { containerRef, fontPx, columns, fitsOnScreen } = usePresenterFit({
    enabled: Boolean(displayedSong) && !blackout,
    contentKey: displayedSong
      ? contentKey(displayedSong, display, view, displayedSectionIndex)
      : '',
    maxFontPx,
    minFontPx,
    maxColumns: sectionsView ? 1 : 3,
    textScale: display.textScale,
  })

  if (!song) {
    return <div className="h-full w-full overflow-hidden bg-black" aria-hidden="true" />
  }

  const sheetColumns = Math.min(3, Math.max(1, columns)) as SheetColumns
  const sectionColumns = displayedSong
    ? partitionSections(toPresenterSections(displayedSong), sheetColumns)
    : []
  const activeSection = displayedSong ? sectionAt(displayedSong, displayedSectionIndex) : null
  const align = resolveAlign(display, view)
  const isDark = display.theme === 'dark'
  const vertical =
    sectionsView && display.sectionPosition !== 'top' ? 'items-center' : 'items-start'

  return (
    <div
      className={classes(
        'relative h-full w-full overflow-hidden',
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
          style={{ left: '2.5%', top: '3.7%', fontSize: `${(heightPx * 28) / 1080}px` }}
        >
          {displayedSong?.title}
        </div>
        <div
          className="absolute"
          style={{ top: '10.4%', left: '4.2%', right: '4.2%', bottom: '4%' }}
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
                vertical,
                align === 'center' ? 'text-center' : 'text-left',
                display.caps && 'uppercase',
              )}
              style={{ gap: '1.4em', fontSize: `${fontPx}px`, lineHeight: 1.5 }}
            >
              {sectionsView
                ? activeSection && (
                    <div className="flex max-w-full shrink-0 flex-col" style={{ gap: '0.8em' }}>
                      <SectionBlock section={activeSection} />
                    </div>
                  )
                : sectionColumns.map((column, columnIndex) => (
                    <div
                      key={columnIndex}
                      className="flex min-w-0 flex-col"
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
      <div
        className="pointer-events-none absolute inset-0 bg-black"
        aria-hidden="true"
        style={{
          opacity: blackout ? 1 : 0,
          transition: reduceMotion ? 'none' : 'opacity 300ms ease',
        }}
      />
    </div>
  )
}
