import type { FormEvent } from 'react'
import { AlertCircle, Search } from 'lucide-react'
import { classes } from '../../lib/classes'
import { Button, StatusBanner } from '../ui'

interface SearchFormProps {
  query: string
  onQueryChange: (value: string) => void
  onSubmit: (event?: FormEvent) => void
  isSearching: boolean
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
  error,
  description,
  placeholder,
  className,
}: SearchFormProps) {
  return (
    <div className={classes('space-y-4', className)}>
      {description && (
        <p className="text-sm leading-6 text-[var(--ui-text-muted)]">{description}</p>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          className="ui-field flex-1 px-3.5 py-2.5 text-sm"
        />
        <Button
          type="submit"
          variant="primary"
          icon={<Search size={15} />}
          disabled={isSearching || !query.trim()}
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
