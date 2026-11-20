import { useRef, type FormEvent } from 'react'
import { AlertCircle, Search, X } from 'lucide-react'
import { classes } from '../../lib/classes'
import { Button, IconButton, StatusBanner } from '../ui'

interface SearchFormProps {
  query: string
  onQueryChange: (value: string) => void
  onSubmit: (event?: FormEvent) => void
  isSearching: boolean
  disabled?: boolean
  error?: string | null
  description?: string
  placeholder?: string
  className?: string
}

export default function SearchForm({
  query,
  onQueryChange,
  onSubmit,
  isSearching,
  disabled,
  error,
  description,
  placeholder,
  className,
}: SearchFormProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={classes('space-y-4', className)}>
      {description && (
        <p className="text-sm leading-6 text-[var(--ui-text-muted)]">{description}</p>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={placeholder}
            className="ui-field px-3.5 py-2.5 pr-11 text-sm"
          />
          {query.length > 0 && (
            <IconButton
              label="Clear search"
              variant="ghost"
              className="ui-field-clear absolute top-1/2 right-0 -translate-y-1/2"
              onClick={() => {
                onQueryChange('')
                inputRef.current?.focus()
              }}
            >
              <X size={16} />
            </IconButton>
          )}
        </div>
        <Button
          type="submit"
          variant="primary"
          icon={<Search size={15} />}
          disabled={disabled || isSearching || !query.trim()}
          loading={isSearching}
        >
          Search
        </Button>
      </form>

      {error && (
        <StatusBanner tone="error" icon={<AlertCircle size={16} />}>
          {error}
        </StatusBanner>
      )}
    </div>
  )
}
