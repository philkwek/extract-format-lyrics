import { useEffect } from 'react'

const SITE_URL = 'https://setsandsheets.com'

export interface SeoOptions {
  title: string
  description?: string
  /** Path used for the canonical URL, e.g. "/privacy". Omit for non-indexable pages. */
  path?: string
  noindex?: boolean
}

function upsert(selector: string, create: () => HTMLElement): HTMLElement {
  let el = document.head.querySelector<HTMLElement>(selector)
  if (!el) {
    el = create()
    document.head.appendChild(el)
  }
  return el
}

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  const el = upsert(`meta[${attr}="${key}"]`, () => {
    const m = document.createElement('meta')
    m.setAttribute(attr, key)
    return m
  })
  el.setAttribute('content', content)
}

/** Sets per-route title, description, canonical and robots tags (client-side). */
export function useSeo({ title, description, path, noindex }: SeoOptions) {
  useEffect(() => {
    document.title = title
    setMeta('property', 'og:title', title)
    setMeta('name', 'twitter:title', title)
    if (description) {
      setMeta('name', 'description', description)
      setMeta('property', 'og:description', description)
      setMeta('name', 'twitter:description', description)
    }
    if (path !== undefined) {
      const url = `${SITE_URL}${path}`
      const link = upsert('link[rel="canonical"]', () => {
        const l = document.createElement('link')
        l.setAttribute('rel', 'canonical')
        return l
      })
      link.setAttribute('href', url)
      setMeta('property', 'og:url', url)
    }
    const robots = document.head.querySelector('meta[name="robots"]')
    if (noindex) {
      setMeta('name', 'robots', 'noindex, nofollow')
    } else {
      robots?.remove()
    }
  }, [title, description, path, noindex])
}
