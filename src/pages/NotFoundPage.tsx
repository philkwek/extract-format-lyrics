import { Link } from 'react-router-dom'
import { useSeo } from '../lib/useSeo'

export default function NotFoundPage() {
  useSeo({ title: 'Page not found | Sets & Sheets', noindex: true })
  return (
    <section className="py-16 text-center">
      <h1 className="text-2xl font-bold tracking-[-0.03em]">Page not found</h1>
      <p className="mt-2 text-sm text-[var(--ui-text-muted)]">We couldn't find the page you were looking for.</p>
      <Link to="/" className="mt-4 inline-block underline">Back to Sets &amp; Sheets</Link>
    </section>
  )
}
