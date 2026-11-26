import { useCallback, useImperativeHandle, useMemo, useState, type Ref } from 'react'
import { ArrowLeft, ArrowRight, GripVertical, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { classes } from '../../lib/classes'
import { isSectionEdited, parseEditedLyricsText } from '../../lib/presenterEdits'
import { sectionTone } from '../../lib/presenterSections'
import { reducedMotionTransition } from '../../lib/uiMotion'
import { UNDO_WINDOW_MS, usePendingRemoval } from '../../lib/usePendingRemoval'
import type { SharedLyricsSection, SharedLyricsSong } from '../../types/song'
import ChangeToast, { type ChangeNote } from '../share/ChangeToast'
import { Button, IconButton } from '../ui'
import OverlayDialog from '../ui/OverlayDialog'

export interface PresenterSongEditorHandle {
  getSections: () => SharedLyricsSection[]
}

interface PresenterSongEditorProps {
  hostSong: SharedLyricsSong
  currentSong: SharedLyricsSong
  hasSavedEdit: boolean
  editorRef?: Ref<PresenterSongEditorHandle>
  onCancel: () => void
  onSave: (sections: SharedLyricsSection[]) => void
  onReset: () => void
}

interface SectionDraft {
  id: number
  label: string
  text: string
}

export default function PresenterSongEditor({
  hostSong,
  currentSong,
  hasSavedEdit,
  editorRef,
  onCancel,
  onSave,
  onReset,
}: PresenterSongEditorProps) {
  const reduceMotion = useReducedMotion()
  const [drafts, setDrafts] = useState<SectionDraft[]>(() =>
    currentSong.sections.map((section, index) => ({
      id: index,
      label: section.label,
      text: section.lines.join('\n'),
    })),
  )

  const [confirmingRemoval, setConfirmingRemoval] = useState<{ id: number; label: string } | null>(
    null,
  )
  const [draggedId, setDraggedId] = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const [liftedId, setLiftedId] = useState<number | null>(null)

  const commitRemoval = useCallback(({ id }: { id: number }) => {
    setDrafts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const {
    pending: pendingRemoval,
    start: startRemoval,
    undo: undoRemoval,
  } = usePendingRemoval<{ id: number }>({ onCommit: commitRemoval })

  const visibleDrafts = useMemo(
    () => (pendingRemoval ? drafts.filter((item) => item.id !== pendingRemoval.id) : drafts),
    [drafts, pendingRemoval],
  )

  const undoNote = useMemo<ChangeNote | null>(
    () =>
      pendingRemoval
        ? {
            text: 'Section removed',
            action: { label: 'Undo', run: undoRemoval },
          }
        : null,
    [pendingRemoval, undoRemoval],
  )

  const dismissUndoToast = useCallback(() => undefined, [])

  const updateDraft = (id: number, patch: Partial<SectionDraft>) => {
    setDrafts((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const moveDraft = (fromId: number, toId: number) => {
    if (fromId === toId) return
    setLiftedId(fromId)
    setDrafts((prev) => {
      const fromIndex = prev.findIndex((item) => item.id === fromId)
      const toIndex = prev.findIndex((item) => item.id === toId)
      if (fromIndex < 0 || toIndex < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  const buildSections = useCallback(
    (): SharedLyricsSection[] =>
      visibleDrafts.map((draft) => ({
        label: draft.label,
        lines: parseEditedLyricsText(draft.text),
      })),
    [visibleDrafts],
  )

  useImperativeHandle(editorRef, () => ({ getSections: buildSections }), [buildSections])

  const handleSave = () => {
    onSave(buildSections())
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4">
        <h2 className="min-w-0 truncate text-2xl leading-tight font-bold">
          Editing: {hostSong.title}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave}>
            Save changes
          </Button>
        </div>
      </div>

      <div className="bg-ui-surface border-ui-border mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs">
        <p className="text-ui-text-muted">
          These changes are saved on this laptop only and change what the projector shows. The
          host&apos;s set stays the same.
        </p>
        {hasSavedEdit && (
          <Button variant="secondary" size="sm" onClick={onReset}>
            Reset to host&apos;s version
          </Button>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-4 overflow-y-auto p-4">
        {visibleDrafts.map((draft, draftIndex) => {
          const parsed: SharedLyricsSection = {
            label: draft.label,
            lines: parseEditedLyricsText(draft.text),
          }
          const changed = !hostSong.sections.some(
            (hostSection) => !isSectionEdited(hostSection, parsed),
          )
          const lyricsId = `presenter-section-lyrics-${draft.id}`
          const canReorder = visibleDrafts.length > 1
          const lifted = liftedId === draft.id

          return (
            <motion.div
              key={draft.id}
              layout="position"
              animate={{ scale: lifted && !reduceMotion ? 1.04 : 1 }}
              style={{ zIndex: lifted ? 10 : 0 }}
              onLayoutAnimationComplete={() => setLiftedId((id) => (id === draft.id ? null : id))}
              transition={
                reduceMotion
                  ? reducedMotionTransition
                  : {
                      layout: { type: 'spring', stiffness: 220, damping: 26, mass: 0.9 },
                      scale: { type: 'spring', stiffness: 400, damping: 30 },
                    }
              }
              data-section-card
              onDragOver={(event) => {
                if (draggedId === null) return
                event.preventDefault()
                if (dragOverId !== draft.id) setDragOverId(draft.id)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDragOverId((prev) => (prev === draft.id ? null : prev))
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (draggedId !== null) moveDraft(draggedId, draft.id)
                setDraggedId(null)
                setDragOverId(null)
              }}
              className={classes(
                'relative flex min-w-0 flex-col gap-3 rounded-2xl border-2 p-4 transition-[opacity,box-shadow]',
                lifted && 'shadow-xl',
                sectionTone(draft.label),
                draggedId === draft.id && 'opacity-50',
                dragOverId === draft.id && draggedId !== draft.id && 'ring-ui-accent ring-2',
              )}
            >
              <div className="flex items-center gap-2">
                {canReorder && (
                  <div
                    draggable
                    title="Drag to reorder"
                    aria-label={`Drag ${draft.label || 'section'} to reorder`}
                    onDragStart={(event) => {
                      setDraggedId(draft.id)
                      if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', String(draft.id))
                        const card = event.currentTarget.closest<HTMLElement>('[data-section-card]')
                        if (card && event.dataTransfer.setDragImage) {
                          const rect = card.getBoundingClientRect()
                          event.dataTransfer.setDragImage(
                            card,
                            Math.max(0, event.clientX - rect.left),
                            Math.max(0, event.clientY - rect.top),
                          )
                        }
                      }
                    }}
                    onDragEnd={() => {
                      setDraggedId(null)
                      setDragOverId(null)
                    }}
                    className="text-ui-text-muted -ml-1 flex shrink-0 cursor-grab items-center rounded p-1 active:cursor-grabbing"
                  >
                    <GripVertical size={14} aria-hidden="true" />
                  </div>
                )}
                <input
                  type="text"
                  aria-label="Section title"
                  placeholder="Section title"
                  value={draft.label}
                  onChange={(event) => updateDraft(draft.id, { label: event.target.value })}
                  className="bg-ui-surface text-ui-text border-ui-border min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold"
                />
                <div className="flex shrink-0 items-center gap-1.5">
                  {changed && (
                    <span className="border-ui-border bg-ui-surface-raised text-ui-text rounded-full border px-2 py-0.5 text-[10px] font-semibold">
                      Edited
                    </span>
                  )}
                  {canReorder && (
                    <>
                      <IconButton
                        label={`Move ${draft.label || 'section'} left`}
                        variant="secondary"
                        disabled={draftIndex === 0}
                        onClick={() => moveDraft(draft.id, visibleDrafts[draftIndex - 1].id)}
                      >
                        <ArrowLeft size={14} aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`Move ${draft.label || 'section'} right`}
                        variant="secondary"
                        disabled={draftIndex === visibleDrafts.length - 1}
                        onClick={() => moveDraft(draft.id, visibleDrafts[draftIndex + 1].id)}
                      >
                        <ArrowRight size={14} aria-hidden="true" />
                      </IconButton>
                    </>
                  )}
                  <IconButton
                    label={`Remove ${draft.label || 'section'}`}
                    variant="danger"
                    disabled={visibleDrafts.length <= 1}
                    onClick={() => setConfirmingRemoval({ id: draft.id, label: draft.label })}
                  >
                    <X size={14} aria-hidden="true" />
                  </IconButton>
                </div>
              </div>

              <label htmlFor={lyricsId} className="text-ui-text-muted text-[11px] font-semibold">
                Lyrics
              </label>
              <textarea
                id={lyricsId}
                rows={6}
                value={draft.text}
                onChange={(event) => updateDraft(draft.id, { text: event.target.value })}
                className="bg-ui-surface text-ui-text border-ui-border w-full resize-y rounded-lg border p-3 text-sm leading-5"
              />
            </motion.div>
          )
        })}
      </div>

      <OverlayDialog
        isOpen={confirmingRemoval !== null}
        onClose={() => setConfirmingRemoval(null)}
        title="Remove this section?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingRemoval(null)}>
              Cancel
            </Button>
            <Button
              variant="danger-solid"
              onClick={() => {
                if (!confirmingRemoval) return
                const target = confirmingRemoval
                setConfirmingRemoval(null)
                setDraggedId(null)
                setDragOverId(null)
                startRemoval({ id: target.id })
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-ui-text text-sm">
          {confirmingRemoval
            ? `"${confirmingRemoval.label || 'This section'}" will be removed from this song on this laptop. You can undo for 5 seconds.`
            : ''}
        </p>
      </OverlayDialog>

      <ChangeToast
        note={undoNote}
        onDismiss={dismissUndoToast}
        progressMs={UNDO_WINDOW_MS}
        progressKey={pendingRemoval?.id}
        pauseOnHover={false}
        dismissible={false}
      />
    </div>
  )
}
