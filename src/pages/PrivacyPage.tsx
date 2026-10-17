import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { setTrackingEnabled, trackingEnabled } from '../lib/analytics'
import { Button, Surface } from '../components/ui'

export default function PrivacyPage() {
  const navigate = useNavigate()
  const [enabled, setEnabled] = useState(trackingEnabled)
  useEffect(() => {
    const update = () => setEnabled(trackingEnabled())
    window.addEventListener('usage-tracking-changed', update)
    return () => window.removeEventListener('usage-tracking-changed', update)
  }, [])
  return (
    <Surface className="mx-auto max-w-2xl space-y-5 p-5 sm:p-8">
      <Button
        variant="ghost"
        icon={<ArrowLeft size={15} />}
        onClick={() => {
          if (window.history.state?.idx > 0) navigate(-1)
          else navigate('/')
        }}
      >
        Back
      </Button>
      <h1 className="text-2xl font-bold">Privacy and usage tracking</h1>
      <p>
        Hi there! Phil here, I use Google Analytics to track how much this site is being used. Anonymous details like device type & actions performed
        (eg: Number of Songs imported, Number of Lyrics shared etc) are counted and tracked. 
      </p>
      <p>
        Google Analytics uses cookies and browser identifiers to measure visits and engagement. This site
        does not send song text, song titles, search terms, filenames, set names, or private link IDs. 
        And of course, everything is free and I do not place ads, so your data isn't being used for profit!
      </p>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--ui-border)] p-4">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setTrackingEnabled(event.target.checked)
            setEnabled(event.target.checked)
          }}
          className="h-5 w-5"
        />
        <span>Usage tracking</span>
      </label>
      <p role="status">Usage tracking is {enabled ? 'on' : 'off'} for this browser.</p>
      <p>
        Turning tracking off stops future collection in this browser. It does not delete data
        already collected or existing Analytics cookies. Your choice is saved in this browser;
        clearing site data resets it.
      </p>
      <p>
        Your song library and setlists are stored in your browser. Sharing a set or publishing
        lyrics also stores that shared content on our server for the link to work.
      </p>
      <a className="underline" href="https://policies.google.com/privacy">
        Google’s privacy policy
      </a>
    </Surface>
  )
}
