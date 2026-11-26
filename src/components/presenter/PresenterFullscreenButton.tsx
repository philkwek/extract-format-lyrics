import { Maximize, Minimize } from 'lucide-react'
import { useFullscreen } from '../../lib/useFullscreen'
import { Button } from '../ui'
import { CORNER_BUTTON_STYLE } from './cornerButtonStyle'

export default function PresenterFullscreenButton() {
  const { isFullscreen, toggleFullscreen } = useFullscreen()
  return (
    <Button
      variant="secondary"
      icon={isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
      style={CORNER_BUTTON_STYLE}
      onClick={toggleFullscreen}
    >
      {isFullscreen ? 'Exit full screen' : 'Go full screen'}
    </Button>
  )
}
