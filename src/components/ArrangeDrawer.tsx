import { useEffect } from 'react'

export interface ArrangeItem {
  id: string
  title: string
  subtitle?: string
  badge?: string
}

interface ArrangeDrawerProps {
  isOpen: boolean
  title: string
  subtitle?: string
  items: ArrangeItem[]
  onMove: (fromIndex: number, toIndex: number) => void
  onDelete?: (index: number) => void
  onClose: () => void
}

export default function ArrangeDrawer({
  isOpen,
  title,
  subtitle,
  items,
  onMove,
  onDelete,
  onClose,
}: ArrangeDrawerProps) {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="arrange-drawer-title"
      className="fixed inset-0 bg-black/60 z-50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 select-none"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#1a1a1a] border border-neutral-300 dark:border-[#282828] rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Drag Pill */}
        <div className="w-10 h-1 bg-neutral-300 dark:bg-neutral-700 rounded-full mx-auto mt-2.5 sm:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-3 border-b border-neutral-200 dark:border-[#282828]">
          <div>
            <h2 id="arrange-drawer-title" className="text-base font-bold text-neutral-900 dark:text-[#e5e5e5]">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-neutral-500 dark:text-[#999999] mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 dark:text-[#999999] dark:hover:text-[#e5e5e5] p-1.5 rounded-lg text-sm leading-none cursor-pointer"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Item List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {items.length === 0 ? (
            <div className="py-8 text-center text-xs text-neutral-500">
              No items to arrange.
            </div>
          ) : (
            items.map((item, idx) => {
              const isFirst = idx === 0
              const isLast = idx === items.length - 1

              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 p-3 bg-neutral-50 dark:bg-[#202020] border border-neutral-200 dark:border-[#282828] rounded-xl transition-all"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="text-xs font-mono font-bold text-[#255283] dark:text-amber-400 bg-[#C8DFDB]/50 dark:bg-amber-400/10 px-2 py-1 rounded-md shrink-0">
                      {item.badge || `#${idx + 1}`}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-neutral-900 dark:text-[#e5e5e5] truncate">
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div className="text-xs text-neutral-500 dark:text-[#999999] truncate">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Nudge Buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={isFirst}
                      onClick={() => onMove(idx, idx - 1)}
                      title="Move up"
                      className="w-9 h-9 flex items-center justify-center rounded-lg font-bold text-sm bg-neutral-200 hover:bg-neutral-300 dark:bg-[#2a2a2a] dark:hover:bg-[#353535] text-neutral-800 dark:text-[#e5e5e5] disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer transition-colors active:scale-95"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={isLast}
                      onClick={() => onMove(idx, idx + 1)}
                      title="Move down"
                      className="w-9 h-9 flex items-center justify-center rounded-lg font-bold text-sm bg-neutral-200 hover:bg-neutral-300 dark:bg-[#2a2a2a] dark:hover:bg-[#353535] text-neutral-800 dark:text-[#e5e5e5] disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer transition-colors active:scale-95"
                    >
                      ↓
                    </button>
                    {onDelete && items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDelete(idx)}
                        title="Delete"
                        className="w-9 h-9 flex items-center justify-center rounded-lg text-sm text-neutral-400 hover:text-red-500 dark:text-[#999999] dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 cursor-pointer transition-colors"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 pt-3 border-t border-neutral-200 dark:border-[#282828] bg-neutral-50/50 dark:bg-[#151515] rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 px-4 bg-[#3368A0] hover:bg-[#255283] text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer shadow-xs dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-black"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
