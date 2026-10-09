import type { SharePayload } from './types.js'

interface ShortLinkRecord {
  payload: SharePayload
  createdAt: number
}

// In-memory LRU-like store with TTL (e.g., 30 days) and cap (e.g., 5000 links)
const MAX_SHORT_LINKS = 5000
const SHORT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

class ShortLinkStore {
  private store = new Map<string, ShortLinkRecord>()

  generateId(len = 6): string {
    const chars = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ'
    let result = ''
    for (let i = 0; i < len; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  save(payload: SharePayload): string {
    // Clean expired or overflow items
    const now = Date.now()
    if (this.store.size >= MAX_SHORT_LINKS) {
      for (const [k, v] of this.store.entries()) {
        if (now - v.createdAt > SHORT_LINK_TTL_MS) {
          this.store.delete(k)
        }
      }
      // If still full, prune oldest entries
      if (this.store.size >= MAX_SHORT_LINKS) {
        const oldestKey = this.store.keys().next().value
        if (oldestKey) this.store.delete(oldestKey)
      }
    }

    let id = this.generateId()
    while (this.store.has(id)) {
      id = this.generateId()
    }

    this.store.set(id, { payload, createdAt: now })
    return id
  }

  get(id: string): SharePayload | null {
    const rec = this.store.get(id)
    if (!rec) return null
    if (Date.now() - rec.createdAt > SHORT_LINK_TTL_MS) {
      this.store.delete(id)
      return null
    }
    return rec.payload
  }
}

export const shortLinkStore = new ShortLinkStore()
