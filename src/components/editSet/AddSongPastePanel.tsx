import { useState } from 'react'
import { splitUrls } from '../../../functions/src/urls'
import { trackSongImport } from '../../lib/analytics'
import {
  importSources,
  parsePastedSources,
  type ImportProgress,
} from '../../lib/setlistImport'
import type { Session } from '../../lib/sessionStore'
import ImportProgressList from '../import/ImportProgressList'
import PasteUrlForm from '../import/PasteUrlForm'
import { StatusBanner } from '../ui'

interface AddSongPastePanelProps {
  sessionId: string
  onSessionUpdated: (session: Session, firstNewIndex: number) => void | Promise<void>
}

export default function AddSongPastePanel({
  sessionId,
  onSessionUpdated,
}: AddSongPastePanelProps) {
  const [pasteText, setPasteText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [statuses, setStatuses] = useState<ImportProgress[]>([])
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleExtract = async () => {
    setError(null)
    setSuccessMessage(null)
    const { sources, invalid, tokenCount } = parsePastedSources(pasteText)
    if (tokenCount === 0) {
      setError('Please paste at least one chord sheet URL.')
      return
    }

    if (sources.length === 0 && invalid.length > 0) {
      setError(
        `No valid URLs found: ${invalid.map((item) => `${item.input} (${item.reason})`).join(', ')}`
      )
      return
    }

    setIsProcessing(true)
    try {
      const result = await importSources(sources, {
        targetSessionId: sessionId,
        invalidInputs: invalid,
        onProgress: setStatuses,
      })
      trackSongImport('pasted_link', result.imported, tokenCount)
      setPasteText('')
      if (result.imported > 0) {
        setSuccessMessage(
          result.imported === 1
            ? 'Song added to the set.'
            : `${result.imported} songs added to the set.`
        )
      } else {
        setError('No songs could be added. Check the import details below.')
      }
      await onSessionUpdated(result.session, result.firstNewIndex)
    } catch (err) {
      trackSongImport('pasted_link', 0, tokenCount)
      setError((err as Error).message || 'Could not add songs. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="space-y-4">
      <PasteUrlForm
        value={pasteText}
        onChange={setPasteText}
        onSubmit={handleExtract}
        isProcessing={isProcessing}
        error={error}
        submitLabel="Add to setlist"
        processingLabel="Adding songs"
        linkCount={splitUrls(pasteText).length}
      />
      {successMessage && <StatusBanner tone="success">{successMessage}</StatusBanner>}
      <ImportProgressList
        statuses={statuses}
        className="border-t border-[var(--ui-border)] pt-3"
      />
    </div>
  )
}
