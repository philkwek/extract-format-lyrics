/** Section colours for the presenter console, readable in light and dark themes. */
export function sectionTone(label: string): string {
  if (/chorus/i.test(label)) {
    return 'border-violet-500 bg-violet-500/10 text-violet-700 dark:border-violet-300 dark:text-violet-300'
  }
  if (/verse/i.test(label)) {
    return 'border-sky-500 bg-sky-500/10 text-sky-700 dark:border-sky-300 dark:text-sky-300'
  }
  return 'border-teal-500 bg-teal-500/10 text-teal-700 dark:border-teal-300 dark:text-teal-300'
}
