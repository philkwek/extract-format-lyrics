import { useState } from 'react'
import { Download, X } from 'lucide-react'
import { Button, IconButton, StatusBanner } from './ui'
import InstallStepsDialog from './InstallStepsDialog'
import OfflineNotice from './OfflineNotice'
import { useInstallNotice, installStore, type InstallPromptStore } from '../lib/installPrompt'
import { NEUTRAL_NOTICE } from '../lib/noticeSurface'
import { useOnlineStatus } from '../lib/useOnlineStatus'

/** The one slot above "Start a new session": offline status first, then the install offer. */
export default function HomeNotice({
  install: store = installStore,
}: {
  install?: InstallPromptStore
}) {
  const online = useOnlineStatus()
  const install = useInstallNotice(store)
  const [stepsOpen, setStepsOpen] = useState(false)

  if (!online) return <OfflineNotice online={online} />
  if (!install.visible) return null

  return (
    <>
      <StatusBanner
        tone={null}
        className={NEUTRAL_NOTICE}
        icon={<Download size={15} />}
        title="You can now install Sets & Sheets!"
        actions={
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (install.canPrompt) void install.promptInstall()
                else setStepsOpen(true)
              }}
            >
              {install.canPrompt ? 'Install app' : 'Show me how!'}
            </Button>
            <IconButton label="Dismiss" variant="ghost" onClick={install.dismiss}>
              <X size={15} />
            </IconButton>
          </>
        }
      >
        Open your sets from the home screen, even without a connection.
      </StatusBanner>
      <InstallStepsDialog isOpen={stepsOpen} onClose={() => setStepsOpen(false)} />
    </>
  )
}
