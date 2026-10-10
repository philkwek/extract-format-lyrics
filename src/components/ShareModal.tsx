import { useState, useEffect, useRef } from 'react'
import { createShareApi } from '../lib/api'
import type { SharedSetSnapshot } from '../types/song'

interface ShareModalProps {
  snapshot: SharedSetSnapshot
  isOpen: boolean
  onClose: () => void
}

export default function ShareModal({ snapshot, isOpen, onClose }: ShareModalProps) {
  const [copied, setCopied] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(true)
  const requestRef = useRef<ReturnType<typeof createShareApi> | null>(null)

  useEffect(() => {
    let active = true
    if (isOpen) {
      requestRef.current ??= createShareApi(snapshot)
      requestRef.current
        .then(({ id, expiresAt: expiry }) => {
          if (active) {
            setShareUrl(`${window.location.origin}/s/${id}`)
            setExpiresAt(expiry)
            setIsGenerating(false)
          }
        })
        .catch((err: Error) => {
          if (active) {
            setError(err.message || 'Failed to create sharing link')
            setIsGenerating(false)
          }
        })
    }
    return () => {
      active = false
    }
  }, [isOpen, snapshot])

  if (!isOpen) return null

  const handleCopy = async () => {
    try {
      if (!shareUrl) return
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Fallback prompt if clipboard API blocked
      window.prompt('Copy this share link:', shareUrl || '')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#282828] rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-2 border-b border-neutral-200 dark:border-[#282828]">
          <h3 className="text-base font-bold text-neutral-900 dark:text-[#e5e5e5]">
            Share Setlist: {snapshot.name}
          </h3>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 dark:text-[#999999] dark:hover:text-[#e5e5e5] text-lg font-bold p-1 cursor-pointer"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-neutral-600 dark:text-[#999999]">
          Anyone with this link can recreate this setlist ({snapshot.songs.length} songs), including musical edits and transpositions. It expires after seven days.
        </p>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={shareUrl || (isGenerating ? 'Creating sharing link…' : '')}
              className="flex-1 bg-neutral-100 dark:bg-[#101010] border border-neutral-300 dark:border-[#282828] rounded-lg px-3 py-2 text-xs font-mono text-neutral-900 dark:text-[#e5e5e5] select-all focus:outline-none"
            />
            <button
              onClick={handleCopy}
              disabled={!shareUrl}
              className="px-4 py-2 bg-[#3368A0] hover:bg-[#255283] font-semibold text-white text-xs rounded-lg transition-colors cursor-pointer shrink-0 dark:bg-amber-500 dark:hover:bg-amber-600 dark:text-black"
            >
              {copied ? 'Copied ✓' : 'Copy Link'}
            </button>
          </div>
          <div className="flex items-center justify-between text-[11px] text-neutral-500 dark:text-[#999999]">
            <span>{isGenerating ? 'Creating sharing link...' : error ? error : expiresAt ? `Expires ${new Date(expiresAt).toLocaleString()}` : ''}</span>
            {copied && <span className="text-emerald-500 font-medium">Copied to clipboard!</span>}
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-200 hover:bg-neutral-300 dark:bg-[#282828] dark:hover:bg-[#333333] text-neutral-800 dark:text-[#e5e5e5] text-xs font-medium rounded-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
