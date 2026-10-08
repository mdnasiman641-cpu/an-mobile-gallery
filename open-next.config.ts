import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import doShardedTagCache from "@opennextjs/cloudflare/overrides/tag-cache/do-sharded-tag-cache";

/**
 * Keeps the app's caching strategy working on Cloudflare Workers:
 *  - incrementalCache: cached pages (ISR) and unstable_cache data in R2, with a
 *    regional Cache API layer in front so repeat hits don't even read R2.
 *  - queue: background regeneration for `export const revalidate = …`.
 *  - tagCache: on-demand invalidation, so admin saves and new orders
 *    (revalidateTag / revalidatePath in lib/cache.ts) update pages immediately.
 *  - enableCacheInterception: cached pages are answered before the Next.js
 *    server is loaded, which keeps CPU time per request low (Workers Free
 *    allows 10 ms CPU per request).
 */
export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, { mode: "long-lived" }),
  queue: doQueue,
  tagCache: doShardedTagCache({ baseShardSize: 12 }),
  enableCacheInterception: true,
});
