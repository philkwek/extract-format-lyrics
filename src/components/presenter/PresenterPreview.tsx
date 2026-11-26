import { useLayoutEffect, useRef, useState } from 'react'
import type { PresenterDisplay } from '../../lib/presenterSettings'
import type { SharedLyricsSong } from '../../types/song'
import PresenterCanvas from './PresenterCanvas'

interface PresenterPreviewProps {
  song: SharedLyricsSong | null
  display: PresenterDisplay
  sectionIndex: number
  blackout: boolean
}

const PREVIEW_WIDTH = 1920
const PREVIEW_HEIGHT = 1080
const RESIZE_DEBOUNCE_MS = 150

export default function PresenterPreview({
  song,
  display,
  sectionIndex,
  blackout,
}: PresenterPreviewProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      if (frameRef.current) setWidth(frameRef.current.clientWidth)
    }
    queueMicrotask(measure)
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(measure, RESIZE_DEBOUNCE_MS)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <div
      ref={frameRef}
      className="border-ui-border relative aspect-video overflow-hidden rounded-xl border bg-black"
    >
      <div
        style={{
          width: PREVIEW_WIDTH,
          height: PREVIEW_HEIGHT,
          transform: `scale(${width / PREVIEW_WIDTH})`,
          transformOrigin: 'top left',
        }}
      >
        <PresenterCanvas
          song={song}
          display={display}
          view={display.lyricsView}
          sectionIndex={sectionIndex}
          blackout={blackout}
          heightPx={PREVIEW_HEIGHT}
        />
      </div>
    </div>
  )
}
