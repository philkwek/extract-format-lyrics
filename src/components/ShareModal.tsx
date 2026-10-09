import { useState, useEffect } from 'react'
import { createShortLinkApi } from '../lib/api'
import { encodeSharePayload } from '../lib/shareLink'
import type { SharePayload } from '../types/song'

interface ShareModalProps {
  payload: SharePayload
  isOpen: boolean
  onClose: () => void
}

export default function ShareModal({ payload, isOpen, onClose }: ShareModalProps) {
  const [copied, setCopied] = useState(false)
  const [shortUrl, setShortUrl] = useState<string | null>(null)
  const [isGeneratingShort, setIsGeneratingShort] = useState(false)

  const clientHashUrl = `${window.location.origin}/#/share#${encodeSharePayload(payload)}`
  const displayUrl = shortUrl || clientHashUrl

  useEffect(() => {
    let active = true
    if (isOpen) {
      createShortLinkApi(payload)
        .then((id) => {
          if (active) {
            setShortUrl(`${window.location.origin}/#/s/${id}`)
            setIsGeneratingShort(false)
          }
        })
        .catch(() => {
          if (active) {
            setIsGeneratingShort(false)
          }
        })
    }
    return () => {
      active = false
    }
  }, [isOpen, payload])

  if (!isOpen) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Fallback prompt if clipboard API blocked
      window.prompt('Copy this share link:', displayUrl)
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
            Share Setlist: {payload.name}
          </h3>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 dark:text-[#999999] dark:hover:text-[#e5e5e5] text-lg font-bold p-1 cursor-pointer"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-neutral-600 dark:text-[#999999]">
          Anyone with this link can open and recreate this setlist ({payload.songs.length} songs) with your transpositions and custom arrangements.
        </p>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={displayUrl}
              className="flex-1 bg-neutral-100 dark:bg-[#101010] border border-neutral-300 dark:border-[#282828] rounded-lg px-3 py-2 text-xs font-mono text-neutral-900 dark:text-[#e5e5e5] select-all focus:outline-none"
            />
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 font-semibold text-black text-xs rounded-lg transition-colors cursor-pointer shrink-0"
            >
              {copied ? 'Copied ✓' : 'Copy Link'}
            </button>
          </div>
          <div className="flex items-center justify-between text-[11px] text-neutral-500 dark:text-[#999999]">
            <span>
              {isGeneratingShort ? 'Generating short link...' : shortUrl ? 'Short link ready ✓' : 'Client URL ready'}
            </span>
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
