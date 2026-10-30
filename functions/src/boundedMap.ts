/** A Map that drops its oldest entry once it holds more than `max` items. */
export class BoundedMap<V> {
  private readonly items = new Map<string, V>()

  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    return this.items.get(key)
  }

  delete(key: string): void {
    this.items.delete(key)
  }

  set(key: string, value: V): void {
    this.items.delete(key)
    this.items.set(key, value)
    while (this.items.size > this.max) {
      const oldest = this.items.keys().next().value
      if (oldest === undefined) break
      this.items.delete(oldest)
    }
  }
}
