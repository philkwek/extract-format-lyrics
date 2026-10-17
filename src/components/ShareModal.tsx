import { trackEvent } from '../lib/analytics'
import { useState } from 'react'
import { Check, Copy, Link2 } from 'lucide-react'
import { createShareApi } from '../lib/api'
import type { SharedSetSnapshot } from '../types/song'
import { Button, StatusBanner } from './ui'
import OverlayDialog from './ui/OverlayDialog'

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
  const [isGenerating, setIsGenerating] = useState(false)

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

  const handlePrimaryAction = async () => {
    if (shareUrl) {
      await handleCopy()
      return
    }
    await handleGenerate()
  }

  const handleGenerate = async () => {
    if (isGenerating || shareUrl) return
    setIsGenerating(true)
    setError(null)
    try {
      const { id, expiresAt: expiry } = await createShareApi(snapshot)
      setShareUrl(`${window.location.origin}/s/${id}`)
      setExpiresAt(expiry)
      trackEvent('set_shared', { song_count: snapshot.songs.length })
    } catch (err) {
      setError((err as Error).message || 'Failed to create sharing link')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Share “${snapshot.name}”`}
      description={`Create a private snapshot link for ${snapshot.songs.length} song${snapshot.songs.length === 1 ? '' : 's'}. Musical edits and transpositions are included.`}
      size="sm"
      footer={<Button variant="ghost" onClick={onClose}>Done</Button>}
    >
      <div className="space-y-4">
        <StatusBanner tone="info" icon={<Link2 size={16} />}>
          Anyone with the link can recreate this setlist. The link expires automatically after seven days.
        </StatusBanner>

        <div className="space-y-2">
          <label htmlFor="share-set-url" className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]">Share link</label>
          <input
            id="share-set-url"
            type="text"
            readOnly
            value={shareUrl || (isGenerating ? 'Creating sharing link…' : 'Generate a link when you are ready')}
            className="ui-field select-all px-3 py-2.5 font-mono text-xs"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className={`text-[11px] ${error ? 'text-red-600 dark:text-red-300' : 'text-[var(--ui-text-muted)]'}`}>
              {isGenerating ? 'Creating sharing link…' : error ? error : expiresAt ? `Expires ${new Date(expiresAt).toLocaleString()}` : 'A link has not been generated yet.'}
            </span>
            <Button
              variant="primary"
              icon={copied ? <Check size={15} /> : shareUrl ? <Copy size={15} /> : <Link2 size={15} />}
              onClick={handlePrimaryAction}
              loading={isGenerating}
            >
              {shareUrl ? (copied ? 'Copied' : 'Copy link') : 'Generate link'}
            </Button>
          </div>
        </div>
      </div>
    </OverlayDialog>
  )
}
