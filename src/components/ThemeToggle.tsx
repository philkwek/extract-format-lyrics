import { Moon, Sun, SunMoon } from 'lucide-react'
import { nextThemeMode, type ThemeMode } from '../lib/theme'
import { useThemeMode } from '../lib/useThemeMode'
import { IconButton } from './ui'

interface ThemeToggleProps {
  variant?: 'secondary' | 'ghost'
  size?: number
}

const MODE_NAME: Record<ThemeMode, string> = {
  light: 'light',
  dark: 'dark',
  system: 'device',
}

function getLabel(mode: ThemeMode): string {
  const next = nextThemeMode(mode)
  if (mode === 'system') return `Theme follows device. Switch to ${MODE_NAME[next]} mode`
  if (mode === 'light') return `Light theme. Switch to ${MODE_NAME[next]} mode`
  return `Dark theme. Switch to ${MODE_NAME[next]} mode`
}

export default function ThemeToggle({ variant = 'secondary', size = 16 }: ThemeToggleProps) {
  const { mode, cycleMode } = useThemeMode()

  return (
    <IconButton onClick={cycleMode} label={getLabel(mode)} variant={variant}>
      {mode === 'system' ? (
        <SunMoon size={size} />
      ) : mode === 'dark' ? (
        <Moon size={size} />
      ) : (
        <Sun size={size} />
      )}
    </IconButton>
  )
}
