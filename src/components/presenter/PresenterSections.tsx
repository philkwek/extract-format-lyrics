import type { ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { classes } from '../../lib/classes'
import { BLANK_SECTION } from '../../lib/presenterNavigation'
import { sectionTone } from '../../lib/presenterSections'
import type { PresenterView } from '../../lib/presenterSettings'
import type { SharedLyricsSong } from '../../types/song'
import { Button } from '../ui'
import { OnScreenTag } from './PresenterTags'

interface PresenterSectionsProps {
  song: SharedLyricsSong | null
  view: PresenterView
  sectionIndex: number
  onProjectSection: (entryId: string, sectionIndex: number) => void
  onEdit: () => void
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="border-ui-border bg-ui-surface-raised text-ui-text rounded-md border px-1.5 py-0.5 font-sans text-[10px] font-medium">
      {children}
    </kbd>
  )
}

/** Whole song view shows every section at once, so the cards cannot be picked. */
function WholeSongOverlay() {
  return (
    <div className="bg-ui-canvas/70 absolute inset-0 z-10 flex items-center justify-center rounded-2xl">
      <span className="border-ui-border bg-ui-surface-raised text-ui-text rounded-full border px-4 py-1.5 text-sm font-semibold">
        Displaying whole song
      </span>
    </div>
  )
}

function KeyHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
      {label}
    </span>
  )
}

export default function PresenterSections({
  song,
  view,
  sectionIndex,
  onProjectSection,
  onEdit,
}: PresenterSectionsProps) {
  if (!song) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-ui-text-muted text-xs">Choose a song to show its lyrics.</p>
      </div>
    )
  }

  const whole = view === 'whole'
  const blankSelected = !whole && sectionIndex === BLANK_SECTION

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="truncate text-2xl leading-tight font-bold">{song.title}</h2>
          {view === 'whole' && <OnScreenTag />}
        </div>
        <Button
          variant="secondary"
          icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
          onClick={onEdit}
          className="shrink-0"
        >
          Edit song lyrics and titles
        </Button>
      </div>

      <div className="relative mt-4 flex min-h-0 flex-col">
        <div className="grid min-h-0 grid-cols-2 content-start gap-4 overflow-y-auto p-1.5">
          <button
            type="button"
            disabled={whole}
            aria-pressed={whole ? undefined : blankSelected}
            onClick={() => onProjectSection(song.entryId, BLANK_SECTION)}
            className={classes(
              'border-ui-border text-ui-text-muted relative rounded-2xl border-2 border-dashed bg-black/10 p-4 text-left transition disabled:cursor-not-allowed',
              blankSelected && 'ring-ui-accent ring-4',
            )}
          >
            {blankSelected && <OnScreenTag className="absolute top-3 right-3" />}
            <div className="text-sm font-bold">Blank</div>
            <div className="mt-2 text-base leading-6">Title only, no lyrics</div>
          </button>
          {song.sections.map((section, index) => {
            const selected = !whole && index === sectionIndex
            return (
              <button
                key={index}
                type="button"
                disabled={whole}
                aria-pressed={whole ? undefined : selected}
                onClick={() => onProjectSection(song.entryId, index)}
                className={classes(
                  'relative rounded-2xl border-2 p-4 text-left transition disabled:cursor-not-allowed',
                  sectionTone(section.label),
                  selected && 'ring-ui-accent ring-4',
                )}
              >
                {selected && <OnScreenTag className="absolute top-3 right-3" />}
                <div className={classes('text-sm font-bold', selected && 'pr-20')}>
                  {section.label}
                </div>
                <div className="text-ui-text mt-2 text-base leading-6">
                  {section.lines.map((line, lineIndex) => (
                    <div key={lineIndex}>{line}</div>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
        {whole && <WholeSongOverlay />}
      </div>

      <div className="text-ui-text-muted mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-4 text-[11px]">
        <KeyHint keys={['→', 'Space']} label="Next" />
        <KeyHint keys={['←']} label="Previous" />
        <KeyHint keys={['Esc']} label="Fade to black" />
      </div>
    </div>
  )
}
