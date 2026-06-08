import type { Platform } from '@/types'

export interface PlatformBucket<T> {
  platform: Platform
  items: T[]
}

export function interleavePlatformBuckets<T>(
  buckets: PlatformBucket<T>[],
  platformOrder: Platform[]
): T[] {
  const orderedItems = platformOrder.map((platform) =>
    buckets.find((bucket) => bucket.platform === platform)?.items || []
  )

  const maxLength = orderedItems.reduce((max, items) => Math.max(max, items.length), 0)
  const merged: T[] = []

  for (let index = 0; index < maxLength; index++) {
    for (const items of orderedItems) {
      const item = items[index]
      if (item !== undefined) {
        merged.push(item)
      }
    }
  }

  return merged
}
