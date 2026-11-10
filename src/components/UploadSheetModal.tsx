import { trackSongImport } from '../lib/analytics'
import { useState, useRef, useEffect } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileUp,
  KeyRound,
  X,
} from 'lucide-react'
import type { Song, Section } from '../types/song'
import { prepareFilesForExtraction } from '../lib/fileOptimizer'
import { extractSongsApi } from '../lib/api'
import { getChordPos, nudgeChord, setChordPos } from '../lib/chordNudge'
import SongSheet from './SongSheet'
import { Button, IconButton, StatusBanner } from './ui'
import OverlayDialog from './ui/OverlayDialog'

interface UploadSheetModalProps {
  isOpen: boolean
  onClose: () => void
  onImport: (songs: Song[]) => void | Promise<void>
  /** Render the upload/review flow inline instead of inside its own dialog. */
  inline?: boolean
  /** Notifies the host when the inline flow enters or leaves the extracted-songs review step. */
  onReviewChange?: (isReviewing: boolean) => void
}

export default function UploadSheetModal({
  isOpen,
  onClose,
  onImport,
  inline = false,
  onReviewChange,
}: UploadSheetModalProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [extractionProgress, setExtractionProgress] = useState<{ completed: number; total: number } | null>(null)
  const [expectedSongCount, setExpectedSongCount] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showKeyConfig, setShowKeyConfig] = useState(false)
  const [apiKey, setApiKey] = useState(() => {
    try {
      return localStorage.getItem('gemini_api_key') || ''
    } catch {
      return ''
    }
  })

  // Review step state
  const [extractedSongs, setExtractedSongs] = useState<Song[] | null>(null)
  const [activePreviewIndex, setActivePreviewIndex] = useState(0)
  const [selectedChord, setSelectedChord] = useState<{
    songIndex: number
    sectionIndex: number
    lineIndex: number
    chordIndex: number
    /** Position when selected, restored on cancel */
    startPos: number
  } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Keep the host dialog's height in sync with the inline review step.
  const isReviewing = Boolean(extractedSongs)
  useEffect(() => {
    onReviewChange?.(isReviewing)
  }, [isReviewing, onReviewChange])
  useEffect(() => () => onReviewChange?.(false), [onReviewChange])

  const handleApiKeyChange = (val: string) => {
    setApiKey(val)
    if (val.trim()) {
      localStorage.setItem('gemini_api_key', val.trim())
    } else {
      localStorage.removeItem('gemini_api_key')
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files)
      setSelectedFiles((prev) => [...prev, ...filesArray].slice(0, 10))
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files) {
      const filesArray = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === 'application/pdf' || f.type.startsWith('image/')
      )
      setSelectedFiles((prev) => [...prev, ...filesArray].slice(0, 10))
    }
  }

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleExtract = async () => {
    if (selectedFiles.length === 0) return

    const expectedCount = expectedSongCount.trim() ? Number(expectedSongCount) : undefined
    if (expectedCount !== undefined && (!Number.isSafeInteger(expectedCount) || expectedCount < 1)) {
      setErrorMessage('Expected songs must be a positive whole number.')
      return
    }

    setErrorMessage(null)
    setIsProcessing(true)
    setStatusMessage('Reading & optimizing documents...')
    setExtractionProgress(null)

    try {
      const prepared = await prepareFilesForExtraction(selectedFiles)

      setStatusMessage('Checking PDF text layers...')
      const payloadFiles = prepared.map((p) => ({
        mimeType: p.mimeType,
        base64Data: p.base64Data,
      }))

      const songs = await extractSongsApi(
        payloadFiles,
        apiKey.trim() || undefined,
        expectedCount,
        ({ message, completed, total }) => {
          setStatusMessage(message)
          if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
            setExtractionProgress({ completed, total })
          }
        }
      )

      setExtractedSongs(songs)
      setSelectedChord(null)
      setActivePreviewIndex(0)
      setStatusMessage('')
      setExtractionProgress(null)
    } catch (err) {
      trackSongImport('upload', 0, 1)
      setErrorMessage((err as Error).message || 'Extraction failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleUpdateSongField = (index: number, field: keyof Song, value: string) => {
    if (!extractedSongs) return
    setExtractedSongs((prev) => {
      if (!prev) return prev
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const handleRemoveSong = (index: number) => {
    if (!extractedSongs) return
    const updated = extractedSongs.filter((_, i) => i !== index)
    if (updated.length === 0) {
      setExtractedSongs(null)
    } else {
      setExtractedSongs(updated)
      if (activePreviewIndex >= updated.length) {
        setActivePreviewIndex(updated.length - 1)
      }
    }
  }

  const handleConfirmImport = async () => {
    if (isProcessing) return
    if (extractedSongs && extractedSongs.length > 0) {
      setIsProcessing(true)
      try {
        await onImport(extractedSongs)
      } catch {
        trackSongImport('upload', 0, extractedSongs.length)
        setErrorMessage('Could not save imported songs. Please try again.')
        return
      } finally {
        setIsProcessing(false)
      }
      onClose()
      // Reset state
      setSelectedFiles([])
      setExpectedSongCount('')
      setExtractedSongs(null)
    }
  }

  const activeSelection =
    extractedSongs && selectedChord && selectedChord.songIndex === activePreviewIndex
      ? selectedChord
      : null

  const selectedChordName = (() => {
    if (!activeSelection || !extractedSongs) return null
    const line =
      extractedSongs[activePreviewIndex]?.sections[activeSelection.sectionIndex]?.lines[
        activeSelection.lineIndex
      ]
    return line && line.kind === 'lyric' ? line.chords[activeSelection.chordIndex]?.chord ?? null : null
  })()

  const updateActiveSections = (fn: (sections: Section[]) => Section[]) => {
    setExtractedSongs((prev) => {
      if (!prev) return prev
      return prev.map((song, i) =>
        i === activePreviewIndex ? { ...song, sections: fn(song.sections) } : song
      )
    })
  }

  const handleSelectChord = (sectionIndex: number, lineIndex: number, chordIndex: number) => {
    // Tapping the selected chord again, or another chord, keeps the current position
    // (implicit confirm) and moves selection.
    if (
      activeSelection &&
      activeSelection.sectionIndex === sectionIndex &&
      activeSelection.lineIndex === lineIndex &&
      activeSelection.chordIndex === chordIndex
    ) {
      return
    }
    const startPos = extractedSongs
      ? getChordPos(extractedSongs[activePreviewIndex].sections, sectionIndex, lineIndex, chordIndex)
      : null
    if (startPos === null) return
    setSelectedChord({ songIndex: activePreviewIndex, sectionIndex, lineIndex, chordIndex, startPos })
  }

  const handleNudge = (delta: number) => {
    if (!activeSelection) return
    updateActiveSections((sections) =>
      nudgeChord(sections, activeSelection.sectionIndex, activeSelection.lineIndex, activeSelection.chordIndex, delta)
    )
  }

  const handleConfirmNudge = () => setSelectedChord(null)

  const handleCancelNudge = () => {
    if (activeSelection) {
      updateActiveSections((sections) =>
        setChordPos(
          sections,
          activeSelection.sectionIndex,
          activeSelection.lineIndex,
          activeSelection.chordIndex,
          activeSelection.startPos
        )
      )
    }
    setSelectedChord(null)
  }

  const dialogFooter = !extractedSongs ? (
    <>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button
        variant="primary"
        icon={<FileUp size={15} />}
        disabled={selectedFiles.length === 0 || isProcessing}
        loading={isProcessing}
        onClick={handleExtract}
      >
        Extract with Gemini ({selectedFiles.length})
      </Button>
    </>
  ) : undefined

  const content = (
    <>
          {errorMessage && (
            <StatusBanner tone="error" icon={<AlertTriangle size={17} />} className="p-4 text-sm">
              <div className="flex-1">
                <div className="font-semibold">Extraction error</div>
                <div className="mt-0.5 text-xs opacity-90">{errorMessage}</div>
                {errorMessage.includes('GEMINI_API_KEY') && (
                  <div className="mt-2 text-xs text-ui-accent-strong">
                    You can paste your free API key from{' '}
                    <a
                      href="https://aistudio.google.com"
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-bold"
                    >
                      aistudio.google.com
                    </a>{' '}
                    in the API Key settings below.
                  </div>
                )}
              </div>
            </StatusBanner>
          )}

          {!extractedSongs ? (
            /* Upload & Selection View */
            <div className="space-y-3 sm:space-y-5">
              {/* Dropzone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-ui-border hover:border-ui-accent bg-ui-surface hover:bg-ui-surface-muted transition rounded-xl p-4 sm:p-8 text-center cursor-pointer flex flex-col items-center justify-center gap-3 shadow-xs"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ui-accent/10 text-ui-accent-strong">
                  <FileUp size={22} />
                </div>
                <div>
                  <p className="text-sm font-medium text-ui-text">
                    Click to browse or drop SongSelect PDF / images here
                  </p>
                  <p className="text-xs text-ui-text-muted mt-1">
                    Supports .pdf (multi-page packets supported), .png, .jpg, .jpeg, .webp (up to 10 files)
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,image/png,image/jpeg,image/webp"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {/* Selected Files List */}
              {selectedFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-ui-text-muted uppercase tracking-wider">
                    Selected Files ({selectedFiles.length})
                  </div>
                  <div className="space-y-2 max-h-28 sm:max-h-48 overflow-y-auto">
                    {selectedFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 bg-ui-surface border border-ui-border rounded-lg text-sm text-ui-text shadow-xs"
                      >
                        <div className="flex items-center gap-3 truncate">
                          <span className="text-ui-text-muted font-mono text-xs bg-ui-surface-muted px-1.5 py-0.5 rounded">
                            {file.type === 'application/pdf' ? 'PDF' : 'IMG'}
                          </span>
                          <span className="truncate">{file.name}</span>
                          <span className="text-xs text-ui-text-muted">
                            ({(file.size / 1024).toFixed(0)} KB)
                          </span>
                        </div>
                        <IconButton
                          variant="ghost"
                          label="Remove file"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveFile(idx)
                          }}
                        >
                          <X size={14} />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                  <label className="block text-xs text-neutral-600 dark:text-neutral-300">
                    <span className="font-semibold">Expected songs (optional)</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={expectedSongCount}
                      onChange={(e) => setExpectedSongCount(e.target.value)}
                      placeholder="e.g. 4"
                      className="ui-field ui-field--sm mt-1.5 block w-full max-w-40"
                    />
                    <span className="mt-1 block text-[11px] text-ui-text-muted">
                      We will check all extracted pages and tell you if another pass is needed.
                    </span>
                  </label>
                </div>
              )}

              {/* Optional Custom API Key accordion */}
              <div className="border border-ui-border rounded-lg bg-ui-surface p-3 shadow-xs">
                <button
                  type="button"
                  onClick={() => setShowKeyConfig(!showKeyConfig)}
                  className="w-full flex items-center justify-between text-xs text-ui-text-muted hover:text-ui-text cursor-pointer"
                >
                  <span className="flex items-center gap-1.5"><KeyRound size={14} /> Custom Gemini API key (optional)</span>
                  {showKeyConfig ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showKeyConfig && (
                  <div className="mt-3 pt-3 border-t border-ui-border space-y-2">
                    <p className="text-xs text-ui-text-muted">
                      Optional for selectable-text PDFs. Scanned pages use Gemini; if running locally or using your own personal free quota from{' '}
                      <a
                        href="https://aistudio.google.com"
                        target="_blank"
                        rel="noreferrer"
                        className="text-ui-accent-strong underline font-medium"
                      >
                        Google AI Studio
                      </a>
                      , paste it here. It is saved only in your browser:
                    </p>
                    <input
                      type="password"
                      placeholder="AIzaSy..."
                      value={apiKey}
                      onChange={(e) => handleApiKeyChange(e.target.value)}
                      className="ui-field ui-field--sm w-full"
                    />
                  </div>
                )}
              </div>

              {/* Processing Status */}
              {isProcessing && (
                <div className="p-4 rounded-lg bg-ui-accent/10 border border-ui-accent/30 shadow-2xs">
                  <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 shrink-0 border-2 border-ui-accent border-t-transparent" />
                    <div className="text-sm text-ui-accent-strong font-medium">{statusMessage}</div>
                  </div>
                  <div
                    className="mt-3 h-2 overflow-hidden rounded-full bg-ui-accent/15"
                    role="progressbar"
                    aria-label="PDF extraction progress"
                    aria-valuemin={0}
                    aria-valuemax={extractionProgress?.total}
                    aria-valuenow={extractionProgress?.completed}
                  >
                    <div
                      className={`h-full rounded-full bg-ui-accent transition-all duration-500 ${extractionProgress ? '' : 'w-full animate-pulse'}`}
                      style={extractionProgress ? { width: `${Math.min(100, (extractionProgress.completed / extractionProgress.total) * 100)}%` } : undefined}
                    />
                  </div>
                  {extractionProgress && (
                    <div className="mt-1.5 text-right text-xs text-ui-accent-strong/80">
                      {Math.min(extractionProgress.completed, extractionProgress.total)} of {extractionProgress.total} pages processed
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Review & Preview View */
            <div className="flex flex-col gap-2 sm:gap-3 flex-1 min-h-0">
              {/* Songs Tabs */}
              <div className="flex items-center gap-2 border-b border-ui-border pb-2 overflow-x-auto shrink-0">
                {extractedSongs.map((song, idx) => (
                  <button
                    key={song.id || idx}
                    onClick={() => setActivePreviewIndex(idx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition shrink-0 flex items-center gap-2 cursor-pointer shadow-2xs ${
                      activePreviewIndex === idx
                        ? 'bg-ui-accent text-ui-on-accent border border-ui-accent'
                        : 'bg-ui-surface border border-ui-border text-ui-text-muted hover:text-ui-text'
                    }`}
                  >
                    <span>{song.title || `Song ${idx + 1}`}</span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveSong(idx)
                      }}
                      className="text-ui-text-muted hover:text-red-600 dark:hover:text-red-400 text-[10px] ml-1"
                      title="Remove song"
                    >
                      ✕
                    </span>
                  </button>
                ))}
              </div>

              {/* Editable Fields for Active Song */}
              {extractedSongs[activePreviewIndex] && (
                <div className="grid grid-cols-[1fr_1fr_4.5rem] sm:grid-cols-3 gap-2 sm:gap-3 shrink-0 bg-ui-surface p-2 sm:p-3 border border-ui-border rounded-lg shadow-xs">
                  <div>
                    <label className="text-[11px] font-semibold text-ui-text-muted uppercase tracking-wider block mb-0.5 sm:mb-1 truncate">
                      Song Title
                    </label>
                    <input
                      type="text"
                      value={extractedSongs[activePreviewIndex].title}
                      onChange={(e) =>
                        handleUpdateSongField(activePreviewIndex, 'title', e.target.value)
                      }
                      className="ui-field ui-field--sm w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-ui-text-muted uppercase tracking-wider block mb-0.5 sm:mb-1 truncate">
                      Artist / Composer
                    </label>
                    <input
                      type="text"
                      value={extractedSongs[activePreviewIndex].artist}
                      onChange={(e) =>
                        handleUpdateSongField(activePreviewIndex, 'artist', e.target.value)
                      }
                      className="ui-field ui-field--sm w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-ui-text-muted uppercase tracking-wider block mb-0.5 sm:mb-1 truncate">
                      Key
                    </label>
                    <input
                      type="text"
                      value={extractedSongs[activePreviewIndex].originalKey || ''}
                      onChange={(e) =>
                        handleUpdateSongField(activePreviewIndex, 'originalKey', e.target.value)
                      }
                      placeholder="e.g. G, Bb, D"
                      className="ui-field ui-field--sm w-full"
                    />
                  </div>
                </div>
              )}

              {/* Song Preview Render */}
              {extractedSongs[activePreviewIndex] && (
                <div className="flex flex-col gap-2 flex-1 min-h-0">
                  <div className="flex-1 min-h-[6rem] border border-ui-border rounded-xl bg-ui-surface p-3 sm:p-4 overflow-y-auto shadow-xs">
                    <div className="text-xs text-ui-text-muted mb-2 flex items-center justify-between">
                      <span className="font-semibold uppercase tracking-wider text-[11px]">Layout Preview</span>
                      <span>
                        {extractedSongs[activePreviewIndex].sections.length} unique sections
                      </span>
                    </div>
                    <SongSheet
                      sections={extractedSongs[activePreviewIndex].sections}
                      columns={1}
                      fontSizePx={13}
                      onChordSelect={handleSelectChord}
                      selectedChord={activeSelection}
                    />
                  </div>

                  {/* Chord position adjuster */}
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-ui-border bg-ui-surface px-3 py-2 shadow-xs shrink-0 flex-wrap min-h-[52px]">
                    {activeSelection && selectedChordName ? (
                      <>
                        <div className="text-xs text-ui-text-muted min-w-0">
                          Moving{' '}
                          <span className="font-mono font-bold text-ui-accent-strong">
                            {selectedChordName}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <IconButton
                            variant="secondary"
                            label="Move chord left"
                            onClick={() => handleNudge(-1)}
                          >
                            <ChevronLeft size={16} />
                          </IconButton>
                          <IconButton
                            variant="secondary"
                            label="Move chord right"
                            onClick={() => handleNudge(1)}
                          >
                            <ChevronRight size={16} />
                          </IconButton>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            icon={<Check size={14} />}
                            onClick={handleConfirmNudge}
                          >
                            Confirm
                          </Button>
                          <IconButton
                            variant="ghost"
                            label="Cancel and restore position"
                            onClick={handleCancelNudge}
                          >
                            <X size={16} />
                          </IconButton>
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-ui-text-muted">
                        Chord out of place? Tap it in the preview, then use the arrows to nudge it.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Review actions (moved out of the sticky footer, below the chord toolbar) */}
              <div className="flex items-center justify-between gap-3 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ArrowLeft size={14} />}
                  onClick={() => {
                    setExtractedSongs(null)
                    setSelectedChord(null)
                  }}
                >
                  Back to upload
                </Button>
                <Button variant="success" onClick={handleConfirmImport}>
                  Import {extractedSongs.length} Song{extractedSongs.length > 1 ? 's' : ''} to Setlist
                </Button>
              </div>
            </div>
          )}
    </>
  )

  if (inline) {
    return (
      <div className={extractedSongs ? 'flex flex-col gap-2 sm:gap-3' : 'space-y-4'}>
        {content}
        {dialogFooter && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--ui-border)] pt-3">
            {dialogFooter}
          </div>
        )}
      </div>
    )
  }

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={extractedSongs ? 'Review extracted songs' : 'Upload chord charts'}
      description={extractedSongs
        ? `Found ${extractedSongs.length} song${extractedSongs.length > 1 ? 's' : ''}. Review them before adding them to your setlist.`
        : 'Import multi-page SongSelect PDFs or sheet images with Gemini-assisted extraction.'}
      size="lg"
      className={extractedSongs ? 'h-[92dvh]' : ''}
      contentClassName={`bg-[var(--ui-surface-muted)] p-3 sm:p-4 ${extractedSongs ? 'flex flex-col gap-2 sm:gap-3 overflow-hidden' : 'space-y-4'}`}
      closeOnBackdrop={!isProcessing}
      footer={dialogFooter}
    >
      {content}
    </OverlayDialog>
  )
}
