import { Moon, Sun, SunMoon } from 'lucide-react'
import { nextThemeMode, type ThemeMode } from '../lib/theme'
import { useThemeMode } from '../lib/useThemeMode'
import { Button } from './ui'

interface ThemeToggleProps {
  variant?: 'secondary' | 'ghost'
  size?: number
  /** Icon only below tablet width (the navbar). */
  compact?: boolean
}

const MODE_NAME: Record<ThemeMode, string> = {
  light: 'light',
  dark: 'dark',
  system: 'device',
}

const MODE_LABEL: Record<ThemeMode, string> = {
  light: 'Light mode',
  dark: 'Dark mode',
  system: 'Match device',
}

const MODE_LABEL_SHORT: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Device',
}

function getLabel(mode: ThemeMode): string {
  return `${MODE_LABEL[mode]}. Switch to ${MODE_NAME[nextThemeMode(mode)]} mode`
}

export default function ThemeToggle({
  variant = 'secondary',
  size = 16,
  compact = false,
}: ThemeToggleProps) {
  const { mode, cycleMode } = useThemeMode()

  return (
    <Button
      variant={variant}
      size="sm"
      aria-label={getLabel(mode)}
      onClick={cycleMode}
      icon={
        mode === 'system' ? (
          <SunMoon size={size} />
        ) : mode === 'dark' ? (
          <Moon size={size} />
        ) : (
          <Sun size={size} />
        )
      }
    >
      {compact ? (
        <span className="hidden md:inline">{MODE_LABEL[mode]}</span>
      ) : (
        <>
          <span className="sm:hidden">{MODE_LABEL_SHORT[mode]}</span>
          <span className="hidden sm:inline">{MODE_LABEL[mode]}</span>
        </>
      )}
    </Button>
  )
}
