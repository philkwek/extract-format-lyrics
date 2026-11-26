import { classes } from '../../lib/classes'

export function OnScreenTag({ className }: { className?: string }) {
  return (
    <span
      className={classes(
        'bg-ui-accent text-ui-on-accent inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
        className,
      )}
    >
      On screen
    </span>
  )
}
