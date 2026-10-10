import { useState, useRef } from 'react'
import type { Song, Section } from '../types/song'
import { prepareFilesForExtraction } from '../lib/fileOptimizer'
import { extractSongsApi } from '../lib/api'
import { getChordPos, nudgeChord, setChordPos } from '../lib/chordNudge'
import SongSheet from './SongSheet'

interface UploadSheetModalProps {
  isOpen: boolean
  onClose: () => void
  onImport: (songs: Song[]) => void
}

export default function UploadSheetModal({
  isOpen,
  onClose,
  onImport,
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

  if (!isOpen) return null

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

  const handleConfirmImport = () => {
    if (extractedSongs && extractedSongs.length > 0) {
      onImport(extractedSongs)
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-2 sm:p-4 overflow-hidden">
      <div
        className={`w-full max-w-4xl bg-white dark:bg-[#1a1a1a] border border-[#C8DFDB] dark:border-[#282828] rounded-xl shadow-2xl flex flex-col max-h-full ${extractedSongs ? 'h-full' : ''} overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#C8DFDB] dark:border-[#282828] px-4 sm:px-6 py-2.5 sm:py-3 bg-white dark:bg-[#1a1a1a] shrink-0">
          <div>
            <h2 className="text-lg font-bold text-neutral-900 dark:text-[#e5e5e5] flex items-center gap-2">
              <svg className="w-5 h-5 text-[#3368A0] dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              {extractedSongs ? 'Review Extracted Songs' : 'Upload PDF/Image (EXPERIMENTAL FEATURE!)'}
            </h2>
            <p className="hidden sm:block text-xs text-neutral-500 dark:text-[#999999] mt-0.5">
              {extractedSongs
                ? `Found ${extractedSongs.length} song${extractedSongs.length > 1 ? 's' : ''}. Review and confirm before adding to setlist.`
                : 'Upload multi-page SongSelect PDFs or PNG/JPG sheet images. Gemini Flash extracts lyrics and chords.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 dark:text-[#999999] dark:hover:text-[#e5e5e5] p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-[#252525] transition cursor-pointer"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className={`flex-1 min-h-0 bg-neutral-50/60 dark:bg-[#151515] p-3 sm:p-4 ${extractedSongs ? 'flex flex-col gap-2 sm:gap-3 overflow-hidden' : 'overflow-y-auto space-y-4'}`}>
          {errorMessage && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/60 dark:border-red-800 dark:text-red-200 text-sm flex items-start gap-3 shadow-2xs">
              <span className="text-lg">⚠️</span>
              <div className="flex-1">
                <div className="font-semibold">Extraction Error</div>
                <div className="mt-0.5 text-xs opacity-90">{errorMessage}</div>
                {errorMessage.includes('GEMINI_API_KEY') && (
                  <div className="mt-2 text-xs text-[#3368A0] dark:text-amber-300">
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
            </div>
          )}

          {!extractedSongs ? (
            /* Upload & Selection View */
            <div className="space-y-3 sm:space-y-5">
              {/* Dropzone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-[#C8DFDB] hover:border-[#3368A0] dark:border-[#282828] dark:hover:border-amber-500/70 bg-white hover:bg-neutral-50 dark:bg-[#1a1a1a]/60 dark:hover:bg-[#1a1a1a] transition rounded-xl p-4 sm:p-8 text-center cursor-pointer flex flex-col items-center justify-center gap-3 shadow-xs"
              >
                <div className="w-12 h-12 rounded-full bg-[#3368A0]/10 dark:bg-amber-500/10 flex items-center justify-center text-[#3368A0] dark:text-amber-400 text-2xl">
                  📄
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-800 dark:text-[#e5e5e5]">
                    Click to browse or drop SongSelect PDF / images here
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-[#999999] mt-1">
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
                  <div className="text-xs font-semibold text-neutral-500 dark:text-[#999999] uppercase tracking-wider">
                    Selected Files ({selectedFiles.length})
                  </div>
                  <div className="space-y-2 max-h-28 sm:max-h-48 overflow-y-auto">
                    {selectedFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 bg-white dark:bg-[#1a1a1a] border border-[#C8DFDB] dark:border-[#282828] rounded-lg text-sm text-neutral-800 dark:text-[#e5e5e5] shadow-xs"
                      >
                        <div className="flex items-center gap-3 truncate">
                          <span className="text-neutral-500 dark:text-neutral-400 font-mono text-xs bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">
                            {file.type === 'application/pdf' ? 'PDF' : 'IMG'}
                          </span>
                          <span className="truncate">{file.name}</span>
                          <span className="text-xs text-neutral-400 dark:text-neutral-500">
                            ({(file.size / 1024).toFixed(0)} KB)
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveFile(idx)
                          }}
                          className="text-neutral-400 hover:text-red-600 dark:hover:text-red-400 p-1 text-xs transition cursor-pointer"
                          title="Remove file"
                        >
                          ✕
                        </button>
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
                      className="mt-1.5 block w-full max-w-40 rounded-md border border-[#C8DFDB] bg-white px-2.5 py-1.5 text-sm text-neutral-800 dark:border-[#282828] dark:bg-[#151515] dark:text-[#e5e5e5]"
                    />
                    <span className="mt-1 block text-[11px] text-neutral-500 dark:text-neutral-400">
                      We will check all extracted pages and tell you if another pass is needed.
                    </span>
                  </label>
                </div>
              )}

              {/* Optional Custom API Key accordion */}
              <div className="border border-[#C8DFDB] dark:border-[#282828] rounded-lg bg-white dark:bg-[#1a1a1a]/50 p-3 shadow-xs">
                <button
                  type="button"
                  onClick={() => setShowKeyConfig(!showKeyConfig)}
                  className="w-full flex items-center justify-between text-xs text-neutral-600 dark:text-[#999999] hover:text-neutral-900 dark:hover:text-[#e5e5e5] cursor-pointer"
                >
                  <span>🔑 Custom Gemini API Key (Optional)</span>
                  <span>{showKeyConfig ? '▲' : '▼'}</span>
                </button>
                {showKeyConfig && (
                  <div className="mt-3 pt-3 border-t border-[#C8DFDB] dark:border-[#282828] space-y-2">
                    <p className="text-xs text-neutral-500 dark:text-[#999999]">
                      Optional for selectable-text PDFs. Scanned pages use Gemini; if running locally or using your own personal free quota from{' '}
                      <a
                        href="https://aistudio.google.com"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#3368A0] dark:text-amber-400 underline font-medium"
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
                      className="w-full bg-neutral-50 dark:bg-[#101010] border border-neutral-300 dark:border-[#282828] rounded px-3 py-1.5 text-xs text-neutral-900 dark:text-[#e5e5e5] focus:outline-none focus:border-[#3368A0] dark:focus:border-amber-500"
                    />
                  </div>
                )}
              </div>

              {/* Processing Status */}
              {isProcessing && (
                <div className="p-4 rounded-lg bg-[#3368A0]/10 border border-[#3368A0]/30 dark:bg-amber-950/30 dark:border-amber-900/50 shadow-2xs">
                  <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 shrink-0 border-2 border-[#3368A0] dark:border-amber-400 border-t-transparent" />
                    <div className="text-sm text-[#255283] dark:text-amber-200 font-medium">{statusMessage}</div>
                  </div>
                  <div
                    className="mt-3 h-2 overflow-hidden rounded-full bg-[#3368A0]/15 dark:bg-amber-100/10"
                    role="progressbar"
                    aria-label="PDF extraction progress"
                    aria-valuemin={0}
                    aria-valuemax={extractionProgress?.total}
                    aria-valuenow={extractionProgress?.completed}
                  >
                    <div
                      className={`h-full rounded-full bg-[#3368A0] dark:bg-amber-400 transition-all duration-500 ${extractionProgress ? '' : 'w-full animate-pulse'}`}
                      style={extractionProgress ? { width: `${Math.min(100, (extractionProgress.completed / extractionProgress.total) * 100)}%` } : undefined}
                    />
                  </div>
                  {extractionProgress && (
                    <div className="mt-1.5 text-right text-xs text-[#255283]/80 dark:text-amber-200/80">
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
              <div className="flex items-center gap-2 border-b border-[#C8DFDB] dark:border-[#282828] pb-2 overflow-x-auto shrink-0">
                {extractedSongs.map((song, idx) => (
                  <button
                    key={song.id || idx}
                    onClick={() => setActivePreviewIndex(idx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition shrink-0 flex items-center gap-2 cursor-pointer shadow-2xs ${
                      activePreviewIndex === idx
                        ? 'bg-[#3368A0]/15 text-[#255283] border border-[#3368A0]/40 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40'
                        : 'bg-white dark:bg-[#1a1a1a] border border-[#C8DFDB] dark:border-[#282828] text-neutral-600 dark:text-[#999999] hover:text-neutral-900 dark:hover:text-[#e5e5e5]'
                    }`}
                  >
                    <span>{song.title || `Song ${idx + 1}`}</span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveSong(idx)
                      }}
                      className="text-neutral-400 hover:text-red-600 dark:text-neutral-500 dark:hover:text-red-400 text-[10px] ml-1"
                      title="Remove song"
                    >
                      ✕
                    </span>
                  </button>
                ))}
              </div>

              {/* Editable Fields for Active Song */}
              {extractedSongs[activePreviewIndex] && (
                <div className="grid grid-cols-[1fr_1fr_4.5rem] sm:grid-cols-3 gap-2 sm:gap-3 shrink-0 bg-white dark:bg-[#1a1a1a]/60 p-2 sm:p-3 border border-[#C8DFDB] dark:border-[#282828] rounded-lg shadow-xs">
                  <div>
                    <label className="text-[11px] font-semibold text-neutral-500 dark:text-[#999999] uppercase tracking-wider block mb-0.5 sm:mb-1 truncate">
                      Song Title
                    </label>
                    <input
                      type="text"
                      value={extractedSongs[activePreviewIndex].title}
                      onChange={(e) =>
                        handleUpdateSongField(activePreviewIndex, 'title', e.target.value)
                      }
                      className="w-full bg-neutral-50 dark:bg-[#101010] border border-neutral-300 dark:border-[#282828] rounded px-2.5 py-1.5 text-xs text-neutral-900 dark:text-[#e5e5e5] focus:outline-none focus:border-[#3368A0] dark:focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-neutral-500 dark:text-[#999999] uppercase tracking-wider block mb-0.5 sm:mb-1 truncate">
                      Artist / Composer
                    </label>
                    <input
                      type="text"
                      value={extractedSongs[activePreviewIndex].artist}
                      onChange={(e) =>
                        handleUpdateSongField(activePreviewIndex, 'artist', e.target.value)
                      }
                      className="w-full bg-neutral-50 dark:bg-[#101010] border border-neutral-300 dark:border-[#282828] rounded px-2.5 py-1.5 text-xs text-neutral-900 dark:text-[#e5e5e5] focus:outline-none focus:border-[#3368A0] dark:focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-neutral-500 dark:text-[#999999] uppercase tracking-wider block mb-0.5 sm:mb-1 truncate">
                      Key
                    </label>
                    <input
                      type="text"
                      value={extractedSongs[activePreviewIndex].originalKey || ''}
                      onChange={(e) =>
                        handleUpdateSongField(activePreviewIndex, 'originalKey', e.target.value)
                      }
                      placeholder="e.g. G, Bb, D"
                      className="w-full bg-neutral-50 dark:bg-[#101010] border border-neutral-300 dark:border-[#282828] rounded px-2.5 py-1.5 text-xs text-neutral-900 dark:text-[#e5e5e5] focus:outline-none focus:border-[#3368A0] dark:focus:border-amber-500"
                    />
                  </div>
                </div>
              )}

              {/* Song Preview Render */}
              {extractedSongs[activePreviewIndex] && (
                <div className="flex flex-col gap-2 flex-1 min-h-0">
                  <div className="flex-1 min-h-[6rem] border border-[#C8DFDB] dark:border-[#282828] rounded-xl bg-white dark:bg-[#101010] p-3 sm:p-4 overflow-y-auto shadow-xs">
                    <div className="text-xs text-neutral-500 dark:text-[#999999] mb-2 flex items-center justify-between">
                      <span className="font-semibold uppercase tracking-wider text-[11px]">Layout Preview</span>
                      <span>
                        {extractedSongs[activePreviewIndex].sections.length} sections detected
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
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-[#C8DFDB] dark:border-[#282828] bg-white dark:bg-[#1a1a1a] px-3 py-2 shadow-xs shrink-0 flex-wrap min-h-[52px]">
                    {activeSelection && selectedChordName ? (
                      <>
                        <div className="text-xs text-neutral-600 dark:text-[#999999] min-w-0">
                          Moving{' '}
                          <span className="font-mono font-bold text-[#255283] dark:text-amber-400">
                            {selectedChordName}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleNudge(-1)}
                            aria-label="Move chord left"
                            className="w-11 h-9 rounded-lg border border-[#C8DFDB] dark:border-[#282828] text-base font-bold text-neutral-800 dark:text-[#e5e5e5] hover:bg-neutral-100 dark:hover:bg-[#252525] active:scale-95 transition cursor-pointer select-none"
                          >
                            &lt;
                          </button>
                          <button
                            type="button"
                            onClick={() => handleNudge(1)}
                            aria-label="Move chord right"
                            className="w-11 h-9 rounded-lg border border-[#C8DFDB] dark:border-[#282828] text-base font-bold text-neutral-800 dark:text-[#e5e5e5] hover:bg-neutral-100 dark:hover:bg-[#252525] active:scale-95 transition cursor-pointer select-none"
                          >
                            &gt;
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleConfirmNudge}
                            className="px-3 h-9 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-black transition cursor-pointer"
                          >
                            ✓ Confirm
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelNudge}
                            aria-label="Cancel and restore position"
                            title="Cancel and restore position"
                            className="w-9 h-9 rounded-lg border border-[#C8DFDB] dark:border-[#282828] text-sm text-neutral-600 dark:text-[#999999] hover:text-red-600 hover:bg-neutral-100 dark:hover:bg-[#252525] transition cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-neutral-500 dark:text-[#999999]">
                        Chord out of place? Tap it in the preview, then use &lt; &gt; to nudge it.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Review actions (moved out of the sticky footer, below the chord toolbar) */}
              <div className="flex items-center justify-between gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setExtractedSongs(null)
                    setSelectedChord(null)
                  }}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-600 dark:text-[#999999] hover:text-neutral-900 dark:hover:text-[#e5e5e5] hover:bg-neutral-100 dark:hover:bg-[#252525] transition cursor-pointer"
                >
                  ← Back to Upload
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  className="px-5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-black transition flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  Import {extractedSongs.length} Song{extractedSongs.length > 1 ? 's' : ''} to Setlist
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions (upload step only; review actions live below the chord toolbar) */}
        {!extractedSongs && (
          <div className="border-t border-[#C8DFDB] dark:border-[#282828] px-4 sm:px-6 py-3 flex items-center justify-between bg-white dark:bg-[#1a1a1a] shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-600 dark:text-[#999999] hover:text-neutral-900 dark:hover:text-[#e5e5e5] hover:bg-neutral-100 dark:hover:bg-[#252525] transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedFiles.length === 0 || isProcessing}
              onClick={handleExtract}
              className="px-5 py-2 rounded-lg text-xs font-semibold bg-[#3368A0] hover:bg-[#255283] text-white dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-black disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2 cursor-pointer shadow-xs"
            >
              {isProcessing ? 'Extracting...' : `Extract with Gemini (${selectedFiles.length})`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
