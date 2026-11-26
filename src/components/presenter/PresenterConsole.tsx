import { Button } from '../ui'

interface PresenterConsoleProps {
  id: string
  onSwitchToAuto: () => void
}

export default function PresenterConsole({ onSwitchToAuto }: PresenterConsoleProps) {
  return (
    <div className="bg-ui-canvas text-ui-text flex min-h-screen items-center justify-center p-8">
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-bold tracking-[-0.025em]">Manual control</h1>
        <Button variant="secondary" onClick={onSwitchToAuto}>
          Switch to auto follow host
        </Button>
      </div>
    </div>
  )
}
