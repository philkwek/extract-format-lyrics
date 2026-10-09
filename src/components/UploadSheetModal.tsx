import { useState, useRef } from 'react'
import type { Song } from '../types/song'
import { prepareFilesForExtraction } from '../lib/fileOptimizer'
import { extractSongsApi } from '../lib/api'
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

    setErrorMessage(null)
    setIsProcessing(true)
    setStatusMessage('Reading & optimizing documents...')

    try {
      const prepared = await prepareFilesForExtraction(selectedFiles)

      setStatusMessage('Transcribing SongSelect sheet(s) with Gemini...')
      const payloadFiles = prepared.map((p) => ({
        mimeType: p.mimeType,
        base64Data: p.base64Data,
      }))

      const songs = await extractSongsApi(payloadFiles, apiKey.trim() || undefined)

      setExtractedSongs(songs)
      setActivePreviewIndex(0)
      setStatusMessage('')
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
      setExtractedSongs(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div
        className="w-full max-w-4xl bg-white dark:bg-[#1a1a1a] border border-[#C8DFDB] dark:border-[#282828] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#C8DFDB] dark:border-[#282828] px-6 py-4 bg-white dark:bg-[#1a1a1a]">
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
              {extractedSongs ? 'Review Extracted Songs' : 'Upload SongSelect Sheets (PDF/Images)'}
            </h2>
            <p className="text-xs text-neutral-500 dark:text-[#999999] mt-0.5">
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
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-neutral-50/60 dark:bg-[#151515]">
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
            <div className="space-y-5">
              {/* Dropzone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-[#C8DFDB] hover:border-[#3368A0] dark:border-[#282828] dark:hover:border-amber-500/70 bg-white hover:bg-neutral-50 dark:bg-[#1a1a1a]/60 dark:hover:bg-[#1a1a1a] transition rounded-xl p-8 text-center cursor-pointer flex flex-col items-center justify-center gap-3 shadow-xs"
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
                  <div className="space-y-2 max-h-48 overflow-y-auto">
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
                      If running locally or using your own personal free quota from{' '}
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

              {/* Processing Spinner / Status */}
              {isProcessing && (
                <div className="p-4 rounded-lg bg-[#3368A0]/10 border border-[#3368A0]/30 dark:bg-amber-950/30 dark:border-amber-900/50 flex items-center gap-3 shadow-2xs">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-[#3368A0] dark:border-amber-400 border-t-transparent" />
                  <div className="text-sm text-[#255283] dark:text-amber-200 font-medium">{statusMessage}</div>
                </div>
              )}
            </div>
          ) : (
            /* Review & Preview View */
            <div className="space-y-6">
              {/* Songs Tabs */}
              <div className="flex items-center gap-2 border-b border-[#C8DFDB] dark:border-[#282828] pb-2 overflow-x-auto">
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-white dark:bg-[#1a1a1a]/60 p-4 border border-[#C8DFDB] dark:border-[#282828] rounded-lg shadow-xs">
                  <div>
                    <label className="text-[11px] font-semibold text-neutral-500 dark:text-[#999999] uppercase tracking-wider block mb-1">
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
                    <label className="text-[11px] font-semibold text-neutral-500 dark:text-[#999999] uppercase tracking-wider block mb-1">
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
                    <label className="text-[11px] font-semibold text-neutral-500 dark:text-[#999999] uppercase tracking-wider block mb-1">
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
                <div className="border border-[#C8DFDB] dark:border-[#282828] rounded-xl bg-white dark:bg-[#101010] p-4 max-h-96 overflow-y-auto shadow-xs">
                  <div className="text-xs text-neutral-500 dark:text-[#999999] mb-2 flex items-center justify-between">
                    <span className="font-semibold uppercase tracking-wider text-[11px]">Layout Preview</span>
                    <span>
                      {extractedSongs[activePreviewIndex].sections.length} sections detected
                    </span>
                  </div>
                  <SongSheet
                    sections={extractedSongs[activePreviewIndex].sections}
                    columns={2}
                    fontSizePx={13}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-[#C8DFDB] dark:border-[#282828] px-6 py-4 flex items-center justify-between bg-white dark:bg-[#1a1a1a]">
          {!extractedSongs ? (
            <>
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
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setExtractedSongs(null)}
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
